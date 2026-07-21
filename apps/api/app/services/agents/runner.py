import logging
from app.services.agents.spec import AgentResult
from app.services.agents.tiers import resolve_model
from app.services.agents.tools import run_tools
from app.services.llm_service import call_llm, get_org_llm_keys

logger = logging.getLogger(__name__)


class AgentRunner:
    @staticmethod
    async def run(skill, brief, inputs, tier, db, keys=None, campaign=None) -> AgentResult:
        if keys is None:
            keys = await get_org_llm_keys(brief.org_id, db)
        available = list(keys.keys())
        if not available:
            return AgentResult(ok=False, error="No AI key configured. Add an Anthropic or OpenAI key in Settings.")
        try:
            provider, model = resolve_model(tier, skill.weight, available)
            tool_data = await run_tools(skill.tools, brief, db, inputs)
            system, user = skill.build_prompt(brief, inputs or {}, tool_data)
            mt = {"max_tokens": skill.max_tokens} if skill.max_tokens else {}
            raw = await call_llm(provider, model, keys[provider], system, user, locale=brief.locale, **mt)
            content = _parse(skill, raw)
            if content is None and skill.output == "json":
                raw2 = await call_llm(provider, model, keys[provider], system,
                                      user + "\n\nReturn ONLY valid JSON. No prose, no code fences.",
                                      locale=brief.locale, **mt)
                content = _parse(skill, raw2)
            if content is None:
                return AgentResult(ok=False, error="Agent returned an unusable format.")
            if skill.persist:
                return await skill.persist(content, campaign, brief, db)
            return AgentResult(ok=True, summary=str(content)[:200], content=content)
        except Exception as exc:  # noqa: BLE001
            logger.exception("agent skill failed: %s", skill.key)
            return AgentResult(ok=False, error=str(exc))


def _parse(skill, raw: str):
    if skill.parse is None:
        return raw
    try:
        return skill.parse(raw)
    except Exception:
        return None
