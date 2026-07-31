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

Region operations — ALSO fully available, use them freely:
- replace_background: params: prompt(str describing the new background), target(str, optional — OMIT to mean the background itself)
- remove_object: params: target(str, REQUIRED — the thing to delete, e.g. "the mint leaves")
- smart_erase: params: target(str, REQUIRED — the thing to erase)
- insert_object: params: prompt(str describing what to add), target(str, REQUIRED — where to put it)
- generative_fill: params: prompt(str describing the fill), target(str, REQUIRED — the region to fill)

ANY request about how the background LOOKS is replace_background, including a
plain colour. Put the wanted look in `prompt`:
  "change the background color to green"  -> replace_background, prompt "solid green background"
  "mets un fond blanc"                    -> replace_background, prompt "solid white background"
  "put it on marble"                      -> replace_background, prompt "polished marble surface"

How to fill `target`: name the thing in the user's own words -- "remove the
mint", "supprime la menthe", "erase the logo". Removal needs it because removing
nothing in particular would guess, and a wrong guess deletes the wrong object.
replace_background is the one operation that may omit it, since "the background"
is its own default region and resolving it that way costs less.
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
    "Mask operations are fully available -- never refuse or avoid one because it needs a selection, "
    "and never ask the user to paint anything. "
    'If nothing maps, respond with {"error": "explanation"}. No markdown, no text outside the JSON.\n\n'
    + _OPERATIONS_REFERENCE
)


async def parse_ai_command_steps(
    command: str,
    history: list[dict],
    org_id: uuid.UUID,
    db,
    locale: str = "en",
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

    # A refusal is NOT final while another provider is untried. These models
    # refuse intermittently -- "change background color to green" came back as
    # {"error": "...do not map to available tasks"} on one provider while the
    # very same prompt mapped it correctly on another. Returning the first
    # refusal turned a transient hiccup into a hard failure the user saw.
    refusal: dict | None = None
    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _STEPS_SYSTEM, user_msg, locale=locale)
            data = json.loads(raw.strip())
            steps = data.get("steps")
            if isinstance(steps, list) and steps:
                return {"steps": steps[:6]}  # cap to avoid runaway chains
            if "error" in data:
                refusal = refusal or data
                continue
        except Exception:
            continue

    # Every provider that could answer refused, so the request genuinely does not
    # map. Surface the model's own explanation rather than a generic message.
    if refusal is not None:
        return refusal
    return {"error": "Failed to parse command — please try rephrasing."}


async def parse_ai_command(
    command: str,
    history: list[dict],
    org_id: uuid.UUID,
    db,
    locale: str = "en",
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
            raw = await call_llm(provider, model, keys[provider], _SYSTEM, user_msg, locale=locale)
            data = json.loads(raw.strip())
            if "operation" in data or "error" in data:
                return data
        except Exception:
            continue

    return {"error": "Failed to parse command — please try rephrasing."}
