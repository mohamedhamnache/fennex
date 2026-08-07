"""Audience definitions — a specification, not a list of people.

THE THING THIS MODULE REFUSES TO DO. Fennex does not hold customer records. The
order sync stores what attribution needs and deliberately nothing else: no
customer id, no email, no address (see `StoreOrder`'s docstring -- keeping a
merchant's customer data to answer "which article earned this" would be
collecting personal information the feature does not use).

So Fennex cannot count "VIP customers", cannot list who abandoned a cart, and
cannot export a segment. Every audience here is therefore a DEFINITION: plain
words plus a machine-readable rule, built to be handed to the system that does
hold the people -- Klaviyo, Mailchimp, Meta's custom audiences, Shopify segments.

`resolvable` is False on every audience until one of those is connected, and
`size` is never a number we made up. A segment builder that shows "≈1,240
customers" without having counted anyone is inventing the single figure the
merchant will size their budget against.
"""
from __future__ import annotations

import json
import logging
import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import campaign_channels as ch
from app.services.agents.cascade import call_with_cascade, validators
from app.services.llm_service import get_org_llm_keys

logger = logging.getLogger(__name__)
_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")

# Connectors that hold customer records and could resolve a definition into
# actual people. Checked against the live catalogue by campaign_channels.
RESOLVERS = ("klaviyo", "mailchimp", "shopify", "meta-ads", "hubspot")

# The fields a rule may reference. Kept small and explicit: a rule the target
# platform cannot express is a rule that quietly does nothing when it lands
# there. These map onto concepts every ESP and ad platform has.
RULE_FIELDS = {
    "orders_count": "how many orders the customer has placed",
    "total_spent": "lifetime spend",
    "last_order_days_ago": "days since their most recent order",
    "first_order_days_ago": "days since their first order",
    "purchased_product": "has bought a specific product",
    "viewed_product": "has viewed a specific product without buying",
    "abandoned_checkout": "started a checkout and did not finish",
    "accepts_marketing": "has opted in to marketing",
    "country": "shipping country",
}

PRESETS: dict[str, dict] = {
    "new_customers": {
        "label": "New customers",
        "definition": "People who have never placed an order.",
        "rule": {"all": [{"field": "orders_count", "op": "=", "value": 0}]},
    },
    "returning_customers": {
        "label": "Returning customers",
        "definition": "People who have ordered at least twice.",
        "rule": {"all": [{"field": "orders_count", "op": ">=", "value": 2}]},
    },
    "vip": {
        "label": "VIP customers",
        "definition": "Frequent buyers with high lifetime spend.",
        "rule": {"all": [{"field": "orders_count", "op": ">=", "value": 3},
                         {"field": "total_spent", "op": ">=", "value": 300}]},
    },
    "high_ltv": {
        "label": "High lifetime value",
        "definition": "The top spenders, regardless of order count.",
        "rule": {"all": [{"field": "total_spent", "op": ">=", "value": 500}]},
    },
    "inactive": {
        "label": "Inactive customers",
        "definition": "Bought before, nothing in the last 90 days.",
        "rule": {"all": [{"field": "orders_count", "op": ">=", "value": 1},
                         {"field": "last_order_days_ago", "op": ">=", "value": 90}]},
    },
    "recent_purchasers": {
        "label": "Recent purchasers",
        "definition": "Ordered within the last 30 days.",
        "rule": {"all": [{"field": "last_order_days_ago", "op": "<=", "value": 30}]},
    },
    "cart_abandoners": {
        "label": "Cart abandoners",
        "definition": "Started a checkout in the last 14 days and did not finish.",
        "rule": {"all": [{"field": "abandoned_checkout", "op": "=", "value": True},
                         {"field": "last_order_days_ago", "op": ">=", "value": 0}]},
    },
    "product_viewers": {
        "label": "Product viewers",
        "definition": "Viewed a product and did not buy it.",
        "rule": {"all": [{"field": "viewed_product", "op": "=", "value": "<product>"},
                         {"field": "purchased_product", "op": "!=", "value": "<product>"}]},
    },
    "winback_90": {
        "label": "Winback — 90 days quiet",
        "definition": "Previous customers with no order in 90 days.",
        "rule": {"all": [{"field": "last_order_days_ago", "op": ">=", "value": 90}]},
    },
}


async def resolver_for(project_id: uuid.UUID, org_id: uuid.UUID,
                       db: AsyncSession) -> str | None:
    """The connected app that could turn a definition into real people."""
    available = await ch.connected_apps(project_id, org_id, db)
    return next((a for a in RESOLVERS if available.get(a)), None)


async def decorate(audience: dict, project_id: uuid.UUID, org_id: uuid.UUID,
                   db: AsyncSession) -> dict:
    """Attach the honest resolvability answer to an audience definition."""
    resolver = await resolver_for(project_id, org_id, db)
    out = dict(audience)
    out["resolvable"] = bool(resolver)
    out["resolver"] = resolver
    out["size"] = None          # never estimated. See the module docstring.
    if not resolver:
        out["needs"] = ("Fennex does not store customer records. Connect Klaviyo, "
                        "Mailchimp, Shopify customers or Meta Ads to build this "
                        "audience from real people.")
    else:
        out["needs"] = (f"This definition is ready to hand to {resolver}. Fennex "
                        "does not hold the customer list itself.")
    return out


def preset(key: str) -> dict | None:
    p = PRESETS.get(key)
    return {**p, "key": key, "source": "preset"} if p else None


def presets() -> list[dict]:
    return [{**v, "key": k, "source": "preset"} for k, v in PRESETS.items()]


_SYSTEM = """You turn a merchant's description of an audience into a structured rule.

You may only use these fields:
{fields}

Operators: =, !=, >, >=, <, <=, in

Respond with ONLY JSON:
{{"label": "short name", "definition": "one plain sentence describing who this is",
  "rule": {{"all": [{{"field": "...", "op": "...", "value": ...}}]}},
  "unsupported": ["any part of the request you could not express, in plain words"]}}

If the request needs something outside the field list, express what you can and
put the rest in "unsupported". Never invent a field. Never guess how many people
match -- you have no access to the customer list."""


async def from_text(text: str, project_id: uuid.UUID, org_id: uuid.UUID,
                    db: AsyncSession) -> dict:
    """"customers who spent over 150 but haven't ordered in 60 days" -> a rule.

    Anything the field vocabulary cannot express comes back in `unsupported`
    rather than being silently dropped -- a rule that quietly ignores half the
    request is worse than one that says which half it kept.
    """
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        raise ValueError("No AI key configured. Add an Anthropic or OpenAI key in Settings.")

    fields = "\n".join(f"  {k}: {v}" for k, v in RULE_FIELDS.items())
    raw = await call_with_cascade(
        keys=keys, feature="campaign_audience",
        system_prompt=_SYSTEM.format(fields=fields),
        user_prompt=text.strip()[:1000], tier="balanced", weight="light",
        validate=validators.json_object(("rule",)),
        meter={"db": db, "org_id": org_id, "project_id": project_id,
               "feature": "campaign_audience"},
    )
    try:
        parsed = json.loads(_FENCE.sub("", raw or ""))
    except ValueError:
        raise ValueError("That audience could not be interpreted. Try rephrasing it.")

    rule = _clean_rule(parsed.get("rule"))
    if not rule["all"]:
        raise ValueError("No usable filter could be built from that description.")

    return await decorate({
        "key": "custom",
        "label": str(parsed.get("label") or "Custom audience")[:80],
        "definition": str(parsed.get("definition") or text)[:400],
        "rule": rule,
        "unsupported": [str(u)[:200] for u in (parsed.get("unsupported") or [])][:5],
        "source": "natural_language",
        "prompt": text.strip()[:500],
    }, project_id, org_id, db)


def _clean_rule(rule) -> dict:
    """Keep only clauses using a known field and a known operator.

    The prompt forbids inventing fields; this makes it true. A rule carrying a
    field the destination platform has never heard of fails silently there,
    which looks like a campaign that reached nobody for no reason.
    """
    ops = {"=", "!=", ">", ">=", "<", "<=", "in"}
    clauses = []
    for clause in ((rule or {}).get("all") or []):
        if not isinstance(clause, dict):
            continue
        field, op = str(clause.get("field", "")), str(clause.get("op", ""))
        if field in RULE_FIELDS and op in ops and "value" in clause:
            clauses.append({"field": field, "op": op, "value": clause["value"]})
        else:
            logger.info("audience clause dropped: %r", clause)
    return {"all": clauses}


def describe(rule: dict) -> str:
    """The rule, back in words, so the merchant can check it without reading JSON."""
    parts = []
    for c in (rule or {}).get("all", []):
        label = RULE_FIELDS.get(c["field"], c["field"])
        parts.append(f"{label} {c['op']} {c['value']}")
    return " and ".join(parts) or "everyone"
