"""ARQ tasks for backlink sync and exchange link verification."""
import uuid
from datetime import date, timezone, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.database import async_session_factory
from app.integrations.seo_apis import get_seo_provider
from app.models.backlinks import (
    BacklinkProfile, Backlink, BacklinkOpportunity,
    ExchangeRequest, ExchangeListing,
)
from app.models.project import Project

SPAM_TLDS = {'.xyz', '.top', '.click', '.loan', '.gq', '.tk', '.ml', '.ga', '.cf'}
SPAM_KEYWORDS = {'casino', 'pharma', 'adult', 'dating', 'poker', 'viagra'}


def _is_spam(domain: str, da: float | None) -> bool:
    tld = '.' + domain.rsplit('.', 1)[-1].lower()
    if tld in SPAM_TLDS:
        return True
    if any(kw in domain.lower() for kw in SPAM_KEYWORDS):
        return True
    if da is not None and da < 5:
        return True
    return False


async def sync_backlink_profile(ctx, project_id: str):
    """Fetch and upsert backlink profile, backlinks, and opportunities for a project."""
    pid = uuid.UUID(project_id)
    provider = get_seo_provider()
    today = date.today().isoformat()

    async with async_session_factory() as session:
        proj_result = await session.execute(
            select(Project).where(Project.id == pid)
        )
        project = proj_result.scalar_one_or_none()
        if not project:
            return

        domain = project.domain or ""
        org_id = project.org_id

        # Upsert profile
        profile_data = await provider.get_backlink_profile(domain)
        profile_stmt = (
            insert(BacklinkProfile)
            .values(
                project_id=pid,
                org_id=org_id,
                domain=domain,
                total_backlinks=profile_data["total_backlinks"],
                domain_authority=profile_data["domain_authority"],
                trust_score=profile_data["trust_score"],
                spam_score=profile_data["spam_score"],
                referring_domains=profile_data["referring_domains"],
                last_synced_at=datetime.now(timezone.utc).isoformat(),
            )
            .on_conflict_do_update(
                constraint="uq_backlink_profile_project",
                set_={
                    "total_backlinks": profile_data["total_backlinks"],
                    "domain_authority": profile_data["domain_authority"],
                    "trust_score": profile_data["trust_score"],
                    "spam_score": profile_data["spam_score"],
                    "referring_domains": profile_data["referring_domains"],
                    "last_synced_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            .returning(BacklinkProfile.id)
        )
        result = await session.execute(profile_stmt)
        profile_id = result.scalar_one()

        # Upsert backlinks
        backlinks_data = await provider.get_backlinks(domain)
        for bl in backlinks_data:
            da = bl.get("domain_authority")
            src_domain = bl.get("source_domain", "")
            spam = _is_spam(src_domain, da)
            stmt = (
                insert(Backlink)
                .values(
                    profile_id=profile_id,
                    project_id=pid,
                    org_id=org_id,
                    source_url=bl["source_url"],
                    source_domain=src_domain,
                    target_url=bl.get("target_url"),
                    anchor_text=bl.get("anchor_text"),
                    domain_authority=da,
                    trust_score=bl.get("trust_score"),
                    spam_score=bl.get("spam_score"),
                    is_spam=spam,
                    link_type=bl.get("link_type", "dofollow"),
                    first_seen=today,
                    last_seen=today,
                )
                .on_conflict_do_update(
                    constraint="uq_backlink_project_source",
                    set_={"last_seen": today, "is_spam": spam},
                )
            )
            await session.execute(stmt)

        # Upsert opportunities
        opps_data = await provider.get_backlink_opportunities(domain)
        for opp in opps_data:
            da = opp.get("domain_authority")
            src_domain = opp.get("source_domain", "")
            spam = _is_spam(src_domain, da)
            stmt = (
                insert(BacklinkOpportunity)
                .values(
                    project_id=pid,
                    org_id=org_id,
                    source_domain=src_domain,
                    source_url=opp["source_url"],
                    domain_authority=da,
                    trust_score=opp.get("trust_score"),
                    spam_score=opp.get("spam_score"),
                    is_spam=spam,
                    linking_to_competitor=opp.get("linking_to_competitor"),
                    status="new",
                )
                .on_conflict_do_update(
                    constraint="uq_opportunity_project_source",
                    set_={"domain_authority": da, "is_spam": spam},
                )
            )
            await session.execute(stmt)

        await session.commit()


async def weekly_backlink_discovery(ctx):
    """ARQ cron — Monday 07:00 UTC. Fan-out sync to all projects with a profile."""
    import arq
    async with async_session_factory() as session:
        result = await session.execute(select(BacklinkProfile))
        profiles = result.scalars().all()

    redis = ctx["redis"]
    for profile in profiles:
        await arq.ArqRedis(redis).enqueue_job(
            "sync_backlink_profile", str(profile.project_id)
        )
