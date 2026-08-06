"""Souk's skills -- ecommerce growth work grounded in real trading figures.

Every prompt here builds its store block through `_store_block`, which renders
what was measured and, separately, what could not be. That separation is the
whole safety property of this agent: a merchant acting on an invented ROAS
moves real budget. See store_agent_context for why unavailable metrics carry no
value at all rather than a caveat.
"""
from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json

# Repeated in every prompt rather than stated once in the employee's system
# prompt: the tool result and this instruction end up adjacent in the context,
# which is where the temptation to fill a blank actually arises.
_NO_INVENTION = (
    "GROUND RULES. Use only figures under MEASURED. Everything under NOT MEASURED has no "
    "value because nobody has measured it -- never estimate one, never reason from one, and "
    "never let one become a recommendation. If the question needs a missing metric, say which "
    "metric and which connector supplies it. A change with no previous period, or one over a "
    "handful of orders, is not a trend."
)


def _store_block(td) -> str:
    """The store, rendered so measured and missing cannot be confused."""
    d = (td.get("shopify.analytics") or {}).get("data") or {}
    if not d:
        return ("STORE DATA: unavailable -- no store is connected, or it has no orders yet. "
                "Say so plainly and give only advice that does not depend on figures.")

    cur = d.get("currency", "")
    w = d.get("window", {})
    lines = [f"WINDOW: {w.get('days')} days ({w.get('from')} to {w.get('to')}), currency {cur}",
             "", "MEASURED:"]
    for key, m in (d.get("measured") or {}).items():
        chg = m.get("change_pct")
        delta = (f" ({chg:+.1f}% vs {m.get('previous')})" if chg is not None
                 else " (no comparable previous period)")
        lines.append(f"  {key}: {m['value']}{delta}")

    missing = d.get("unavailable") or []
    if missing:
        lines += ["", "NOT MEASURED -- no value exists for these:"]
        lines += [f"  {m['metric']} -- would come from {m['needs']}" for m in missing]
    if d.get("unavailable_dimensions"):
        lines.append(f"  revenue cannot be split by: {', '.join(d['unavailable_dimensions'])}")

    for name, rows in (d.get("revenue_by") or {}).items():
        lines += ["", f"REVENUE BY {name.upper()} (measured):"]
        lines += [f"  {r['label']}: {r['revenue']:,.0f} {cur}, {r['orders']} orders, "
                  f"{r['share_pct']:.0f}%" for r in rows]

    cr = d.get("content_revenue") or {}
    if cr.get("pages"):
        lines += ["", f"REVENUE FROM PUBLISHED CONTENT: {cr['revenue']:,.0f} {cur} "
                      f"({cr['share_pct']:.0f}% of store revenue)"]
        lines += [f"  \"{p['title']}\" ({p['path']}): {p['orders']} orders, "
                  f"{p['revenue']:,.0f} {cur}" for p in cr["pages"][:6]]

    if d.get("observations"):
        lines += ["", "OBSERVED (computed from measured figures):"]
        lines += [f"  - {o}" for o in d["observations"]]

    daily = d.get("daily_revenue") or []
    if daily:
        lines += ["", "DAILY REVENUE: " + ", ".join(
            f"{p['date'][5:]}={p['revenue']:.0f}" for p in daily[-21:])]
    return "\n".join(lines)


def _products_block(td) -> str:
    p = (td.get("shopify.products") or {}).get("data") or {}
    rows = p.get("products") or []
    if not rows:
        return ""
    return ("\nCATALOGUE (title, price):\n"
            + "\n".join(f"  {r.get('title')} -- {r.get('price')}" for r in rows[:40]))


_PRIORITY_FORMAT = (
    'Respond with ONLY JSON: {"situation": one paragraph on where the store stands, '
    '"findings": [{"severity": "critical"|"important"|"optimise", "problem": what is wrong, '
    '"evidence": the measured figure that shows it, "diagnosis": why it is happening, '
    '"action": the exact thing to do, "impact": expected effect with a range, '
    '"effort": "hours"|"days"|"weeks"}], '
    '"blind_spots": [what you could not assess and the connector that would fix it], '
    '"this_week": [1-3 things to do first, most important first]}. '
    'Order findings by revenue impact. Three to six findings; fewer, specific findings beat '
    'a long list. Never output a finding whose evidence is not a measured figure.'
)


def _growth_audit_prompt(brief, inputs, td):
    system = (
        agent_persona("souk")
        + " Audit this store like an operator with one week to move the number.\n"
        "Find the CONSTRAINT -- the one thing whose removal unlocks the most revenue -- "
        "not a list of everything imperfect. Work across the whole journey: traffic mix, "
        "landing page, product page, cart, checkout, repeat purchase.\n"
        + _NO_INVENTION + "\n" + _PRIORITY_FORMAT
    )
    user = brief_block(brief) + "\n\n" + _store_block(td) + _products_block(td) + feedback_block(inputs)
    return system, user


GROWTH_AUDIT = Skill(
    key="souk.growth_audit", agent_id="souk", weight="medium",
    tools=["shopify.analytics", "shopify.products"], build_prompt=_growth_audit_prompt,
    output="json", parse=parse_json, label="Growth audit",
    description="Find what limits growth now and rank the fixes by revenue impact.",
)


def _cro_review_prompt(brief, inputs, td):
    system = (
        agent_persona("souk")
        + " Review the buying journey for friction, step by step: landing page, collection, "
        "product page, cart, checkout.\n"
        "For each leak name the step, what specifically causes it, and the change to make -- "
        "the element, its placement, and the copy angle. 'Add trust badges' is not an answer; "
        "'move the returns guarantee directly under the add-to-cart button, worded as \"30-day "
        "free returns, no questions\"' is.\n"
        "Where funnel figures are not measured, reason from what IS measured -- AOV, channel "
        "mix, landing pages, the daily pattern -- and say plainly which step you cannot see.\n"
        + _NO_INVENTION + "\n"
        'Respond with ONLY JSON: {"leaks": [{"step": "landing"|"collection"|"product"|"cart"'
        '|"checkout"|"post-purchase", "problem": str, "evidence": str, "fix": str, '
        '"impact": str, "confidence": "high"|"medium"|"low"}], '
        '"test_first": the single change to ship first and why, '
        '"cannot_see": [steps you have no data for, and the connector that would show them]}'
    )
    user = brief_block(brief) + "\n\n" + _store_block(td) + _products_block(td) + feedback_block(inputs)
    return system, user


CRO_REVIEW = Skill(
    key="souk.cro_review", agent_id="souk", weight="medium",
    tools=["shopify.analytics", "shopify.products"], build_prompt=_cro_review_prompt,
    output="json", parse=parse_json, label="Conversion review",
    description="Where the buying journey leaks, and the exact change at each step.",
)


def _retention_prompt(brief, inputs, td):
    system = (
        agent_persona("souk")
        + " Design the lifecycle programme that raises repeat purchase rate.\n"
        "Specify each flow completely: trigger, delay, message angle, offer (or explicitly no "
        "offer), and the success metric. A flow nobody can build from your description is not a "
        "recommendation. Do not discount by default -- an incentive in the first message trains "
        "customers to wait for one.\n"
        + _NO_INVENTION + "\n"
        'Respond with ONLY JSON: {"flows": [{"name": str, "trigger": str, "timing": str, '
        '"messages": [{"delay": str, "angle": str, "offer": str|null}], "metric": str, '
        '"priority": "critical"|"important"|"optimise"}], '
        '"segments": [{"name": str, "definition": str, "why": str}], '
        '"cannot_see": [what customer data you lack and the connector that supplies it]}'
    )
    user = brief_block(brief) + "\n\n" + _store_block(td) + feedback_block(inputs)
    return system, user


RETENTION_PLAN = Skill(
    key="souk.retention_plan", agent_id="souk", weight="light",
    tools=["shopify.analytics"], build_prompt=_retention_prompt,
    output="json", parse=parse_json, label="Retention plan",
    description="Lifecycle flows and segments that raise repeat purchase rate.",
)


def _merchandising_prompt(brief, inputs, td):
    system = (
        agent_persona("souk")
        + " Decide what to push, bundle, reprice or retire.\n"
        "Base every call on what actually sells and on the catalogue -- not on category "
        "intuition. A bundle must name both products and the reason a buyer wants them "
        "together. A price change must name the current price, the new one, and the logic.\n"
        + _NO_INVENTION + "\n"
        'Respond with ONLY JSON: {"push": [{"product": str, "why": str, "where": str}], '
        '"bundles": [{"products": [str], "angle": str, "price_logic": str}], '
        '"reprice": [{"product": str, "from": str, "to": str, "why": str}], '
        '"retire": [{"product": str, "why": str}], '
        '"cannot_see": [what product-level data you lack and the connector that supplies it]}'
    )
    user = brief_block(brief) + "\n\n" + _store_block(td) + _products_block(td) + feedback_block(inputs)
    return system, user


MERCHANDISING = Skill(
    key="souk.merchandising", agent_id="souk", weight="light",
    tools=["shopify.analytics", "shopify.products"], build_prompt=_merchandising_prompt,
    output="json", parse=parse_json, label="Merchandising moves",
    description="What to push, bundle, reprice or retire, from what actually sells.",
)
