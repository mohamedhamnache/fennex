"""The campaign spine.

A campaign was a goal plus a list of agent steps -- a playbook run, with no
notion of money, audience, channel or result. This adds the parts an ecommerce
campaign actually needs, around one rule that shapes the whole schema:

    ONE CAMPAIGN ID, REFERENCED BY EVERY CHANNEL EXECUTION.

That is what makes the campaign a source of truth rather than a folder. The
same id becomes the `utm_campaign` tag (see `slug`), so an order that lands
from an Instagram post and an order that lands from an email are attributable
to the same campaign without asking any ad platform for permission.

WHAT IS DELIBERATELY NOT HERE: spend, impressions, clicks, CTR, CPC. Those
live inside Meta/Google/TikTok and cannot be derived from anything Fennex can
see. A column for them would be a column that is always NULL and a dashboard
that renders zeros as if they were measurements. They arrive when an ads
connector does, in a table of its own; until then the UI says which connector
is missing rather than showing a zero.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import (JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer,
                        Numeric, String, Text)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin

# The lifecycle. `failed` is not in the product spec, which goes straight from
# running to completed -- but a run that died is not a campaign that finished,
# and folding one into the other would report a failure as a success.
STATUSES = ("draft", "planning", "ready", "scheduled", "running",
            "paused", "completed", "archived", "failed")

# What the merchant is trying to do. Drives the strategy engine's prompt, the
# default channel mix, and which KPI leads the dashboard.
OBJECTIVES = ("launch_product", "increase_sales", "clear_inventory",
              "acquire_customers", "retarget_customers", "repeat_purchase",
              "promote_collection", "seasonal", "brand_awareness", "custom")

# Approval is a gate on money and on other people's inboxes, not on drafting.
APPROVAL_STATES = ("draft", "review", "approved", "rejected")


class Campaign(Base, TimestampMixin):
    __tablename__ = "campaigns"
    __table_args__ = (
        # The UTM tag has to be unique within a project or two campaigns claim
        # the same orders. Scoped to project, not org: two projects are two
        # stores with two separate order streams.
        Index("ix_campaigns_project_slug", "project_id", "slug", unique=True),
        Index("ix_campaigns_project_status", "project_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    # `goal` is what the merchant typed and stays the campaign's own words.
    # `name` is what it is called in lists; derived from the goal when absent
    # rather than required, so nothing blocks on naming something.
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str | None] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    objective: Mapped[str | None] = mapped_column(String(30))
    persona: Mapped[str] = mapped_column(String(20), default="creator", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    director_summary: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)  # manual | autopilot | template
    week_of: Mapped[date | None] = mapped_column(Date, nullable=True)  # Monday of the plan's week (autopilot only)

    # ── identity and tracking ────────────────────────────────────────────────
    # The value of utm_campaign on every link this campaign produces. Generated
    # once, never edited: changing it after launch orphans every order already
    # attributed to the old value.
    slug: Mapped[str | None] = mapped_column(String(80))
    template_key: Mapped[str | None] = mapped_column(String(40))

    # ── the brief ────────────────────────────────────────────────────────────
    # Products and collections as external store ids, not FKs: a campaign may
    # name a product that has not been synced yet, and a sync must never be a
    # precondition for planning.
    product_ids: Mapped[list | None] = mapped_column(JSON)
    collections: Mapped[list | None] = mapped_column(JSON)
    audience: Mapped[dict | None] = mapped_column(JSON)      # {key,label,filters,nl,size,source}
    offer: Mapped[dict | None] = mapped_column(JSON)         # {type,value,code,description}
    budget_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    budget_currency: Mapped[str | None] = mapped_column(String(10))
    starts_on: Mapped[date | None] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    primary_kpi: Mapped[str | None] = mapped_column(String(30))
    secondary_kpis: Mapped[list | None] = mapped_column(JSON)
    targets: Mapped[dict | None] = mapped_column(JSON)       # {roas,cac,revenue,orders,aov}

    # ── what the AI concluded ────────────────────────────────────────────────
    # The strategy engine's grounded output, kept whole so the UI can show what
    # it was based on and what it could not see.
    strategy: Mapped[dict | None] = mapped_column(JSON)
    brief_summary: Mapped[str | None] = mapped_column(Text)
    score: Mapped[int | None] = mapped_column(Integer)
    score_detail: Mapped[dict | None] = mapped_column(JSON)

    # ── governance ───────────────────────────────────────────────────────────
    approval_state: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    autopilot: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    launched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CampaignStep(Base, TimestampMixin):
    __tablename__ = "campaign_steps"
    __table_args__ = (Index("ix_campaign_steps_campaign_order", "campaign_id", "order"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    agent: Mapped[str] = mapped_column(String(20), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    brief: Mapped[dict | None] = mapped_column(JSON)
    why: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    artifact_type: Mapped[str | None] = mapped_column(String(20))
    artifact_ids: Mapped[list | None] = mapped_column(JSON)
    structured: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[str | None] = mapped_column(String(50))
    finished_at: Mapped[str | None] = mapped_column(String(50))


class CampaignChannel(Base, TimestampMixin):
    """One channel's execution of the campaign.

    This is the row that makes multi-channel orchestration real: an Instagram
    post and a Meta prospecting campaign are two rows pointing at one
    campaign_id, each carrying its own schedule, budget share and external id.

    `connector_app` names the MCP app that would execute it. It is nullable
    because a channel can be planned before its connector exists -- planning
    the email is useful even with no Klaviyo -- and the readiness check reads
    exactly this column to tell the merchant what is missing.
    """
    __tablename__ = "campaign_channels"
    __table_args__ = (
        Index("ix_campaign_channels_campaign", "campaign_id"),
        Index("ix_campaign_channels_scheduled", "scheduled_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    channel: Mapped[str] = mapped_column(String(30), nullable=False)   # email | sms | instagram | meta_ads | ...
    connector_app: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    role: Mapped[str | None] = mapped_column(String(30))               # prospecting | retargeting | announce | reminder
    budget_share: Mapped[float | None] = mapped_column(Numeric(6, 2))  # percent of campaign budget
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # What the campaign told the channel to do, and what the channel returned.
    config: Mapped[dict | None] = mapped_column(JSON)
    external_ref: Mapped[str | None] = mapped_column(String(120))
    last_error: Mapped[str | None] = mapped_column(Text)


class CampaignAsset(Base, TimestampMixin):
    """A piece of campaign content or creative, in variants.

    Variants are rows rather than a JSON array so an experiment can point at
    one, an approval can gate one, and a result can be attributed to one.
    """
    __tablename__ = "campaign_assets"
    __table_args__ = (
        Index("ix_campaign_assets_campaign_kind", "campaign_id", "kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("campaign_channels.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(30), nullable=False)   # headline | hook | primary_text | cta | subject | ad_concept | image | post
    variant: Mapped[str | None] = mapped_column(String(4))          # A | B | C
    body: Mapped[str | None] = mapped_column(Text)
    # Generated visuals live in the images table; this points at one rather
    # than duplicating the file.
    image_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    meta: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    selected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class CampaignTask(Base, TimestampMixin):
    """A dated item on the campaign timeline.

    `day_offset` is relative to launch (negative = before), which is what makes
    a template portable: "creative production at D-5" survives being applied to
    any start date, where a stored absolute date would not.
    """
    __tablename__ = "campaign_tasks"
    __table_args__ = (Index("ix_campaign_tasks_campaign_day", "campaign_id", "day_offset"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    day_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(30))     # employee id, when an agent does it
    channel: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20), default="todo", nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CampaignApproval(Base, TimestampMixin):
    """A request to do something consequential, and its decision.

    Every row is a thing that spends money, messages a customer, or changes a
    price. The `preview` is required rather than optional: approving an action
    whose effect is not spelled out is not approval, it is a signature on a
    blank page.
    """
    __tablename__ = "campaign_approvals"
    __table_args__ = (Index("ix_campaign_approvals_campaign_state", "campaign_id", "state"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)  # spend | launch_ads | send_email | send_sms | change_price | create_discount
    channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("campaign_channels.id", ondelete="CASCADE"))
    preview: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)


class CampaignExperiment(Base, TimestampMixin):
    """An A/B test between two assets.

    `winner` stays NULL until the confidence threshold is met. A test that has
    not reached significance has no winner, and reporting the currently-ahead
    variant as one is how a merchant ends up spending on noise.
    """
    __tablename__ = "campaign_experiments"
    __table_args__ = (Index("ix_campaign_experiments_campaign", "campaign_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    dimension: Mapped[str] = mapped_column(String(30), nullable=False)  # creative | headline | offer | cta | audience | landing | product | subject
    hypothesis: Mapped[str | None] = mapped_column(Text)
    variant_a_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("campaign_assets.id", ondelete="SET NULL"))
    variant_b_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("campaign_assets.id", ondelete="SET NULL"))
    metric: Mapped[str | None] = mapped_column(String(30))
    # Observed counts, kept as raw numerator/denominator so significance can be
    # recomputed rather than trusted from a stored percentage.
    a_trials: Mapped[int | None] = mapped_column(Integer)
    a_wins: Mapped[int | None] = mapped_column(Integer)
    a_value: Mapped[float | None] = mapped_column(Numeric(14, 2))
    b_trials: Mapped[int | None] = mapped_column(Integer)
    b_wins: Mapped[int | None] = mapped_column(Integer)
    b_value: Mapped[float | None] = mapped_column(Numeric(14, 2))
    winner: Mapped[str | None] = mapped_column(String(4))
    confidence: Mapped[float | None] = mapped_column(Numeric(6, 3))
    revenue_impact: Mapped[float | None] = mapped_column(Numeric(14, 2))
    status: Mapped[str] = mapped_column(String(20), default="running", nullable=False)


class CampaignLearning(Base, TimestampMixin):
    """What this store learned, carried into the next campaign.

    Scoped to the PROJECT rather than the campaign that produced it -- a
    learning that cannot outlive its campaign is a note, not a memory. The
    campaign_id stays as provenance so a claim can be traced to the run that
    justified it.
    """
    __tablename__ = "campaign_learnings"
    __table_args__ = (Index("ix_campaign_learnings_project", "project_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="SET NULL"))
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    # What the statement is based on. A learning with no evidence is an opinion
    # the next campaign should not inherit.
    evidence: Mapped[dict | None] = mapped_column(JSON)
    confidence: Mapped[str] = mapped_column(String(10), default="low", nullable=False)  # low | medium | high
    tags: Mapped[list | None] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(20), default="post_campaign", nullable=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
