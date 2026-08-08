"""Campaign OS endpoints.

EVERY NESTED RESOURCE IS REACHED THROUGH ITS CAMPAIGN. A channel, asset, task or
approval is addressed as /campaigns/{campaign_id}/... and never by its own id at
the top level. One ownership check on the campaign then covers everything under
it, which is both simpler than repeating the check and impossible to forget --
the shape of the URL enforces it. A cross-tenant read here would be someone
else's revenue figures; a cross-tenant write would be someone else's ad budget.

Missing rows return 404 rather than 403, including when the row exists but
belongs to another org. A 403 confirms the id is real, which turns this into an
enumeration oracle.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import arq
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.campaign import (Campaign, CampaignApproval, CampaignAsset,
                                 CampaignChannel, CampaignExperiment, CampaignLearning,
                                 CampaignStep, CampaignTask)
from app.services import (campaign_analyst, campaign_audience, campaign_calendar_sync,
                          campaign_channels, campaign_content, campaign_metrics,
                          campaign_personas, campaign_readiness, campaign_strategy,
                          campaign_team, campaign_templates, campaign_tracking)
from app.services.campaign_director import draft_plan

router = APIRouter()


# ── serialisation ────────────────────────────────────────────────────────────

def _step(s: CampaignStep) -> dict:
    return {"id": str(s.id), "order": s.order, "agent": s.agent, "action": s.action,
            "brief": s.brief, "why": s.why, "status": s.status, "summary": s.summary,
            "artifact_type": s.artifact_type, "artifact_ids": s.artifact_ids,
            "structured": s.structured, "error": s.error,
            "started_at": s.started_at, "finished_at": s.finished_at}


def _channel(c: CampaignChannel) -> dict:
    return {"id": str(c.id), "channel": c.channel, "connector_app": c.connector_app,
            "status": c.status, "role": c.role,
            "budget_share": float(c.budget_share) if c.budget_share is not None else None,
            "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None,
            "config": c.config, "external_ref": c.external_ref, "last_error": c.last_error}


def _asset(a: CampaignAsset) -> dict:
    return {"id": str(a.id), "channel_id": str(a.channel_id) if a.channel_id else None,
            "kind": a.kind, "variant": a.variant, "body": a.body,
            "image_id": str(a.image_id) if a.image_id else None,
            "meta": a.meta, "status": a.status, "selected": a.selected}


def _task(t: CampaignTask) -> dict:
    return {"id": str(t.id), "day_offset": t.day_offset, "title": t.title,
            "detail": t.detail, "owner": t.owner, "channel": t.channel,
            "status": t.status, "due_at": t.due_at.isoformat() if t.due_at else None}


def _approval(a: CampaignApproval) -> dict:
    return {"id": str(a.id), "action": a.action, "label": campaign_channels.APPROVAL_LABELS.get(a.action, a.action),
            "channel_id": str(a.channel_id) if a.channel_id else None,
            "preview": a.preview, "payload": a.payload, "state": a.state,
            "note": a.note,
            "decided_at": a.decided_at.isoformat() if a.decided_at else None}


def _experiment(e: CampaignExperiment) -> dict:
    return {"id": str(e.id), "dimension": e.dimension, "hypothesis": e.hypothesis,
            "variant_a_id": str(e.variant_a_id) if e.variant_a_id else None,
            "variant_b_id": str(e.variant_b_id) if e.variant_b_id else None,
            "metric": e.metric, "status": e.status,
            "a": {"trials": e.a_trials, "wins": e.a_wins,
                  "value": float(e.a_value) if e.a_value is not None else None},
            "b": {"trials": e.b_trials, "wins": e.b_wins,
                  "value": float(e.b_value) if e.b_value is not None else None},
            "winner": e.winner,
            "confidence": float(e.confidence) if e.confidence is not None else None,
            "revenue_impact": float(e.revenue_impact) if e.revenue_impact is not None else None}


def _campaign(c: Campaign, steps: list[CampaignStep] | None = None) -> dict:
    return {
        "id": str(c.id), "goal": c.goal, "name": c.name or c.goal[:80],
        "description": c.description, "objective": c.objective,
        "persona": c.persona, "status": c.status, "slug": c.slug,
        "director_summary": c.director_summary, "brief_summary": c.brief_summary,
        "source": c.source, "template_key": c.template_key,
        "week_of": c.week_of.isoformat() if c.week_of else None,
        "product_ids": c.product_ids or [], "collections": c.collections or [],
        "audience": c.audience, "offer": c.offer,
        "budget": {"amount": float(c.budget_amount) if c.budget_amount is not None else None,
                   "currency": c.budget_currency},
        "starts_on": c.starts_on.isoformat() if c.starts_on else None,
        "ends_on": c.ends_on.isoformat() if c.ends_on else None,
        "primary_kpi": c.primary_kpi, "secondary_kpis": c.secondary_kpis or [],
        "targets": c.targets or {}, "strategy": c.strategy,
        "score": c.score, "score_detail": c.score_detail,
        "approval_state": c.approval_state, "autopilot": c.autopilot,
        "launched_at": c.launched_at.isoformat() if c.launched_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "steps": [_step(s) for s in sorted(steps, key=lambda x: x.order)] if steps is not None else [],
    }


# ── loading, always org-scoped ───────────────────────────────────────────────

async def _load(campaign_id: uuid.UUID, org_id: uuid.UUID, db) -> Campaign:
    c = (await db.execute(select(Campaign).where(
        Campaign.id == campaign_id, Campaign.org_id == org_id))).scalars().first()
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    return c


async def _steps(campaign_id, db) -> list[CampaignStep]:
    return list((await db.execute(select(CampaignStep).where(
        CampaignStep.campaign_id == campaign_id))).scalars().all())


async def _child(model, child_id: uuid.UUID, campaign: Campaign, db):
    """A row under this campaign, or 404. The campaign was already ownership-checked."""
    row = (await db.execute(select(model).where(
        model.id == child_id, model.campaign_id == campaign.id))).scalars().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return row


async def _project_or_404(project_id: uuid.UUID, org_id: uuid.UUID, db):
    from app.models.project import Project
    proj = await db.get(Project, project_id)
    if proj is None or proj.org_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return proj


# ── bodies ───────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    goal: str
    name: str | None = None
    objective: str | None = None
    template_key: str | None = None
    # When true the strategy engine runs and the campaign is created fully
    # briefed. When false it is a blank campaign the merchant fills in.
    with_ai: bool = True
    starts_on: date | None = None
    budget: float | None = None
    currency: str | None = None


class CampaignPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    objective: str | None = None
    goal: str | None = None
    product_ids: list[str] | None = None
    collections: list[str] | None = None
    audience: dict | None = None
    offer: dict | None = None
    budget_amount: float | None = None
    budget_currency: str | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    primary_kpi: str | None = None
    secondary_kpis: list[str] | None = None
    targets: dict | None = None
    autopilot: bool | None = None


class ChannelBody(BaseModel):
    channel: str
    role: str | None = None
    budget_share: float | None = None
    scheduled_at: datetime | None = None
    config: dict | None = None


class ContentBody(BaseModel):
    kinds: list[str] = Field(default_factory=list)
    angle: str = ""


class RefineBody(BaseModel):
    action: str
    locale: str = ""


class AssetPatch(BaseModel):
    body: str | None = None
    status: str | None = None
    selected: bool | None = None


class TaskBody(BaseModel):
    title: str
    day_offset: int = 0
    detail: str | None = None
    owner: str | None = None
    channel: str | None = None
    status: str | None = None


class AudienceText(BaseModel):
    text: str


class ApprovalDecision(BaseModel):
    approve: bool
    note: str | None = None


class AskBody(BaseModel):
    question: str = ""


class ExperimentBody(BaseModel):
    dimension: str
    hypothesis: str | None = None
    variant_a_id: uuid.UUID | None = None
    variant_b_id: uuid.UUID | None = None
    metric: str | None = None


class ExperimentResult(BaseModel):
    a_trials: int = 0
    a_wins: int = 0
    a_value: float | None = None
    b_trials: int = 0
    b_wins: int = 0
    b_value: float | None = None


# ── catalogues (no campaign yet) ─────────────────────────────────────────────

@router.get("/personas")
async def persona_profile(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """What a campaign means for THIS project.

    Objectives, and whether revenue is the outcome. A creator asked to "clear
    inventory" is being offered a product that does not know what they do.
    """
    proj = await _project_or_404(project_id, current_user.org_id, db)
    p = campaign_personas.profile(proj.persona)
    return {"key": p.key, "label": p.label, "outcome": p.outcome,
            "objectives": campaign_personas.objectives_for(proj.persona),
            "measuresRevenue": campaign_personas.measures_revenue(proj.persona),
            "measuredBy": campaign_personas.OUTCOME_MEASURED_BY[p.outcome]}


@router.get("/templates")
async def templates(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    proj = await _project_or_404(project_id, current_user.org_id, db)
    allowed = set(campaign_personas.profile(proj.persona).templates)
    return [t for t in campaign_templates.catalogue() if t["key"] in allowed]


@router.get("/channels")
async def channels_catalogue(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    proj = await _project_or_404(project_id, current_user.org_id, db)
    available = await campaign_channels.connected_apps(project_id, current_user.org_id, db)
    allowed = set(campaign_personas.profile(proj.persona).channels)
    return [c for c in campaign_channels.catalogue(available) if c["key"] in allowed]


@router.get("/audiences")
async def audiences(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _project_or_404(project_id, current_user.org_id, db)
    return [await campaign_audience.decorate(p, project_id, current_user.org_id, db)
            for p in campaign_audience.presets()]


@router.post("/audiences/interpret")
async def interpret_audience(project_id: uuid.UUID, body: AudienceText,
                             current_user: CurrentUser, db: DB):
    """Natural language to a structured audience rule."""
    await _project_or_404(project_id, current_user.org_id, db)
    try:
        return await campaign_audience.from_text(body.text, project_id, current_user.org_id, db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.get("/learnings")
async def project_learnings(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _project_or_404(project_id, current_user.org_id, db)
    return await campaign_analyst.learnings(project_id, current_user.org_id, db)


@router.get("/overview")
async def overview(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """The command centre's numbers. Counts and money computed separately."""
    await _project_or_404(project_id, current_user.org_id, db)
    return await campaign_metrics.portfolio(project_id, current_user.org_id, db)


@router.get("/calendar")
async def calendar(project_id: uuid.UUID, current_user: CurrentUser, db: DB,
                   days: int = 60):
    """Campaigns and their dated tasks, plus overlaps worth knowing about.

    A conflict is two campaigns live on the same day aiming at the same audience
    -- which is the case where they compete for the same inbox. Two campaigns on
    different audiences overlapping is normal and is not reported.
    """
    await _project_or_404(project_id, current_user.org_id, db)
    today = datetime.now(timezone.utc).date()
    horizon = today + timedelta(days=days)

    rows = (await db.execute(select(Campaign).where(
        Campaign.project_id == project_id, Campaign.org_id == current_user.org_id,
        Campaign.status.notin_(("archived", "draft")),
    ))).scalars().all()

    live = [c for c in rows if c.starts_on and c.starts_on <= horizon]
    entries = []
    for c in live:
        tasks = list((await db.execute(select(CampaignTask).where(
            CampaignTask.campaign_id == c.id))).scalars().all())
        entries.append({
            "id": str(c.id), "name": c.name or c.goal[:80], "status": c.status,
            "starts_on": c.starts_on.isoformat() if c.starts_on else None,
            "ends_on": c.ends_on.isoformat() if c.ends_on else None,
            "objective": c.objective,
            "audience": (c.audience or {}).get("key"),
            "tasks": [{**_task(t),
                       "date": (c.starts_on + timedelta(days=t.day_offset)).isoformat()
                       if c.starts_on else None} for t in tasks],
        })

    conflicts = []
    for i, a in enumerate(live):
        for b in live[i + 1:]:
            if not (a.starts_on and b.starts_on):
                continue
            a_end = a.ends_on or a.starts_on
            b_end = b.ends_on or b.starts_on
            if a.starts_on > b_end or b.starts_on > a_end:
                continue
            a_aud = (a.audience or {}).get("key")
            b_aud = (b.audience or {}).get("key")
            if a_aud and a_aud == b_aud:
                conflicts.append({
                    "campaigns": [str(a.id), str(b.id)],
                    "names": [a.name or a.goal[:60], b.name or b.goal[:60]],
                    "audience": a_aud,
                    "from": max(a.starts_on, b.starts_on).isoformat(),
                    "to": min(a_end, b_end).isoformat(),
                    "message": "Both campaigns target the same audience over the same days.",
                })
    return {"entries": entries, "conflicts": conflicts}


# ── the campaign ─────────────────────────────────────────────────────────────

@router.get("")
async def list_campaigns(project_id: uuid.UUID, current_user: CurrentUser, db: DB,
                         status_filter: str | None = None, objective: str | None = None,
                         channel: str | None = None, q: str | None = None):
    await _project_or_404(project_id, current_user.org_id, db)
    stmt = select(Campaign).where(Campaign.project_id == project_id,
                                  Campaign.org_id == current_user.org_id)
    if status_filter:
        stmt = stmt.where(Campaign.status.in_(status_filter.split(",")))
    if objective:
        stmt = stmt.where(Campaign.objective == objective)
    rows = (await db.execute(stmt.order_by(Campaign.created_at.desc()))).scalars().all()

    needle = (q or "").strip().lower()
    out = []
    for c in rows:
        if needle and needle not in (c.name or "").lower() and needle not in c.goal.lower():
            continue
        item = _campaign(c)
        chans = list((await db.execute(select(CampaignChannel).where(
            CampaignChannel.campaign_id == c.id))).scalars().all())
        if channel and channel not in {x.channel for x in chans}:
            continue
        item["channels"] = [_channel(x) for x in chans]
        # The list needs money per row; the full metric payload does not belong
        # in a list response, so only the totals are computed here.
        orders = await campaign_metrics.attributed_orders(c, db)
        item["performance"] = {"revenue": round(sum(float(o.total_price or 0) for o in orders), 2),
                               "orders": len(orders)}
        out.append(item)
    return out


@router.post("", status_code=201)
async def create_campaign(project_id: uuid.UUID, body: CampaignCreate,
                          current_user: CurrentUser, db: DB):
    """Create a campaign, optionally briefed by the strategy engine.

    The old behaviour -- draft an agent playbook from the goal -- is preserved
    for campaigns created without an objective, because the autopilot and the
    delegate flow still create those.
    """
    proj = await _project_or_404(project_id, current_user.org_id, db)
    persona = proj.persona or "creator"

    template = campaign_templates.TEMPLATES.get(body.template_key or "")
    objective = body.objective or (template.objective if template else None)

    campaign = Campaign(
        org_id=current_user.org_id, project_id=project_id, goal=body.goal,
        name=(body.name or (template.label if template else None) or body.goal[:80]),
        persona=persona, status="draft", objective=objective,
        template_key=template.key if template else None,
        source="template" if template else "manual",
        starts_on=body.starts_on,
        budget_amount=body.budget, budget_currency=body.currency or "EUR",
        primary_kpi=template.primary_kpi if template else None,
    )
    if template and body.starts_on:
        campaign.ends_on = body.starts_on + timedelta(days=template.duration_days)
    db.add(campaign)
    await db.flush()

    if template:
        for offset, title, owner in template.timeline:
            db.add(CampaignTask(campaign_id=campaign.id, day_offset=offset,
                                title=title, owner=owner or None))
        for key in template.channels:
            db.add(CampaignChannel(campaign_id=campaign.id, channel=key,
                                   config={"owner": campaign_team.owner_for(key)}))
        if template.audience_key:
            preset = campaign_audience.preset(template.audience_key)
            if preset:
                campaign.audience = await campaign_audience.decorate(
                    preset, project_id, current_user.org_id, db)

    if body.with_ai and objective:
        try:
            plan = await campaign_strategy.draft(
                project_id, current_user.org_id, body.goal, objective, db,
                hint={"budget": f"{body.budget} {body.currency or 'EUR'}" if body.budget else "",
                      "starts_on": body.starts_on.isoformat() if body.starts_on else "",
                      "template": template.label if template else ""},
                persona=persona)
            await _apply_strategy(campaign, plan, db, replace_channels=not template)
            campaign.status = "planning"
        except ValueError as exc:
            # A missing AI key must not lose the campaign the merchant just
            # created. It is saved unbriefed, and the message says why.
            await db.commit()
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    elif not objective:
        # Legacy path: the agent playbook.
        try:
            plan = await draft_plan(project_id, current_user.org_id, body.goal, persona, db)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
        campaign.director_summary = plan.get("summary")
        campaign.status = "ready"
        for i, s in enumerate(plan["steps"]):
            db.add(CampaignStep(campaign_id=campaign.id, order=i, agent=s["agent"],
                                action=s["action"], brief=s.get("brief") or {},
                                why=s.get("why"), status="pending"))

    # After the strategy has named it, so the tag reads as the campaign's name
    # rather than the whole sentence the merchant typed. Still generated once
    # and never editable afterwards -- see campaign_tracking.
    campaign.slug = await campaign_tracking.unique_slug(
        project_id, campaign.name or body.goal, db, exclude=campaign.id)
    await db.commit()
    return await _full(campaign, db)


async def _apply_strategy(campaign: Campaign, plan: dict, db, *,
                          replace_channels: bool = True) -> None:
    """Write a strategy onto the campaign: brief, channels, timeline."""
    campaign.strategy = plan
    campaign.brief_summary = str(plan.get("summary") or "")[:2000]
    if plan.get("name"):
        campaign.name = str(plan["name"])[:160]
    if plan.get("audience"):
        # Through decorate(), not straight onto the column: an audience without
        # the resolvability answer renders as neither buildable nor explained.
        campaign.audience = await campaign_audience.decorate(
            {**(campaign.audience or {}), **plan["audience"], "source": "strategy"},
            campaign.project_id, campaign.org_id, db)
    if plan.get("offer"):
        campaign.offer = plan["offer"]
    if plan.get("primary_kpi"):
        campaign.primary_kpi = str(plan["primary_kpi"])[:30]
    if plan.get("secondary_kpis"):
        campaign.secondary_kpis = [str(k)[:30] for k in plan["secondary_kpis"]][:5]
    if plan.get("targets"):
        campaign.targets = {k: v for k, v in plan["targets"].items()
                            if isinstance(v, (int, float))}
    budget = plan.get("budget") or {}
    if campaign.budget_amount is None and isinstance(budget.get("amount"), (int, float)):
        campaign.budget_amount = budget["amount"]
        campaign.budget_currency = str(budget.get("currency") or "EUR")[:10]

    if replace_channels:
        existing = list((await db.execute(select(CampaignChannel).where(
            CampaignChannel.campaign_id == campaign.id))).scalars().all())
        have = {c.channel for c in existing}
        for c in plan.get("channels") or []:
            if c["channel"] in have:
                continue
            db.add(CampaignChannel(
                campaign_id=campaign.id, channel=c["channel"],
                role=c.get("role") or None, budget_share=c.get("budget_share"),
                # Who on the team owns this channel's work. Kept on the row so
                # it survives the strategy being regenerated or edited.
                config={k: v for k, v in (("why", c.get("why")), ("owner", c.get("owner")))
                        if v}))

    existing_tasks = (await db.execute(select(CampaignTask).where(
        CampaignTask.campaign_id == campaign.id))).scalars().first()
    if existing_tasks is None:
        for t in plan.get("timeline") or []:
            db.add(CampaignTask(campaign_id=campaign.id, day_offset=t["day_offset"],
                                title=t["title"], detail=t.get("detail") or None,
                                owner=t.get("owner") or None,
                                channel=t.get("channel") or None))
    await db.flush()


async def _full(campaign: Campaign, db) -> dict:
    out = _campaign(campaign, await _steps(campaign.id, db))
    for key, model, ser in (("channels", CampaignChannel, _channel),
                            ("assets", CampaignAsset, _asset),
                            ("tasks", CampaignTask, _task),
                            ("approvals", CampaignApproval, _approval),
                            ("experiments", CampaignExperiment, _experiment)):
        rows = (await db.execute(select(model).where(
            model.campaign_id == campaign.id))).scalars().all()
        out[key] = [ser(r) for r in rows]
    out["tasks"].sort(key=lambda t: t["day_offset"])
    out["team"] = await campaign_team.build(campaign.id, db)
    return out


@router.get("/{campaign_id}")
async def get_campaign(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await _full(await _load(campaign_id, current_user.org_id, db), db)


@router.patch("/{campaign_id}")
async def patch_campaign(campaign_id: uuid.UUID, body: CampaignPatch,
                         current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(c, field, value)
    if "starts_on" in data:
        # The whole timeline is relative to the start, so moving it moves every
        # mirrored entry rather than leaving them at the old dates.
        await db.flush()
        await campaign_calendar_sync.sync_quietly(c.id, db)
    # The slug is deliberately not patchable. See campaign_tracking's docstring:
    # changing it after launch does not move the attributed revenue, it removes
    # it from both the old tag and the new.
    await db.commit()
    return await _full(c, db)


@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Delete a campaign and everything under it.

    Channels, assets, tasks, approvals and experiments go with it through the
    foreign keys. Two things do not, and both are deliberate:

    Its LEARNINGS survive, with campaign_id set to NULL. A learning is a claim
    about the store that outlived the campaign that produced it -- deleting a
    finished campaign should not un-learn what it taught, only lose the
    provenance link.

    Its CALENDAR ENTRIES do not survive, and are removed here rather than by a
    cascade: they are mirrored rows keyed on the campaign's tasks, and a
    database-level cascade from tasks to calendar entries does not exist. Left
    behind, they are steps on the calendar for a campaign that no longer is.

    A running campaign is refused. Deleting something mid-flight loses the work
    in progress with no way to tell what was lost; archive it instead.
    """
    c = await _load(campaign_id, current_user.org_id, db)
    if c.status == "running":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This campaign is running. Pause or complete it before deleting, "
            "or archive it to keep its record.")

    task_ids = [t.id for t in (await db.execute(select(CampaignTask).where(
        CampaignTask.campaign_id == c.id))).scalars().all()]
    if task_ids:
        from app.models.calendar_entry import CalendarEntry
        for entry in (await db.execute(select(CalendarEntry).where(
            CalendarEntry.project_id == c.project_id,
            CalendarEntry.content_type == "campaign_task",
            CalendarEntry.content_id.in_(task_ids),
        ))).scalars().all():
            await db.delete(entry)

    await db.delete(c)
    await db.commit()


@router.post("/{campaign_id}/strategy")
async def regenerate_strategy(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Re-run the strategy engine over the current store figures."""
    c = await _load(campaign_id, current_user.org_id, db)
    if c.status in ("running", "completed", "archived"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "A campaign that has launched cannot be re-planned.")
    try:
        plan = await campaign_strategy.draft(
            c.project_id, current_user.org_id, c.goal, c.objective or "custom", db,
            persona=c.persona)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    await _apply_strategy(c, plan, db)
    if c.status == "draft":
        c.status = "planning"
    await db.commit()
    return await _full(c, db)


# ── channels ─────────────────────────────────────────────────────────────────

@router.post("/{campaign_id}/channels", status_code=201)
async def add_channel(campaign_id: uuid.UUID, body: ChannelBody,
                      current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if body.channel not in campaign_channels.CHANNELS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown channel {body.channel}")
    if not campaign_personas.allows_channel(c.persona, body.channel):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"{body.channel} does not apply to a {c.persona} project.")
    existing = (await db.execute(select(CampaignChannel).where(
        CampaignChannel.campaign_id == c.id,
        CampaignChannel.channel == body.channel))).scalars().first()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That channel is already on this campaign.")
    row = CampaignChannel(campaign_id=c.id, channel=body.channel, role=body.role,
                          budget_share=body.budget_share, scheduled_at=body.scheduled_at,
                          config=body.config)
    db.add(row)
    await db.commit()
    return _channel(row)


@router.patch("/{campaign_id}/channels/{channel_id}")
async def patch_channel(campaign_id: uuid.UUID, channel_id: uuid.UUID, body: ChannelBody,
                        current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    row = await _child(CampaignChannel, channel_id, c, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "channel":
            continue        # moving a row between channels would orphan its assets
        setattr(row, field, value)
    await db.commit()
    return _channel(row)


@router.delete("/{campaign_id}/channels/{channel_id}", status_code=204)
async def delete_channel(campaign_id: uuid.UUID, channel_id: uuid.UUID,
                         current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    await db.delete(await _child(CampaignChannel, channel_id, c, db))
    await db.commit()


# ── content ──────────────────────────────────────────────────────────────────

@router.post("/{campaign_id}/channels/{channel_id}/content", status_code=201)
async def generate_content(campaign_id: uuid.UUID, channel_id: uuid.UUID,
                           body: ContentBody, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    channel = await _child(CampaignChannel, channel_id, c, db)
    try:
        created = await campaign_content.generate(c, channel, body.kinds, db, angle=body.angle)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    await db.commit()
    return [_asset(a) for a in created]


@router.get("/{campaign_id}/team")
async def team(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Which agents are working on this campaign, and on what."""
    c = await _load(campaign_id, current_user.org_id, db)
    return await campaign_team.build(c.id, db)


@router.get("/{campaign_id}/coverage")
async def content_coverage(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    return await campaign_content.coverage(c.id, db)


@router.post("/{campaign_id}/assets/{asset_id}/refine")
async def refine_asset(campaign_id: uuid.UUID, asset_id: uuid.UUID, body: RefineBody,
                       current_user: CurrentUser, db: DB):
    """Rewrite a variant. The result is a NEW row, so the original survives."""
    c = await _load(campaign_id, current_user.org_id, db)
    asset = await _child(CampaignAsset, asset_id, c, db)
    try:
        text = await campaign_content.refine(asset, c, body.action, db,
                                             target_locale=body.locale)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    fresh = CampaignAsset(campaign_id=c.id, channel_id=asset.channel_id, kind=asset.kind,
                          variant=asset.variant, body=text[:4000],
                          meta={**(asset.meta or {}), "refined_from": str(asset.id),
                                "refinement": body.action})
    db.add(fresh)
    await db.commit()
    return _asset(fresh)


@router.patch("/{campaign_id}/assets/{asset_id}")
async def patch_asset(campaign_id: uuid.UUID, asset_id: uuid.UUID, body: AssetPatch,
                      current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    asset = await _child(CampaignAsset, asset_id, c, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(asset, field, value)
    await db.commit()
    return _asset(asset)


@router.delete("/{campaign_id}/assets/{asset_id}", status_code=204)
async def delete_asset(campaign_id: uuid.UUID, asset_id: uuid.UUID,
                       current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    await db.delete(await _child(CampaignAsset, asset_id, c, db))
    await db.commit()


# ── timeline ─────────────────────────────────────────────────────────────────

@router.post("/{campaign_id}/tasks", status_code=201)
async def add_task(campaign_id: uuid.UUID, body: TaskBody,
                   current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    row = CampaignTask(campaign_id=c.id, title=body.title, day_offset=body.day_offset,
                       detail=body.detail, owner=body.owner, channel=body.channel)
    db.add(row)
    await db.flush()
    await campaign_calendar_sync.sync_quietly(c.id, db)
    await db.commit()
    return _task(row)


@router.patch("/{campaign_id}/tasks/{task_id}")
async def patch_task(campaign_id: uuid.UUID, task_id: uuid.UUID, body: TaskBody,
                     current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    row = await _child(CampaignTask, task_id, c, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.flush()
    await campaign_calendar_sync.sync_quietly(c.id, db)
    await db.commit()
    return _task(row)


@router.delete("/{campaign_id}/tasks/{task_id}", status_code=204)
async def delete_task(campaign_id: uuid.UUID, task_id: uuid.UUID,
                      current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    await db.delete(await _child(CampaignTask, task_id, c, db))
    await db.flush()
    await campaign_calendar_sync.sync_quietly(c.id, db)
    await db.commit()


# ── tracking, readiness, launch ──────────────────────────────────────────────

@router.get("/{campaign_id}/tracking")
async def tracking(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB,
                   base_url: str = ""):
    c = await _load(campaign_id, current_user.org_id, db)
    chans = list((await db.execute(select(CampaignChannel).where(
        CampaignChannel.campaign_id == c.id))).scalars().all())
    if not base_url:
        from app.models.project import Project
        proj = await db.get(Project, c.project_id)
        base_url = getattr(proj, "domain", "") or getattr(proj, "url", "") or ""
    return campaign_tracking.plan_for(c, chans, base_url)


@router.post("/{campaign_id}/calendar-sync")
async def calendar_sync(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Mirror this campaign's timeline onto the content calendar."""
    c = await _load(campaign_id, current_user.org_id, db)
    written = await campaign_calendar_sync.sync(c, db)
    await db.commit()
    return {"entries": written, "starts_on": c.starts_on.isoformat() if c.starts_on else None}


@router.get("/{campaign_id}/readiness")
async def readiness(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    return await campaign_readiness.check(c, db)


@router.post("/{campaign_id}/review")
async def send_for_review(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Move to review, and raise one approval request per consequential action.

    The preview text is written here rather than by the caller: an approval whose
    consequences are described by the thing requesting it is not a control.
    """
    c = await _load(campaign_id, current_user.org_id, db)
    chans = list((await db.execute(select(CampaignChannel).where(
        CampaignChannel.campaign_id == c.id))).scalars().all())

    needed: dict[str, list[str]] = {}
    for ch_row in chans:
        cdef = campaign_channels.CHANNELS.get(ch_row.channel)
        if cdef is None:
            continue
        for act in cdef.approvals:
            needed.setdefault(act, []).append(cdef.label)

    existing = {a.action for a in (await db.execute(select(CampaignApproval).where(
        CampaignApproval.campaign_id == c.id,
        CampaignApproval.state == "pending"))).scalars().all()}

    budget = f"{c.budget_amount} {c.budget_currency or ''}".strip() if c.budget_amount else "no budget set"
    audience = (c.audience or {}).get("label") or "an audience that is not yet defined"
    for action, labels in needed.items():
        if action in existing:
            continue
        where = ", ".join(sorted(set(labels)))
        if action == campaign_channels.ACT_SPEND:
            preview = f"Spend up to {budget} across {where}."
        elif action == campaign_channels.ACT_LAUNCH_ADS:
            preview = f"Create and start live ads on {where}, targeting {audience}."
        elif action == campaign_channels.ACT_SEND_EMAIL:
            preview = f"Send campaign email to {audience} via {where}."
        elif action == campaign_channels.ACT_SEND_SMS:
            preview = f"Send campaign SMS to {audience}."
        elif action == campaign_channels.ACT_CREATE_DISCOUNT:
            # The offer's value is a bare number more often than not ("10"),
            # and "Create 10 as a discount code" is not a sentence anyone can
            # approve. The type supplies the unit the value is missing.
            offer = c.offer or {}
            value, kind = str(offer.get("value") or "").strip(), offer.get("type") or ""
            if value and kind == "discount":
                what = f"a {value}% discount code" if value.isdigit() else f"a {value} discount code"
            elif value:
                what = f"{value} ({kind})" if kind and kind != "none" else value
            else:
                what = "a discount code"
            preview = f"Create {what} in your store."
        elif action == campaign_channels.ACT_CHANGE_PRICE:
            preview = "Change product prices in your store."
        else:
            preview = f"{campaign_channels.APPROVAL_LABELS.get(action, action)} on {where}."
        db.add(CampaignApproval(campaign_id=c.id, action=action, preview=preview,
                                requested_by=current_user.id,
                                payload={"channels": sorted(set(labels))}))

    c.approval_state = "review"
    await db.commit()
    return await _full(c, db)


@router.get("/{campaign_id}/approvals")
async def list_approvals(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    rows = (await db.execute(select(CampaignApproval).where(
        CampaignApproval.campaign_id == c.id))).scalars().all()
    return [_approval(a) for a in rows]


@router.post("/{campaign_id}/approvals/{approval_id}")
async def decide_approval(campaign_id: uuid.UUID, approval_id: uuid.UUID,
                          body: ApprovalDecision, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    row = await _child(CampaignApproval, approval_id, c, db)
    if row.state != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That decision has already been made.")
    row.state = "approved" if body.approve else "rejected"
    row.decided_by = current_user.id
    row.decided_at = datetime.now(timezone.utc)
    row.note = body.note

    outstanding = [a for a in (await db.execute(select(CampaignApproval).where(
        CampaignApproval.campaign_id == c.id))).scalars().all() if a.state == "pending"]
    if not body.approve:
        c.approval_state = "rejected"
    elif not outstanding:
        c.approval_state = "approved"
        c.approved_by = current_user.id
        c.approved_at = datetime.now(timezone.utc)
    await db.commit()
    return await _full(c, db)


@router.post("/{campaign_id}/launch")
async def launch(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Go live — refused while any blocker stands."""
    c = await _load(campaign_id, current_user.org_id, db)
    if c.status in ("running", "completed", "archived"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Campaign is already {c.status}.")

    check = await campaign_readiness.check(c, db)
    if not check["ready"]:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"message": "This campaign cannot launch yet.",
                             "blockers": check["blockers"]})

    now = datetime.now(timezone.utc)
    c.status = "running"
    c.launched_at = now
    if not c.starts_on:
        c.starts_on = now.date()
    for ch_row in (await db.execute(select(CampaignChannel).where(
            CampaignChannel.campaign_id == c.id))).scalars().all():
        # `live` means Fennex considers it launched. It does not claim the
        # external platform was called -- that happens when a connector exists,
        # and the channel's external_ref stays null until it does.
        ch_row.status = "live"
    await db.flush()
    await campaign_calendar_sync.sync_quietly(c.id, db)
    await db.commit()
    return await _full(c, db)


class StatusBody(BaseModel):
    status: str


@router.post("/{campaign_id}/status")
async def set_status(campaign_id: uuid.UUID, body: StatusBody,
                     current_user: CurrentUser, db: DB):
    """Pause, resume, complete or archive."""
    allowed = {"paused", "running", "completed", "archived", "ready", "scheduled"}
    if body.status not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown status {body.status}")
    c = await _load(campaign_id, current_user.org_id, db)
    if body.status == "running" and c.status != "paused":
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Only a paused campaign can be resumed. Use launch to go live.")
    c.status = body.status
    await db.commit()
    return await _full(c, db)


# ── performance and analysis ─────────────────────────────────────────────────

@router.get("/{campaign_id}/performance")
async def performance(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    return await campaign_metrics.for_campaign(c, db)


@router.get("/{campaign_id}/signals")
async def signals(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Rule-based optimisation detections. No model call, so it is free to poll."""
    c = await _load(campaign_id, current_user.org_id, db)
    return await campaign_analyst.signals(c, db)


@router.get("/{campaign_id}/score")
async def campaign_score(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    result = await campaign_analyst.score(c, db)
    c.score = result["score"]
    c.score_detail = result
    await db.commit()
    return result


@router.post("/{campaign_id}/analyse")
async def analyse(campaign_id: uuid.UUID, body: AskBody,
                  current_user: CurrentUser, db: DB):
    """The campaign copilot: what happened, why, what to do."""
    c = await _load(campaign_id, current_user.org_id, db)
    try:
        return await campaign_analyst.analyse(c, db, question=body.question)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


@router.post("/{campaign_id}/report")
async def report(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Close the campaign and write what it taught."""
    c = await _load(campaign_id, current_user.org_id, db)
    try:
        out = await campaign_analyst.report(c, db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if c.status == "running":
        c.status = "completed"
    await db.commit()
    return out


# ── experiments ──────────────────────────────────────────────────────────────

@router.post("/{campaign_id}/experiments", status_code=201)
async def add_experiment(campaign_id: uuid.UUID, body: ExperimentBody,
                         current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    for variant in (body.variant_a_id, body.variant_b_id):
        if variant is not None:
            await _child(CampaignAsset, variant, c, db)
    row = CampaignExperiment(campaign_id=c.id, dimension=body.dimension,
                             hypothesis=body.hypothesis, variant_a_id=body.variant_a_id,
                             variant_b_id=body.variant_b_id, metric=body.metric)
    db.add(row)
    await db.commit()
    return _experiment(row)


@router.post("/{campaign_id}/experiments/{experiment_id}/result")
async def record_result(campaign_id: uuid.UUID, experiment_id: uuid.UUID,
                        body: ExperimentResult, current_user: CurrentUser, db: DB):
    """Record observed counts and settle the test if the evidence is strong enough."""
    from app.services.campaign_experiments import settle

    c = await _load(campaign_id, current_user.org_id, db)
    row = await _child(CampaignExperiment, experiment_id, c, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    settle(row)
    await db.commit()
    return _experiment(row)


# ── the agent playbook (unchanged behaviour) ─────────────────────────────────

class PlanEdit(BaseModel):
    step_ids: list[uuid.UUID]


async def enqueue_campaign(campaign_id: str) -> None:
    pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await pool.enqueue_job("run_campaign", campaign_id)
    finally:
        await pool.aclose()


@router.post("/{campaign_id}/playbook", status_code=201)
async def build_playbook(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Draft the agent steps that will produce this campaign's work.

    Every campaign can have one, not just the ones the autopilot created. The
    strategy says WHAT to make and who owns it; the playbook is the sequence the
    agents actually run to make it -- research, angle, write, visual, distribute.
    Splitting them was an accident of history, not a design.

    Re-running replaces the steps, which is why it is refused once the playbook
    has started: rewriting a plan mid-run would orphan the work in flight.
    """
    c = await _load(campaign_id, current_user.org_id, db)
    existing = await _steps(campaign_id, db)
    if any(s.status in ("running", "completed") for s in existing):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "This playbook has already run. Cancel it before rebuilding.")
    # The planner needs the channels to build steps that feed them, and they
    # live on their own rows -- attached here rather than queried inside the
    # director, which has no business knowing this schema.
    chans = (await db.execute(select(CampaignChannel).where(
        CampaignChannel.campaign_id == c.id))).scalars().all()
    c._channel_keys = [x.channel for x in chans]
    try:
        plan = await draft_plan(c.project_id, current_user.org_id, c.goal, c.persona, db,
                                campaign=c)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    for step in existing:
        await db.delete(step)
    c.director_summary = plan.get("summary")
    for i, step in enumerate(plan["steps"]):
        db.add(CampaignStep(campaign_id=c.id, order=i, agent=step["agent"],
                            action=step["action"], brief=step.get("brief") or {},
                            why=step.get("why"), status="pending"))
    await db.commit()
    return await _full(c, db)


@router.patch("/{campaign_id}/plan")
async def edit_plan(campaign_id: uuid.UUID, body: PlanEdit,
                    current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c.status not in ("ready", "draft", "planning"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Plan can only be edited before running.")
    if not body.step_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A campaign needs at least one step.")
    steps = await _steps(campaign_id, db)
    for s in steps:
        if s.id not in body.step_ids:
            await db.delete(s)
    for order, sid in enumerate(body.step_ids):
        s = next((x for x in steps if x.id == sid), None)
        if s is not None:
            s.order = order
    await db.commit()
    return await _full(c, db)


@router.post("/{campaign_id}/run")
async def run(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Run the agent playbook that produces the campaign's content."""
    c = await _load(campaign_id, current_user.org_id, db)
    if c.status not in ("ready", "planning", "draft"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Campaign is not in a runnable state.")
    if not await _steps(campaign_id, db):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "This campaign has no agent steps to run.")
    try:
        await enqueue_campaign(str(campaign_id))
    except Exception:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Could not start the campaign, try again.")
    c.status = "running"
    await db.commit()
    return await _full(c, db)


@router.post("/{campaign_id}/cancel")
async def cancel(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    c.cancel_requested = True
    await db.commit()
    return await _full(c, db)
