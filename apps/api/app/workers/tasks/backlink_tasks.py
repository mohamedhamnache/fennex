"""ARQ tasks for backlink sync and exchange link verification."""
import logging
import uuid
from datetime import date, timezone, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.core.database import async_session_factory
from app.integrations.seo_apis import get_seo_provider
from app.integrations.seo_apis.mock_provider import MockSEOProvider
from app.models.backlinks import (
    BacklinkProfile, Backlink, BacklinkOpportunity,
    ExchangeRequest, ExchangeListing,
)
from app.models.project import Project
from app.services.metering import meter as _meter

logger = logging.getLogger(__name__)

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


async def sync_backlink_profile(ctx, project_id: str, bill_credits: bool = True):
    """Fetch and upsert backlink profile, backlinks, and opportunities for a project.

    `bill_credits` threads through to the metering call below: the weekly
    cron (weekly_backlink_discovery) enqueues this with bill_credits=False so
    its fan-out across every tracked project can never exhaust an org's
    enforced SEO credit bucket, while the user-initiated "Analyze" endpoint
    (POST /backlinks/analyze) enqueues it with the default True and keeps
    billing as before."""
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

        # Best-effort metering: get_backlink_profile issues ONE DataForSEO task
        # per call (one domain), so count=1. org_id is passed explicitly
        # (already loaded from project.org_id above) rather than relying on
        # the request-scoped contextvar -- this is a worker with no request
        # context. Isolated session + swallow so a metering hiccup never fails
        # the sync, and only the success path bills (a raise from
        # get_backlink_profile above skips this block entirely).
        #
        # get_seo_provider() falls back to MockSEOProvider whenever DataForSEO
        # credentials are absent, and MockSEOProvider is the ONLY provider that
        # implements get_backlink_profile (DataForSEOProvider does not) -- so
        # skip metering entirely when the resolved provider is the mock: no
        # real supplier task was issued, so there is nothing to bill.
        if not isinstance(provider, MockSEOProvider):
            try:
                async with async_session_factory() as _mdb:
                    await _meter.record_seo(_mdb, org_id=org_id, project_id=pid,
                                            unit="backlinks", count=1,
                                            feature="backlink_sync", bill_credits=bill_credits)
            except Exception:
                logger.warning("backlink sync seo metering failed", exc_info=True)

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


async def verify_exchange_link(ctx, request_id: str, side: str):
    """Check if the exchange link is live. side is 'requester' or 'target'."""
    import httpx
    rid = uuid.UUID(request_id)

    async with async_session_factory() as session:
        result = await session.execute(
            select(ExchangeRequest).where(ExchangeRequest.id == rid)
        )
        req = result.scalar_one_or_none()
        if not req:
            return

        url_to_check = req.requester_url if side == "requester" else req.target_url

        # Get the counterpart's listing to know what domain to look for
        counterpart_id = req.target_project_id if side == "requester" else req.requester_project_id
        listing_result = await session.execute(
            select(ExchangeListing).where(ExchangeListing.project_id == counterpart_id)
        )
        counterpart_listing = listing_result.scalar_one_or_none()
        counterpart_domain = counterpart_listing.site_url.split("//")[-1].split("/")[0] if counterpart_listing else None

        verified = False
        from app.core.config import settings as cfg
        if cfg.CRAWLER_SERVICE_URL and url_to_check and counterpart_domain:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.post(
                        f"{cfg.CRAWLER_SERVICE_URL}/fetch",
                        json={"url": url_to_check},
                    )
                    if resp.status_code == 200:
                        body = resp.json()
                        links = body.get("links", [])
                        verified = any(counterpart_domain in link for link in links)
            except Exception:
                pass
        else:
            # No crawler configured — mock-verify as True
            verified = True

        if side == "requester":
            req.requester_link_verified = verified
        else:
            req.target_link_verified = verified

        if req.requester_link_verified and req.target_link_verified:
            req.status = "live"

        await session.commit()


async def weekly_backlink_discovery(ctx):
    """ARQ cron — Monday 07:00 UTC. Fan-out sync to all projects with a profile.

    sync_backlink_profile only calls the SEO data provider (no LLM), so this
    never enters batch_scope().

    Enqueues with bill_credits=False: this is background/cron work, so it
    must still be metered for cost visibility but must never consume the
    enforced SEO credit bucket -- only the user-initiated "Analyze" endpoint
    (POST /backlinks/analyze) enqueues sync_backlink_profile with billing on.
    """
    import arq

    async with async_session_factory() as session:
        result = await session.execute(select(BacklinkProfile))
        profiles = result.scalars().all()

    redis = ctx["redis"]
    for profile in profiles:
        await arq.ArqRedis(redis).enqueue_job(
            "sync_backlink_profile", str(profile.project_id), bill_credits=False
        )
