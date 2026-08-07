"""What happened, why, and what to do — plus the score and the learnings.

THE SHAPE OF AN HONEST ANALYSIS. The example in the product spec is:

    "ROAS dropped 23%. The cause is a 31% rise in CAC from Meta prospecting.
     Reduce prospecting budget by 15% and move €40/day to retargeting."

Every number in that sentence comes from an ad platform. With no ads connector,
producing it would mean inventing all four. So the analyst works the other way
round: it is handed only measured figures, told plainly which questions it
cannot answer, and asked to reason about what IS visible -- attributed revenue,
order counts, AOV, the UTM split, day-over-day movement.

The result is a narrower analysis that is true, instead of a complete-looking
one that is fiction. When the merchant asks why ROAS fell, the answer is "I
cannot see spend; connect Meta Ads" -- which is the useful answer, because it
is followed by a step that fixes it permanently.

THE SCORE IS COMPUTED, NOT GENERATED. Asking a model for "87/100" produces a
number with no relationship to anything. Each component here is a rule over
facts the database holds, so the same campaign always scores the same, and every
point is traceable to a reason the UI can show.
"""
from __future__ import annotations

import json
import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import (Campaign, CampaignAsset, CampaignChannel,
                                 CampaignExperiment, CampaignLearning)
from app.services import campaign_channels as ch
from app.services import campaign_metrics
from app.services.agents.cascade import call_with_cascade, validators
from app.services.llm_service import get_org_llm_keys, project_locale

logger = logging.getLogger(__name__)
_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


# ── the score ────────────────────────────────────────────────────────────────

async def score(campaign: Campaign, db: AsyncSession) -> dict:
    """0-100 across seven components, each with its own reason.

    Weighted so that the parts a merchant controls before launch (strategy,
    audience, offer, creative, tracking) can reach 70 on their own -- a campaign
    that has not run yet is not a failing campaign, it is an unproven one.
    """
    channels = list((await db.execute(select(CampaignChannel).where(
        CampaignChannel.campaign_id == campaign.id))).scalars().all())
    assets = list((await db.execute(select(CampaignAsset).where(
        CampaignAsset.campaign_id == campaign.id))).scalars().all())
    available = await ch.connected_apps(campaign.project_id, campaign.org_id, db)

    parts: list[dict] = []

    def part(key: str, points: int, out_of: int, note: str) -> None:
        parts.append({"key": key, "points": points, "max": out_of, "note": note})

    # Strategy: is there one, and was it grounded in real figures?
    strategy = campaign.strategy or {}
    if not strategy:
        part("strategy", 0, 15, "No strategy generated.")
    elif strategy.get("grounded"):
        part("strategy", 15, 15, "Built on measured store figures.")
    else:
        part("strategy", 8, 15, "Generated, but the store had no synced orders to ground it.")

    # Audience
    audience = campaign.audience or {}
    if not audience:
        part("audience", 0, 15, "No audience defined.")
    elif audience.get("resolvable"):
        part("audience", 15, 15, f"Defined and buildable in {audience.get('resolver')}.")
    else:
        part("audience", 9, 15, "Defined, but no connected system can build the list.")

    # Offer
    offer = campaign.offer or {}
    if offer.get("type") and offer.get("type") != "none":
        part("offer", 12, 12, f"{offer.get('type')} offer set.")
    elif campaign.objective == "brand_awareness":
        part("offer", 12, 12, "No offer needed for an awareness campaign.")
    else:
        part("offer", 4, 12, "No offer set.")

    # Creative: enough written for every channel that was selected
    from app.services.campaign_content import coverage
    cov = await coverage(campaign.id, db)
    missing = sum(len(c["missing"]) for c in cov)
    written = sum(len(c["written"]) for c in cov)
    if not channels:
        part("creative", 0, 18, "No channels, so nothing to write.")
    elif missing == 0 and written:
        part("creative", 18, 18, "Every channel has its content.")
    elif written:
        part("creative", max(4, 18 - missing * 3), 18,
             f"{missing} content type(s) still missing.")
    else:
        part("creative", 0, 18, "No content written yet.")

    # Tracking
    if campaign.slug:
        part("tracking", 10, 10, f"Tagged as utm_campaign={campaign.slug}.")
    else:
        part("tracking", 0, 10, "No tracking tag — this campaign cannot be measured.")

    # Execution: can the channels actually run?
    if not channels:
        part("execution", 0, 10, "No channels selected.")
    else:
        runnable = sum(1 for c in channels if ch.executor_for(c.channel, available))
        part("execution", round(10 * runnable / len(channels)), 10,
             f"{runnable} of {len(channels)} channels can be executed automatically.")

    # Performance: only scored once there is something to measure.
    perf = await campaign_metrics.for_campaign(campaign, db)
    lifetime = perf["lifetime"]
    if campaign.status not in ("running", "completed"):
        part("performance", 0, 0, "Not started.")
    elif not lifetime["orders"]:
        part("performance", 0, 20,
             "No orders carry this campaign's tag yet. Check that live links are tagged.")
    else:
        targets = {t["key"]: t for t in perf["targets"] if t.get("measurable")}
        rev = targets.get("revenue")
        if rev:
            pct = min(rev["pct"], 150) / 150
            part("performance", round(20 * pct), 20,
                 f"{rev['pct']}% of the revenue target.")
        else:
            part("performance", 12, 20,
                 f"{lifetime['orders']} attributed orders, no revenue target set to score against.")

    earned = sum(p["points"] for p in parts)
    possible = sum(p["max"] for p in parts) or 1
    total = round(earned / possible * 100)

    strengths = [p["note"] for p in parts if p["max"] and p["points"] >= p["max"] * 0.9]
    weaknesses = [p["note"] for p in parts if p["max"] and p["points"] <= p["max"] * 0.5]
    return {"score": total, "parts": parts, "strengths": strengths,
            "weaknesses": weaknesses,
            # What the score could not take into account.
            "not_scored": [u["metric"] for u in perf["unavailable"]]}


# ── the analysis ─────────────────────────────────────────────────────────────

_SYSTEM = """You are a campaign analyst for an ecommerce store.

You explain WHAT happened, WHY, and WHAT TO DO. Not a list of numbers.

WHAT YOU MAY NOT DO, and this matters more than being helpful:
- Never state a figure you were not given. You will be told exactly which
  metrics are invisible to you -- spend, ROAS, CAC, CTR, impressions, sessions
  are commonly among them. If a question needs one, say which connector would
  answer it. Do not estimate it, do not infer it from budget, do not proceed as
  if it were roughly some value.
- Never attribute a cause you cannot see. "Prospecting CAC rose" is a claim
  about ad data. Without ad data the honest answer is "revenue fell and I can
  see it fell in <channel>, but I cannot see spend, so I cannot tell you whether
  efficiency or volume caused it."
- Small numbers are not trends. Under 5 attributed orders, say the sample is too
  small rather than reading a pattern into it.
- A recommendation must be an action the merchant can take this week.

Respond with ONLY JSON:
{"headline": "one sentence: the single most important thing",
 "what_happened": "...", "why": "...",
 "recommendations": [{"action": "...", "why": "...", "effort": "low|medium|high",
                      "needs_approval": true|false}],
 "cannot_answer": [{"question": "...", "needs": "the connector that would answer it"}]}"""


def _facts(campaign: Campaign, perf: dict) -> str:
    lines = [
        f"CAMPAIGN: {campaign.name or campaign.goal[:80]}",
        f"OBJECTIVE: {campaign.objective or 'not set'}   STATUS: {campaign.status}",
        f"WINDOW: {perf['window']['start']} to {perf['window']['end']} "
        f"({perf['window']['days']} days)",
        "",
        "MEASURED, from orders whose landing URL carries this campaign's tag:",
        f"  attributed revenue: {perf['lifetime']['revenue']} {perf['currency']}",
        f"  attributed orders: {perf['lifetime']['orders']}",
        f"  average order value: {perf['lifetime']['aov']} {perf['currency']}",
        f"  today: {perf['today']['orders']} orders / {perf['today']['revenue']}",
        f"  yesterday: {perf['yesterday']['orders']} orders / {perf['yesterday']['revenue']}",
    ]
    if perf["budget"]:
        lines.append(f"  budget PLANNED (not spent — nobody reported spend): {perf['budget']}")
        lines.append(f"  revenue divided by planned budget: {perf['revenue_vs_budget']} "
                     "-- this is NOT ROAS and must never be called ROAS")
    if perf["by_source"]:
        lines.append("\nREVENUE BY UTM SOURCE (the campaign's own tagged links):")
        lines += [f"  {r['key']}: {r['revenue']} ({r['orders']} orders)" for r in perf["by_source"]]
    if perf["by_content"] and len(perf["by_content"]) > 1:
        lines.append("\nREVENUE BY LINK VARIANT (utm_content):")
        lines += [f"  {r['key']}: {r['revenue']} ({r['orders']} orders)" for r in perf["by_content"]]

    measurable = [t for t in perf["targets"] if t.get("measurable")]
    if measurable:
        lines.append("\nTARGETS:")
        lines += [f"  {t['key']}: {t['current']} of {t['target']} ({t['pct']}%)" for t in measurable]
    unmeasurable = [t for t in perf["targets"] if not t.get("measurable")]
    if unmeasurable:
        lines.append("\nTARGETS YOU CANNOT SCORE:")
        lines += [f"  {t['key']} (target {t['target']}) — needs {t['needs']}" for t in unmeasurable]

    lines.append("\nYOU CANNOT SEE THESE. Do not use, estimate or imply a value:")
    lines += [f"  {u['metric']} — would come from {u['needs']}" for u in perf["unavailable"]]
    return "\n".join(lines)


async def analyse(campaign: Campaign, db: AsyncSession, *, question: str = "") -> dict:
    """Explain the campaign, optionally answering a specific question."""
    keys = await get_org_llm_keys(campaign.org_id, db)
    if not keys:
        raise ValueError("No AI key configured. Add an Anthropic or OpenAI key in Settings.")

    perf = await campaign_metrics.for_campaign(campaign, db)
    user = _facts(campaign, perf)
    if question:
        user += f"\n\nTHE MERCHANT ASKS: {question.strip()[:500]}"

    raw = await call_with_cascade(
        keys=keys, feature="campaign_analysis", system_prompt=_SYSTEM, user_prompt=user,
        tier="balanced", weight="medium",
        locale=await project_locale(campaign.project_id, db),
        validate=validators.json_object(("headline",)),
        meter={"db": db, "org_id": campaign.org_id, "project_id": campaign.project_id,
               "feature": "campaign_analysis"},
    )
    try:
        out = json.loads(_FENCE.sub("", raw or ""))
    except ValueError:
        raise ValueError("The analysis could not be generated. Try again.")

    # Whatever the model said, these are the questions it genuinely could not
    # answer. Appended rather than trusted, so the list is complete even when
    # the model forgets to mention one.
    known = {c.get("question") for c in (out.get("cannot_answer") or []) if isinstance(c, dict)}
    out["cannot_answer"] = [c for c in (out.get("cannot_answer") or []) if isinstance(c, dict)]
    for u in perf["unavailable"]:
        if u["metric"] not in known:
            out["cannot_answer"].append({"question": f"Anything about {u['metric']}",
                                         "needs": u["needs"]})
    out["measured"] = perf["lifetime"]
    out["sample_warning"] = (perf["lifetime"]["orders"] < campaign_metrics.MIN_ORDERS_FOR_CHANGE)
    return out


# ── optimisation signals ─────────────────────────────────────────────────────

async def signals(campaign: Campaign, db: AsyncSession) -> list[dict]:
    """Rule-based detections over measured figures. No model, no invention.

    These run cheaply and often, so they must not cost a call. Anything needing
    judgement goes to `analyse`; anything needing ad data is simply not here.
    """
    perf = await campaign_metrics.for_campaign(campaign, db)
    out: list[dict] = []
    lifetime, series = perf["lifetime"], perf["series"]

    if campaign.status == "running" and not lifetime["orders"]:
        days = perf["window"]["days"]
        if days >= 3:
            out.append({
                "key": "no_attribution", "severity": "high",
                "title": "No orders carry this campaign's tag",
                "detail": f"{days} days in with nothing attributed. Either the links "
                          f"in market are missing utm_campaign={campaign.slug}, or the "
                          "campaign has not reached anyone yet.",
                "action": "Check that every live link carries the campaign tag.",
            })

    if len(series) >= 8 and lifetime["orders"] >= campaign_metrics.MIN_ORDERS_FOR_CHANGE:
        recent = series[-4:]
        earlier = series[-8:-4]
        r = sum(d["revenue"] for d in recent)
        e = sum(d["revenue"] for d in earlier)
        if e > 0 and r < e * 0.6:
            out.append({
                "key": "revenue_drop", "severity": "high",
                "title": f"Attributed revenue fell {round((1 - r / e) * 100)}% over four days",
                "detail": f"{e:.0f} in the previous four days, {r:.0f} in the last four.",
                "action": "Look at what changed: creative, audience, or the offer's novelty.",
            })
        elif e > 0 and r > e * 1.5:
            out.append({
                "key": "revenue_rise", "severity": "info",
                "title": f"Attributed revenue rose {round((r / e - 1) * 100)}% over four days",
                "detail": f"{e:.0f} then {r:.0f}. Whatever changed is working.",
                "action": "Consider extending the campaign or raising its budget.",
            })

    # Which tagged link is carrying the campaign. Genuinely measured, and the
    # closest honest equivalent of "creative B beat creative A".
    by_content = [r for r in perf["by_content"] if r["key"] != "untagged link"]
    if len(by_content) >= 2 and lifetime["orders"] >= campaign_metrics.MIN_ORDERS_FOR_CHANGE:
        best, worst = by_content[0], by_content[-1]
        if worst["revenue"] > 0 and best["revenue"] >= worst["revenue"] * 2:
            out.append({
                "key": "variant_gap", "severity": "medium",
                "title": f"One link is earning {round(best['revenue'] / worst['revenue'], 1)}x another",
                "detail": f"{best['key']} brought {best['revenue']}, {worst['key']} brought "
                          f"{worst['revenue']}.",
                "action": f"Move effort behind {best['key']}.",
            })

    untagged = next((r for r in perf["by_source"] if r["key"] == "untagged link"), None)
    if untagged and untagged["orders"] >= 3:
        out.append({
            "key": "untagged_links", "severity": "medium",
            "title": f"{untagged['orders']} orders came through links with no source tag",
            "detail": "They count toward the campaign but cannot be split by channel.",
            "action": "Add utm_source to every link the campaign publishes.",
        })

    if perf["budget"] and perf["revenue_vs_budget"] is not None and perf["revenue_vs_budget"] < 1:
        out.append({
            "key": "below_budget", "severity": "info",
            "title": "Attributed revenue is below the planned budget",
            "detail": f"{perf['lifetime']['revenue']} attributed against a {perf['budget']} "
                      "budget. This is not ROAS — nobody has reported what was actually spent.",
            "action": "Connect Meta Ads or Google Ads to compare against real spend.",
        })
    return out


# ── the post-campaign report and its learnings ───────────────────────────────

_REPORT_SYSTEM = """You write the closing report for a finished ecommerce campaign.

Same hard rule as always: never state a figure you were not given, and never
explain a result using data you were told you cannot see.

A learning must be a claim about THIS STORE that would change the next campaign,
and it must be supported by the figures you were given. "Email works well" is
not a learning if no email revenue was measured. If the campaign produced too
little data to learn anything, say so -- an invented lesson gets applied to the
next campaign and compounds.

Respond with ONLY JSON:
{"summary": "two or three sentences",
 "what_worked": ["..."], "what_failed": ["..."],
 "why": "...",
 "repeat": ["..."], "stop": ["..."], "test_next": ["..."],
 "learnings": [{"statement": "...", "evidence": "the figures behind it",
                "confidence": "low|medium|high"}]}"""


async def report(campaign: Campaign, db: AsyncSession, *, persist: bool = True) -> dict:
    """The closing report, and the learnings it earns.

    Learnings are written to the project rather than the campaign, so the next
    campaign's strategy engine reads them. Confidence is capped at the evidence:
    a claim from a campaign with fewer than 5 attributed orders can never be
    stored above "low", whatever the model says about it.
    """
    keys = await get_org_llm_keys(campaign.org_id, db)
    if not keys:
        raise ValueError("No AI key configured.")

    perf = await campaign_metrics.for_campaign(campaign, db)
    scored = await score(campaign, db)
    experiments = list((await db.execute(select(CampaignExperiment).where(
        CampaignExperiment.campaign_id == campaign.id))).scalars().all())

    user = _facts(campaign, perf)
    user += f"\n\nCAMPAIGN SCORE: {scored['score']}/100"
    if scored["weaknesses"]:
        user += "\nWEAK POINTS: " + "; ".join(scored["weaknesses"])
    settled = [e for e in experiments if e.winner]
    if settled:
        user += "\n\nEXPERIMENTS THAT REACHED A RESULT:"
        for e in settled:
            user += f"\n  {e.dimension}: variant {e.winner} won at {e.confidence} confidence"
    unsettled = [e for e in experiments if not e.winner]
    if unsettled:
        user += (f"\n{len(unsettled)} experiment(s) did not reach significance. "
                 "Do not report a winner for those.")

    raw = await call_with_cascade(
        keys=keys, feature="campaign_analysis", system_prompt=_REPORT_SYSTEM,
        user_prompt=user, tier="balanced", weight="medium",
        locale=await project_locale(campaign.project_id, db),
        validate=validators.json_object(("summary",)),
        meter={"db": db, "org_id": campaign.org_id, "project_id": campaign.project_id,
               "feature": "campaign_analysis"},
    )
    try:
        out = json.loads(_FENCE.sub("", raw or ""))
    except ValueError:
        raise ValueError("The report could not be generated. Try again.")

    out["metrics"] = perf
    out["score"] = scored

    if persist:
        thin = perf["lifetime"]["orders"] < campaign_metrics.MIN_ORDERS_FOR_CHANGE
        for item in (out.get("learnings") or [])[:6]:
            if not isinstance(item, dict):
                continue
            statement = str(item.get("statement") or "").strip()
            if not statement:
                continue
            claimed = str(item.get("confidence") or "low").lower()
            confidence = "low" if thin or claimed not in ("low", "medium", "high") else claimed
            db.add(CampaignLearning(
                org_id=campaign.org_id, project_id=campaign.project_id,
                campaign_id=campaign.id, statement=statement[:1000],
                evidence={"note": str(item.get("evidence") or "")[:600],
                          "attributed_orders": perf["lifetime"]["orders"],
                          "attributed_revenue": perf["lifetime"]["revenue"]},
                confidence=confidence,
                tags=[campaign.objective] if campaign.objective else None,
                source="post_campaign"))
        await db.flush()
    return out


async def learnings(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    rows = (await db.execute(select(CampaignLearning).where(
        CampaignLearning.project_id == project_id, CampaignLearning.org_id == org_id,
        CampaignLearning.dismissed.is_(False),
    ).order_by(CampaignLearning.created_at.desc()))).scalars().all()
    return [{"id": str(r.id), "statement": r.statement, "confidence": r.confidence,
             "evidence": r.evidence, "tags": r.tags, "source": r.source,
             "campaign_id": str(r.campaign_id) if r.campaign_id else None,
             "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in rows]
