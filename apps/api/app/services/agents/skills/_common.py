import json
import re


def parse_json(raw: str):
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    return json.loads(cleaned)


def brief_block(brief) -> str:
    parts = [f"GOAL: {brief.goal}", f"PERSONA: {brief.persona}"]
    if brief.project_profile:
        parts.append(f"CLIENT PROFILE: {brief.project_profile}")
    b = brief.brand or {}
    if b.get("tone"):
        parts.append(f"BRAND TONE: {b['tone']}")
    if b.get("voice_prompt"):
        parts.append(f"BRAND VOICE: {b['voice_prompt']}")
    if b.get("avoid_words"):
        parts.append(f"AVOID WORDS: {', '.join(b['avoid_words'])}")
    if brief.existing_content:
        parts.append("EXISTING CONTENT (choose an angle clearly different from every one):\n"
                     + "\n".join(f"- {t}" for t in brief.existing_content))
    if brief.artifacts:
        parts.append("ALREADY PRODUCED THIS CAMPAIGN:\n"
                     + "\n".join(f"- {a['summary']}" for a in brief.artifacts if a.get("summary")))
    return "\n".join(parts)


def feedback_block(inputs) -> str:
    fb = (inputs or {}).get("feedback")
    return f"\n\nPREVIOUS ATTEMPT — FIX THIS:\n{fb}\n" if fb else ""
