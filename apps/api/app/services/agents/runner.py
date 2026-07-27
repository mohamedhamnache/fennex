import logging
from app.services.agents.spec import AgentResult
from app.services.agents.tiers import resolve_model
from app.services.agents.tools import run_tools
from app.services.llm_service import call_llm, get_org_llm_keys

logger = logging.getLogger(__name__)


async def _override_or_tier(brief, db, tier, weight, available, feature, keys,
                            provider_override, model_override):
    """Resolve the (provider, model) to actually call.

    An override arrives unvalidated from the request body (see
    routers/articles.py's GenerateArticleRequest), so it is only honoured when
    it names a catalogued model on a configured provider, capped at the org's
    entitlement (app.core.entitlements.cap_band) -- treating a model listed
    under more than one catalog band as its highest, exactly like the chat
    picker's override path in app.employees.runtime.models.for_action. An
    uncatalogued model, or one above entitlement, falls back to normal tier
    resolution rather than raising.

    The org is only fetched when it can actually change the answer: cap_band
    with org=None already caps at "standard" (the safe default), and a real
    org's ceiling is never *more* restrictive than that (see
    app.core.entitlements.max_band) -- so a cheap/standard override can never
    be capped down by fetching the real org, and only a premium-band override
    needs the query.
    """
    from app.employees.runtime.models import is_allowed, highest_band

    if provider_override and model_override and is_allowed(provider_override, model_override, keys):
        band = highest_band(provider_override, model_override)
        if band is not None:
            from app.core.entitlements import cap_band

            org = None
            if band == "premium":
                from app.models.organization import Organization
                org = await db.get(Organization, brief.org_id) if db is not None else None
            if cap_band(band, org) == band:
                return provider_override, model_override

    return resolve_model(tier, weight, available, feature=feature)


class AgentRunner:
    @staticmethod
    async def run(skill, brief, inputs, tier, db, keys=None, campaign=None,
                  provider_override=None, model_override=None) -> AgentResult:
        if keys is None:
            keys = await get_org_llm_keys(brief.org_id, db)
        available = list(keys.keys())
        if not available:
            return AgentResult(ok=False, error="No AI key configured. Add an Anthropic or OpenAI key in Settings.")
        try:
            feature = getattr(skill, "feature", None)
            provider, model = await _override_or_tier(
                brief, db, tier, skill.weight, available, feature, keys,
                provider_override, model_override)
            tool_data = await run_tools(skill.tools, brief, db, inputs)
            system, user = skill.build_prompt(brief, inputs or {}, tool_data)
            mt = {"max_tokens": skill.max_tokens} if skill.max_tokens else {}
            raw = await call_llm(provider, model, keys[provider], system, user, locale=brief.locale,
                                 feature=feature, **mt)
            content = _parse(skill, raw)
            if content is None and skill.output == "json":
                raw2 = await call_llm(provider, model, keys[provider], system,
                                      user + "\n\nReturn ONLY valid JSON. No prose, no code fences.",
                                      locale=brief.locale, feature=feature, **mt)
                content = _parse(skill, raw2)
            if content is None:
                return AgentResult(ok=False, error="Agent returned an unusable format.")
            if skill.persist:
                brief.runtime = {"provider": provider, "model": model, "api_key": keys[provider],
                                 "tier": tier, "inputs": inputs or {}}
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
