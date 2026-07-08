"""Campaign orchestrator: run a planned campaign's steps in order, chaining outputs."""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.campaign import Campaign, CampaignStep
from app.services.ai_analytics_service import project_profile
from app.services.campaign_catalog import ACTIONS, CampaignContext

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def execute_campaign(campaign_id, db_factory=None) -> None:
    factory = db_factory or async_session_factory
    async with factory() as db:
        campaign = await db.get(Campaign, campaign_id)
        if campaign is None:
            return
        campaign.status = "running"
        await db.commit()
        steps = (await db.execute(select(CampaignStep).where(
            CampaignStep.campaign_id == campaign_id).order_by(CampaignStep.order))).scalars().all()

        profile = ""
        try:
            profile = await project_profile(campaign.project_id, db)
        except Exception:
            pass
        context = CampaignContext(goal=campaign.goal, persona=campaign.persona, project_profile=profile, prior=[])

        any_done = False
        for step in steps:
            await db.refresh(campaign)
            if campaign.cancel_requested:
                break
            adef = ACTIONS.get(step.action)
            if adef is None:
                step.status = "skipped"; step.error = "Unknown action."; await db.commit(); continue
            step.status = "running"; step.started_at = _now(); await db.commit()
            try:
                result = await adef.executor(campaign, step, context, db)
                if result.structured.get("skipped"):
                    step.status = "skipped"; step.summary = result.summary
                else:
                    step.status = "completed"; any_done = True
                    step.summary = result.summary
                    step.artifact_type = result.artifact_type
                    step.artifact_ids = result.artifact_ids or None
                    step.structured = result.structured or None
                    context.prior.append({"agent": step.agent, "action": step.action,
                                          "summary": result.summary, "structured": result.structured})
            except Exception as exc:  # noqa: BLE001 — record + continue
                logger.exception("campaign step failed: %s", step.action)
                step.status = "failed"; step.error = str(exc)[:2000]
            step.finished_at = _now(); await db.commit()

        await db.refresh(campaign)
        if campaign.cancel_requested:
            campaign.status = "cancelled"
        else:
            campaign.status = "completed" if any_done else "failed"
        await db.commit()


async def run_campaign(ctx, campaign_id: str) -> None:
    await execute_campaign(uuid.UUID(campaign_id))
