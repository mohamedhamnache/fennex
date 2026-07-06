"""Parse natural-language editing commands into structured operations using LLM."""
import json
import uuid
from app.services.llm_service import get_org_llm_keys, call_llm

_OPERATIONS_REFERENCE = """
Available operations (use exactly these names):
- crop: params: x(int), y(int), w(int), h(int) — pixel values
- resize: params: width(int), height(int), keep_aspect(bool, default true)
- rotate: params: angle(float, -180 to 180)
- flip: params: direction("horizontal"|"vertical")
- adjust: params: brightness(float, -100 to 100), contrast(float, -100 to 100), saturation(float, -100 to 100)
- filter: params: filter_name("grayscale"|"sepia"|"warm"|"cool"|"vivid")
- denoise: params: strength(float, 0 to 1)
- sharpen: params: strength(float, 0 to 1)
- background_removal: params: {} (no extra params)
- upscale: params: scale(2 or 4)
- restore_face: params: fidelity(float, 0 to 1, default 0.7)
- generate_shadow: params: direction("bottom"|"bottom-right"|"bottom-left"|"right"|"left")
- relight: params: direction("top"|"top-right"|"left"|"right"), intensity(float, 0.1 to 2)

Operations requiring a mask (user must paint mask on canvas first):
- replace_background: params: prompt(str describing new background)
- remove_object: params: {}
- insert_object: params: prompt(str describing object to insert)
- generative_fill: params: prompt(str describing fill content)
- smart_erase: params: {}
"""

_SYSTEM = (
    "You are an AI image editing assistant. The user will describe an edit they want to make. "
    "Map their request to exactly one editing operation from the list below. "
    'Respond ONLY with a JSON object: {"operation": "name", "params": {...}}. '
    'If the request cannot be mapped to any operation, respond with {"error": "explanation"}. '
    "No markdown, no explanations outside the JSON.\n\n"
    + _OPERATIONS_REFERENCE
)

_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


from app.agents.registry import agent_persona as _agent_persona

_STEPS_SYSTEM = _agent_persona("mirage") + (
    "The user describes one or more edits in a single message. "
    "Map their request to an ORDERED list of operations to apply in sequence. "
    "A request may contain several edits — e.g. 'brighten it, remove the background and upscale' becomes "
    "three steps in that order. "
    'Respond ONLY with a JSON object: {"steps": [{"operation": "name", "params": {...}}, ...]}. '
    "Prefer operations that do NOT require a mask. Only include a mask operation if the user clearly refers "
    "to a painted selection. "
    'If nothing maps, respond with {"error": "explanation"}. No markdown, no text outside the JSON.\n\n'
    + _OPERATIONS_REFERENCE
)


async def parse_ai_command_steps(
    command: str,
    history: list[dict],
    org_id: uuid.UUID,
    db,
) -> dict:
    """Parse a command into an ordered list of steps: {"steps": [...]} or {"error": ...}."""
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"error": "no_llm_keys"}

    messages = []
    for turn in history[-6:]:
        messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})
    messages.append({"role": "user", "content": command})
    user_msg = "\n".join(f"{m['role']}: {m['content']}" for m in messages[-3:]) if len(messages) > 1 else command

    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _STEPS_SYSTEM, user_msg)
            data = json.loads(raw.strip())
            if "error" in data:
                return data
            steps = data.get("steps")
            if isinstance(steps, list) and steps:
                return {"steps": steps[:6]}  # cap to avoid runaway chains
        except Exception:
            continue

    return {"error": "Failed to parse command — please try rephrasing."}


async def parse_ai_command(
    command: str,
    history: list[dict],
    org_id: uuid.UUID,
    db,
) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"error": "no_llm_keys"}

    messages = []
    for turn in history[-6:]:
        messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})
    messages.append({"role": "user", "content": command})

    user_msg = "\n".join(f"{m['role']}: {m['content']}" for m in messages[-3:]) if len(messages) > 1 else command

    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _SYSTEM, user_msg)
            data = json.loads(raw.strip())
            if "operation" in data or "error" in data:
                return data
        except Exception:
            continue

    return {"error": "Failed to parse command — please try rephrasing."}
