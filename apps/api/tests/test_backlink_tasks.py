import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.organization import Organization
from app.models.project import Project
from app.models.usage_event import UsageEvent
from app.workers.tasks.backlink_tasks import _is_spam, sync_backlink_profile


def test_is_spam_bad_tld():
    assert _is_spam("example.xyz", None) is True


def test_is_spam_keyword():
    assert _is_spam("casino-deals.com", 50.0) is True


def test_is_spam_low_da():
    assert _is_spam("legit.com", 3.0) is True


def test_not_spam():
    assert _is_spam("example.com", 40.0) is False


# ── Worker task metering tests ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _make_org_and_project():
    org_id = uuid.uuid4()
    project_id = uuid.uuid4()
    async with TestSessionLocal() as session:
        org = Organization(id=org_id, slug=f"org-{org_id.hex[:8]}", name="Backlink Org")
        session.add(org)
        await session.flush()
        project = Project(id=project_id, org_id=org_id, name="Backlink Project", domain="synced.com")
        session.add(project)
        await session.commit()
    return org_id, project_id


class _RealSEOProvider:
    """Stands in for DataForSEOProvider: a real (non-mock) provider that issued
    an actual supplier task and should be billed. Not a MockSEOProvider
    instance, which is exactly what the metering skip in sync_backlink_profile
    checks for."""

    async def get_backlink_profile(self, domain):
        return {
            "domain_authority": 42.0,
            "trust_score": 30.0,
            "spam_score": 2.0,
            "total_backlinks": 500,
            "referring_domains": 50,
        }

    async def get_backlinks(self, domain):
        return [{
            "source_url": "https://real-source.com/page-1",
            "source_domain": "real-source.com",
            "target_url": f"https://{domain}/",
            "anchor_text": "anchor",
            "domain_authority": 40.0,
            "trust_score": 25.0,
            "spam_score": 1.0,
            "link_type": "dofollow",
        }]

    async def get_backlink_opportunities(self, domain):
        return [{
            "source_url": "https://real-opp.com/article-1",
            "source_domain": "real-opp.com",
            "domain_authority": 35.0,
            "trust_score": 20.0,
            "spam_score": 1.0,
            "linking_to_competitor": "competitor1.com",
        }]


async def test_sync_backlink_profile_meters_seo_credits():
    """sync_backlink_profile bills one 'backlinks' SEO credit per run --
    get_backlink_profile is one DataForSEO task per domain, regardless of how
    many individual backlinks/opportunities are fetched afterward. 'backlinks'
    carries weight 3 (app/core/credits.py SEO_CREDIT_WEIGHT), so one call
    should bump seo_credits_used by 3.

    Uses a real (non-mock) provider stub: with no DataForSEO credentials in
    the test env, get_seo_provider() would otherwise resolve to MockSEOProvider,
    which is never billed (see test_sync_backlink_profile_does_not_meter_on_mock_provider)."""
    org_id, project_id = await _make_org_and_project()

    with patch("app.workers.tasks.backlink_tasks.async_session_factory", TestSessionLocal), \
         patch("app.workers.tasks.backlink_tasks.get_seo_provider", return_value=_RealSEOProvider()):
        await sync_backlink_profile(ctx={}, project_id=str(project_id))

    async with TestSessionLocal() as session:
        ev_result = await session.execute(select(UsageEvent).where(UsageEvent.org_id == org_id))
        events = ev_result.scalars().all()
        assert len(events) == 1
        assert events[0].kind == "seo"
        assert events[0].seo_unit == "backlinks"
        assert events[0].seo_count == 1

        ou = (await session.execute(
            select(OrgUsage).where(OrgUsage.org_id == org_id)
        )).scalar_one()
        assert ou.seo_credits_used == 3  # 1 task * weight 3


async def test_sync_backlink_profile_does_not_meter_on_provider_failure():
    """A failed provider call must not bill: metering sits after
    get_backlink_profile returns, so an exception there never reaches it."""
    org_id, project_id = await _make_org_and_project()

    class _FailingProvider:
        async def get_backlink_profile(self, domain):
            raise RuntimeError("dataforseo down")

    with patch("app.workers.tasks.backlink_tasks.async_session_factory", TestSessionLocal), \
         patch("app.workers.tasks.backlink_tasks.get_seo_provider", return_value=_FailingProvider()):
        with pytest.raises(RuntimeError):
            await sync_backlink_profile(ctx={}, project_id=str(project_id))

    async with TestSessionLocal() as session:
        ev_result = await session.execute(select(UsageEvent).where(UsageEvent.org_id == org_id))
        assert ev_result.scalars().all() == []
        ou_result = await session.execute(select(OrgUsage).where(OrgUsage.org_id == org_id))
        assert ou_result.scalar_one_or_none() is None


async def test_sync_backlink_profile_does_not_meter_on_mock_provider():
    """get_seo_provider() falls back to MockSEOProvider whenever DataForSEO
    credentials are absent -- the default in this test environment, and the
    ONLY provider that implements get_backlink_profile at all (DataForSEOProvider
    does not). Billing that call would charge SEO credits for fabricated data,
    so sync_backlink_profile must skip metering entirely when the resolved
    provider is the mock."""
    from app.integrations.seo_apis.mock_provider import MockSEOProvider

    org_id, project_id = await _make_org_and_project()

    with patch("app.workers.tasks.backlink_tasks.async_session_factory", TestSessionLocal), \
         patch("app.workers.tasks.backlink_tasks.get_seo_provider", return_value=MockSEOProvider()):
        await sync_backlink_profile(ctx={}, project_id=str(project_id))

    async with TestSessionLocal() as session:
        ev_result = await session.execute(select(UsageEvent).where(UsageEvent.org_id == org_id))
        assert ev_result.scalars().all() == []

        ou_result = await session.execute(select(OrgUsage).where(OrgUsage.org_id == org_id))
        ou = ou_result.scalar_one_or_none()
        assert ou is None or ou.seo_credits_used == 0
