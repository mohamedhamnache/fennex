# Phase 11b: Backlinks — Monitor API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the backlink monitor feature: DataForSEO mock provider extensions, Pydantic schemas, service functions, the `sync_backlink_profile` ARQ task, and 5 API endpoints for profile/analyze/list/opportunities.

**Architecture:** Thin router → service layer → ORM queries pattern, matching analytics/social. Mock provider follows the existing `MockSEOProvider` class in `app/integrations/seo_apis/mock_provider.py`. Worker task signature: `async def task(ctx, arg: str)` — ctx always first.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, ARQ, Pydantic v2, existing `get_seo_provider()` factory.

**Prerequisite:** Phase 11a must be applied (tables exist, models importable).

## Global Constraints

- All DB queries filter by both `project_id` AND `org_id` — never one without the other
- Router file: `apps/api/app/api/v1/routers/backlinks.py` — full replacement of existing stub
- Service file: `apps/api/app/services/backlinks_service.py` — new file
- Schemas file: `apps/api/app/schemas/backlinks.py` — new file
- Worker file: `apps/api/app/workers/tasks/backlink_tasks.py` — new file
- ARQ task signature: `async def task_name(ctx, project_id: str)` — ctx first, str not UUID
- `_is_spam(domain, da)` returns `bool` — defined in `backlink_tasks.py`, also importable by service
- SPAM_TLDS: `{'.xyz', '.top', '.click', '.loan', '.gq', '.tk', '.ml', '.ga', '.cf'}`
- SPAM_KEYWORDS: `{'casino', 'pharma', 'adult', 'dating', 'poker', 'viagra'}`
- Mock provider adds 3 methods to `MockSEOProvider` and 3 signatures to `SEODataProvider` Protocol
- `worker.py` must be updated to register new tasks

---

### Task 1: Pydantic Schemas

**Files:**
- Create: `apps/api/app/schemas/backlinks.py`

**Interfaces:**
- Produces (used by Tasks 2 and 3):
  - `BacklinkProfileOut`, `BacklinkOut`, `BacklinkOpportunityOut`
  - `OpportunityStatusUpdate(status: str)`
  - `AnalyzeResponse(job_id: str, status: str)`

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_backlink_schemas.py
from app.schemas.backlinks import (
    BacklinkProfileOut, BacklinkOut, BacklinkOpportunityOut,
    OpportunityStatusUpdate, AnalyzeResponse,
)

def test_analyze_response():
    r = AnalyzeResponse(job_id="abc", status="queued")
    assert r.job_id == "abc"
    assert r.status == "queued"

def test_opportunity_status_update():
    u = OpportunityStatusUpdate(status="contacted")
    assert u.status == "contacted"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_backlink_schemas.py -v
```
Expected: ImportError.

- [ ] **Step 3: Create schemas**

```python
# apps/api/app/schemas/backlinks.py
import uuid
from typing import Optional
from pydantic import BaseModel


class BacklinkProfileOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    domain: Optional[str]
    total_backlinks: int
    domain_authority: Optional[float]
    trust_score: Optional[float]
    spam_score: Optional[float]
    referring_domains: int
    last_synced_at: Optional[str]


class BacklinkOut(BaseModel):
    id: uuid.UUID
    source_url: str
    source_domain: Optional[str]
    target_url: Optional[str]
    anchor_text: Optional[str]
    domain_authority: Optional[float]
    trust_score: Optional[float]
    is_spam: bool
    link_type: str
    first_seen: Optional[str]
    last_seen: Optional[str]


class BacklinkOpportunityOut(BaseModel):
    id: uuid.UUID
    source_domain: Optional[str]
    source_url: str
    domain_authority: Optional[float]
    trust_score: Optional[float]
    is_spam: bool
    linking_to_competitor: Optional[str]
    status: str


class OpportunityStatusUpdate(BaseModel):
    status: str


class AnalyzeResponse(BaseModel):
    job_id: str
    status: str
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && python -m pytest tests/test_backlink_schemas.py -v
```
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/schemas/backlinks.py apps/api/tests/test_backlink_schemas.py
git commit -m "feat(api): Phase 11b — backlink schemas"
```

---

### Task 2: Mock Provider Extensions

**Files:**
- Modify: `apps/api/app/integrations/seo_apis/base.py`
- Modify: `apps/api/app/integrations/seo_apis/mock_provider.py`

**Interfaces:**
- Produces (used by Task 3 worker):
  - `provider.get_backlink_profile(domain: str) -> dict` with keys: `domain_authority`, `trust_score`, `spam_score`, `total_backlinks`, `referring_domains`
  - `provider.get_backlinks(domain: str) -> list[dict]` — 20 rows, each with: `source_url`, `source_domain`, `target_url`, `anchor_text`, `domain_authority`, `trust_score`, `spam_score`, `link_type`
  - `provider.get_backlink_opportunities(domain: str) -> list[dict]` — 10 rows, each with: `source_url`, `source_domain`, `domain_authority`, `trust_score`, `spam_score`, `linking_to_competitor`

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_backlink_mock_provider.py
import pytest
from app.integrations.seo_apis.mock_provider import MockSEOProvider

@pytest.fixture
def provider():
    return MockSEOProvider()

@pytest.mark.asyncio
async def test_get_backlink_profile(provider):
    result = await provider.get_backlink_profile("example.com")
    assert "domain_authority" in result
    assert "total_backlinks" in result
    assert isinstance(result["total_backlinks"], int)

@pytest.mark.asyncio
async def test_get_backlinks_returns_20(provider):
    result = await provider.get_backlinks("example.com")
    assert len(result) == 20
    assert "source_url" in result[0]
    assert "link_type" in result[0]

@pytest.mark.asyncio
async def test_get_backlink_opportunities_returns_10(provider):
    result = await provider.get_backlink_opportunities("example.com")
    assert len(result) == 10
    assert "linking_to_competitor" in result[0]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_backlink_mock_provider.py -v
```
Expected: AttributeError — methods don't exist yet.

- [ ] **Step 3: Add protocol signatures to base.py**

```python
# apps/api/app/integrations/seo_apis/base.py
# Add these 3 lines to the SEODataProvider Protocol class (after get_keyword_ideas):
    async def get_backlink_profile(self, domain: str) -> dict: ...
    async def get_backlinks(self, domain: str) -> list[dict]: ...
    async def get_backlink_opportunities(self, domain: str) -> list[dict]: ...
```

- [ ] **Step 4: Add methods to MockSEOProvider**

Append to `apps/api/app/integrations/seo_apis/mock_provider.py`:

```python
    async def get_backlink_profile(self, domain: str) -> dict:
        h = abs(hash(domain)) & 0x7FFFFFFF
        return {
            "domain_authority": round(20.0 + (h % 60), 1),
            "trust_score": round(15.0 + (h % 50), 1),
            "spam_score": round((h % 20), 1),
            "total_backlinks": 100 + (h % 5000),
            "referring_domains": 10 + (h % 500),
        }

    async def get_backlinks(self, domain: str) -> list[dict]:
        tlds = [".com", ".org", ".net", ".io", ".co"]
        link_types = ["dofollow", "nofollow"]
        results = []
        for i in range(20):
            h = abs(hash(f"{domain}-bl-{i}")) & 0x7FFFFFFF
            src_domain = f"site{h % 9999}{tlds[h % len(tlds)]}"
            results.append({
                "source_url": f"https://{src_domain}/page-{i}",
                "source_domain": src_domain,
                "target_url": f"https://{domain}/",
                "anchor_text": f"anchor text {i}",
                "domain_authority": round(10.0 + (h % 70), 1),
                "trust_score": round(5.0 + (h % 60), 1),
                "spam_score": round(h % 15, 1),
                "link_type": link_types[h % 2],
            })
        return results

    async def get_backlink_opportunities(self, domain: str) -> list[dict]:
        competitors = ["competitor1.com", "competitor2.com", "competitor3.com"]
        results = []
        for i in range(10):
            h = abs(hash(f"{domain}-opp-{i}")) & 0x7FFFFFFF
            src_domain = f"referring{h % 9999}.com"
            results.append({
                "source_url": f"https://{src_domain}/article-{i}",
                "source_domain": src_domain,
                "domain_authority": round(20.0 + (h % 60), 1),
                "trust_score": round(15.0 + (h % 50), 1),
                "spam_score": round(h % 10, 1),
                "linking_to_competitor": competitors[h % len(competitors)],
            })
        return results
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && python -m pytest tests/test_backlink_mock_provider.py -v
```
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/integrations/seo_apis/base.py apps/api/app/integrations/seo_apis/mock_provider.py apps/api/tests/test_backlink_mock_provider.py
git commit -m "feat(api): Phase 11b — mock provider backlink methods"
```

---

### Task 3: Worker Task

**Files:**
- Create: `apps/api/app/workers/tasks/backlink_tasks.py`
- Modify: `apps/api/app/workers/worker.py`

**Interfaces:**
- Consumes: `get_seo_provider()` from `app.integrations.seo_apis`, models from `app.models.backlinks`
- Produces: `sync_backlink_profile(ctx, project_id: str)` — called by router's analyze endpoint

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_backlink_tasks.py
from app.workers.tasks.backlink_tasks import _is_spam

def test_is_spam_bad_tld():
    assert _is_spam("example.xyz", None) is True

def test_is_spam_keyword():
    assert _is_spam("casino-deals.com", 50.0) is True

def test_is_spam_low_da():
    assert _is_spam("legit.com", 3.0) is True

def test_not_spam():
    assert _is_spam("example.com", 40.0) is False
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_backlink_tasks.py -v
```
Expected: ImportError.

- [ ] **Step 3: Create the worker task file**

```python
# apps/api/app/workers/tasks/backlink_tasks.py
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
```

- [ ] **Step 4: Update worker.py**

```python
# apps/api/app/workers/worker.py
# Add import:
from app.workers.tasks.backlink_tasks import sync_backlink_profile, verify_exchange_link, weekly_backlink_discovery

# In functions list, add:
#   sync_backlink_profile,
#   verify_exchange_link,
#   weekly_backlink_discovery,

# In cron_jobs list, add:
#   cron(weekly_backlink_discovery, weekday=0, hour=7, minute=0, run_at_startup=False),
```

Full updated `worker.py`:

```python
# apps/api/app/workers/worker.py
from arq.connections import RedisSettings
from arq.cron import cron

from app.core.config import settings
from app.workers.tasks.analytics_tasks import seed_analytics_history, sync_analytics_data
from app.workers.tasks.audit_tasks import run_seo_audit
from app.workers.tasks.backlink_tasks import sync_backlink_profile, weekly_backlink_discovery
from app.workers.tasks.crawl_tasks import crawl_website
from app.workers.tasks.keyword_tasks import run_keyword_research


async def startup(ctx):
    pass


async def shutdown(ctx):
    pass


async def _noop(ctx):
    pass


class WorkerSettings:
    functions = [
        _noop,
        crawl_website,
        run_seo_audit,
        run_keyword_research,
        seed_analytics_history,
        sync_analytics_data,
        sync_backlink_profile,
        weekly_backlink_discovery,
    ]
    cron_jobs = [
        cron(sync_analytics_data, hour=6, minute=0, run_at_startup=False),
        cron(weekly_backlink_discovery, weekday=0, hour=7, minute=0, run_at_startup=False),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    job_timeout = 600
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && python -m pytest tests/test_backlink_tasks.py -v
```
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/workers/tasks/backlink_tasks.py apps/api/app/workers/worker.py apps/api/tests/test_backlink_tasks.py
git commit -m "feat(api): Phase 11b — sync_backlink_profile worker task"
```

---

### Task 4: Service + Router (Monitor)

**Files:**
- Create: `apps/api/app/services/backlinks_service.py`
- Modify: `apps/api/app/api/v1/routers/backlinks.py` (replace stub — monitor endpoints only, exchange endpoints are stubs for now)

**Interfaces:**
- Consumes: schemas from Task 1, models from Phase 11a, `sync_backlink_profile` from Task 3
- Produces 5 endpoints:
  - `GET /backlinks/profile?project_id=`
  - `POST /backlinks/analyze?project_id=` → 202
  - `GET /backlinks?project_id=&is_spam=&page=`
  - `GET /backlinks/opportunities?project_id=&status=`
  - `PATCH /backlinks/opportunities/{id}`

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_backlinks.py
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
from app.models.backlinks import BacklinkProfile, Backlink, BacklinkOpportunity

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()
fake_user = User(
    id=uuid.uuid4(), org_id=FAKE_ORG_ID,
    email="test@test.com", hashed_password="x",
    full_name="Test", role=UserRole.OWNER, is_active=True,
)

async def override_get_db():
    async with TestSession() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

async def override_get_current_user():
    return fake_user

@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with TestSession() as session:
        org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
        project = Project(id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, name="Test", domain="test.com", locale="en")
        session.add_all([org, project])
        await session.commit()
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_get_profile_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/backlinks/profile?project_id={FAKE_PROJECT_ID}", headers={"Authorization": "Bearer token"})
    assert r.status_code == 404

@pytest.mark.asyncio
async def test_list_backlinks_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/backlinks?project_id={FAKE_PROJECT_ID}", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json() == []

@pytest.mark.asyncio
async def test_list_opportunities_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/backlinks/opportunities?project_id={FAKE_PROJECT_ID}", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json() == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_backlinks.py -v
```
Expected: failures (stub returns 200 with wrong shape or missing routes).

- [ ] **Step 3: Create the service**

```python
# apps/api/app/services/backlinks_service.py
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.backlinks import BacklinkProfile, Backlink, BacklinkOpportunity
from app.schemas.backlinks import BacklinkProfileOut, BacklinkOut, BacklinkOpportunityOut

PAGE_SIZE = 25


async def get_profile(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> BacklinkProfile | None:
    result = await db.execute(
        select(BacklinkProfile).where(
            BacklinkProfile.project_id == project_id,
            BacklinkProfile.org_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def list_backlinks(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    is_spam: bool | None,
    page: int,
    db: AsyncSession,
) -> list[Backlink]:
    q = select(Backlink).where(
        Backlink.project_id == project_id,
        Backlink.org_id == org_id,
    )
    if is_spam is not None:
        q = q.where(Backlink.is_spam == is_spam)
    q = q.order_by(Backlink.domain_authority.desc().nullslast()).offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
    result = await db.execute(q)
    return list(result.scalars().all())


async def list_opportunities(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    status: str | None,
    db: AsyncSession,
) -> list[BacklinkOpportunity]:
    q = select(BacklinkOpportunity).where(
        BacklinkOpportunity.project_id == project_id,
        BacklinkOpportunity.org_id == org_id,
        BacklinkOpportunity.is_spam == False,
    )
    if status:
        q = q.where(BacklinkOpportunity.status == status)
    q = q.order_by(BacklinkOpportunity.domain_authority.desc().nullslast())
    result = await db.execute(q)
    return list(result.scalars().all())


async def update_opportunity_status(
    opportunity_id: uuid.UUID,
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    status: str,
    db: AsyncSession,
) -> BacklinkOpportunity | None:
    result = await db.execute(
        select(BacklinkOpportunity).where(
            BacklinkOpportunity.id == opportunity_id,
            BacklinkOpportunity.project_id == project_id,
            BacklinkOpportunity.org_id == org_id,
        )
    )
    opp = result.scalar_one_or_none()
    if not opp:
        return None
    opp.status = status
    await db.commit()
    await db.refresh(opp)
    return opp
```

- [ ] **Step 4: Create the router (monitor endpoints + stubs for exchange)**

```python
# apps/api/app/api/v1/routers/backlinks.py
"""Backlinks router — monitor + exchange marketplace."""
import uuid
from typing import Optional

import arq
from fastapi import APIRouter, HTTPException, Query, status
from arq.connections import RedisSettings

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.schemas.backlinks import (
    AnalyzeResponse,
    BacklinkOpportunityOut,
    BacklinkOut,
    BacklinkProfileOut,
    OpportunityStatusUpdate,
)
from app.services.backlinks_service import (
    get_profile,
    list_backlinks,
    list_opportunities,
    update_opportunity_status,
)

router = APIRouter()


# ── Monitor ──────────────────────────────────────────────────────────────────

@router.get("/profile", response_model=BacklinkProfileOut)
async def backlink_profile(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    profile = await get_profile(project_id, current_user.org_id, db)
    if not profile:
        raise HTTPException(status_code=404, detail="No backlink profile yet. Run Analyze first.")
    return profile


@router.post("/analyze", response_model=AnalyzeResponse, status_code=202)
async def analyze_backlinks(
    project_id: uuid.UUID,
    current_user: CurrentUser,
):
    redis = await arq.create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    job = await redis.enqueue_job("sync_backlink_profile", str(project_id))
    await redis.aclose()
    return AnalyzeResponse(job_id=job.job_id if job else "queued", status="queued")


@router.get("", response_model=list[BacklinkOut])
async def list_backlinks_endpoint(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    is_spam: Optional[bool] = Query(default=None),
    page: int = Query(default=1, ge=1),
):
    return await list_backlinks(project_id, current_user.org_id, is_spam, page, db)


@router.get("/opportunities", response_model=list[BacklinkOpportunityOut])
async def list_opportunities_endpoint(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    status: Optional[str] = Query(default=None),
):
    return await list_opportunities(project_id, current_user.org_id, status, db)


@router.patch("/opportunities/{opportunity_id}", response_model=BacklinkOpportunityOut)
async def update_opportunity(
    opportunity_id: uuid.UUID,
    body: OpportunityStatusUpdate,
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    opp = await update_opportunity_status(opportunity_id, project_id, current_user.org_id, body.status, db)
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return opp


# ── Exchange (implemented in Phase 11c) ─────────────────────────────────────

@router.get("/exchange/board")
async def exchange_board():
    return []

@router.get("/exchange/listing")
async def get_listing():
    raise HTTPException(status_code=404, detail="No listing")

@router.post("/exchange/listing", status_code=201)
async def create_listing():
    return {"message": "Not implemented yet"}

@router.delete("/exchange/listing", status_code=204)
async def delete_listing():
    pass

@router.get("/exchange/requests")
async def list_requests():
    return []

@router.post("/exchange/requests", status_code=201)
async def create_request():
    return {"message": "Not implemented yet"}

@router.patch("/exchange/requests/{request_id}")
async def update_request(request_id: uuid.UUID):
    return {"message": "Not implemented yet"}

@router.post("/exchange/requests/{request_id}/verify", status_code=202)
async def verify_request(request_id: uuid.UUID):
    return {"message": "Not implemented yet"}

@router.get("/exchange/requests/{request_id}/messages")
async def list_messages(request_id: uuid.UUID):
    return []

@router.post("/exchange/requests/{request_id}/messages", status_code=201)
async def send_message(request_id: uuid.UUID):
    return {"message": "Not implemented yet"}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && python -m pytest tests/test_backlinks.py -v
```
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/backlinks_service.py apps/api/app/api/v1/routers/backlinks.py apps/api/tests/test_backlinks.py
git commit -m "feat(api): Phase 11b — backlink monitor service and router"
```
