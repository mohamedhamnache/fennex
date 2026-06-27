# Phase 11c: Backlinks — Exchange Marketplace API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the exchange marketplace: listings board, exchange requests, link verification worker, and full message threads.

**Architecture:** Extends `backlinks_service.py` with exchange functions, replaces exchange stub endpoints in the router, adds `verify_exchange_link` ARQ task. The crawler service call uses `httpx.AsyncClient` to `POST {CRAWLER_SERVICE_URL}/fetch`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, ARQ, httpx for crawler call.

**Prerequisite:** Phase 11a (tables exist) and Phase 11b (router stubs, service file, worker file) must be applied.

## Global Constraints

- All DB queries filter by both `project_id` AND `org_id`
- `verify_exchange_link(ctx, request_id: str, side: str)` — both args after ctx are str
- Crawler URL from `settings.CRAWLER_SERVICE_URL` — fall back gracefully if not set (mark verified=True in mock mode)
- Exchange request statuses: `pending` / `accepted` / `live` / `rejected` / `cancelled`
- A project cannot send a request to itself
- Only the target org can accept/reject; only the requester can cancel
- When both `requester_link_verified` and `target_link_verified` are True → set status to `live`
- `verify_exchange_link` must be registered in `worker.py` functions list

---

### Task 1: Exchange Schemas

**Files:**
- Modify: `apps/api/app/schemas/backlinks.py`

**Interfaces:**
- Produces (used by Tasks 2 and 3):
  - `ExchangeListingOut`, `ExchangeListingCreate`
  - `ExchangeRequestOut`, `ExchangeRequestCreate`, `ExchangeRequestUpdate`
  - `ExchangeMessageOut`, `ExchangeMessageCreate`

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_exchange_schemas.py
from app.schemas.backlinks import (
    ExchangeListingCreate, ExchangeRequestCreate,
    ExchangeMessageCreate, ExchangeRequestUpdate,
)

def test_listing_create():
    obj = ExchangeListingCreate(site_url="https://example.com", niche="tech", language="en", domain_authority=40.0, description="desc")
    assert obj.site_url == "https://example.com"

def test_request_create():
    import uuid
    obj = ExchangeRequestCreate(
        target_project_id=uuid.uuid4(),
        requester_url="https://mine.com/page",
        target_url="https://their.com/page",
        initial_message="hi",
    )
    assert obj.initial_message == "hi"

def test_message_create():
    obj = ExchangeMessageCreate(body="hello")
    assert obj.body == "hello"

def test_request_update():
    obj = ExchangeRequestUpdate(status="accepted")
    assert obj.status == "accepted"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_exchange_schemas.py -v
```
Expected: ImportError — schemas don't exist yet.

- [ ] **Step 3: Append to schemas/backlinks.py**

```python
# Append to apps/api/app/schemas/backlinks.py

class ExchangeListingOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    site_url: str
    niche: Optional[str]
    language: Optional[str]
    domain_authority: Optional[float]
    description: Optional[str]
    is_active: bool


class ExchangeListingCreate(BaseModel):
    site_url: str
    niche: Optional[str] = None
    language: Optional[str] = None
    domain_authority: Optional[float] = None
    description: Optional[str] = None


class ExchangeRequestOut(BaseModel):
    id: uuid.UUID
    requester_project_id: uuid.UUID
    target_project_id: uuid.UUID
    requester_org_id: uuid.UUID
    target_org_id: uuid.UUID
    status: str
    requester_url: Optional[str]
    target_url: Optional[str]
    requester_link_verified: bool
    target_link_verified: bool


class ExchangeRequestCreate(BaseModel):
    target_project_id: uuid.UUID
    requester_url: str
    target_url: str
    initial_message: Optional[str] = None


class ExchangeRequestUpdate(BaseModel):
    status: str


class ExchangeMessageOut(BaseModel):
    id: uuid.UUID
    request_id: uuid.UUID
    sender_org_id: uuid.UUID
    body: str
    created_at: Optional[str] = None


class ExchangeMessageCreate(BaseModel):
    body: str
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && python -m pytest tests/test_exchange_schemas.py -v
```
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/schemas/backlinks.py apps/api/tests/test_exchange_schemas.py
git commit -m "feat(api): Phase 11c — exchange schemas"
```

---

### Task 2: Exchange Service Functions

**Files:**
- Modify: `apps/api/app/services/backlinks_service.py`

**Interfaces:**
- Produces (used by Task 3 router):
  - `get_exchange_board(niche, language, exclude_project_id, db) -> list[ExchangeListing]`
  - `get_own_listing(project_id, org_id, db) -> ExchangeListing | None`
  - `upsert_listing(project_id, org_id, data, db) -> ExchangeListing`
  - `deactivate_listing(project_id, org_id, db) -> None`
  - `list_exchange_requests(project_id, org_id, role, db) -> list[ExchangeRequest]`
  - `create_exchange_request(requester_project_id, requester_org_id, data, db) -> ExchangeRequest`
  - `update_exchange_request(request_id, acting_org_id, status, db) -> ExchangeRequest | None`
  - `list_messages(request_id, org_id, db) -> list[ExchangeMessage]`
  - `send_message(request_id, sender_org_id, body, db) -> ExchangeMessage`

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_exchange_service.py
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.backlinks import ExchangeListing, ExchangeRequest
from app.schemas.backlinks import ExchangeListingCreate, ExchangeRequestCreate
from app.services.backlinks_service import (
    get_own_listing, upsert_listing, get_exchange_board,
    create_exchange_request, list_exchange_requests,
)

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DATABASE_URL, echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_A = uuid.uuid4()
ORG_B = uuid.uuid4()
PROJ_A = uuid.uuid4()
PROJ_B = uuid.uuid4()

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with Session() as s:
        s.add_all([
            Organization(id=ORG_A, slug="org-a", name="Org A"),
            Organization(id=ORG_B, slug="org-b", name="Org B"),
            Project(id=PROJ_A, org_id=ORG_A, name="A", domain="a.com", locale="en"),
            Project(id=PROJ_B, org_id=ORG_B, name="B", domain="b.com", locale="en"),
        ])
        await s.commit()
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_upsert_listing():
    async with Session() as db:
        data = ExchangeListingCreate(site_url="https://a.com", niche="tech", language="en")
        listing = await upsert_listing(PROJ_A, ORG_A, data, db)
        assert listing.site_url == "https://a.com"

@pytest.mark.asyncio
async def test_board_excludes_own():
    async with Session() as db:
        await upsert_listing(PROJ_A, ORG_A, ExchangeListingCreate(site_url="https://a.com"), db)
        await upsert_listing(PROJ_B, ORG_B, ExchangeListingCreate(site_url="https://b.com"), db)
        board = await get_exchange_board(None, None, PROJ_A, db)
        assert all(l.project_id != PROJ_A for l in board)

@pytest.mark.asyncio
async def test_create_request():
    async with Session() as db:
        req = await create_exchange_request(
            PROJ_A, ORG_A,
            ExchangeRequestCreate(target_project_id=PROJ_B, requester_url="https://a.com/p", target_url="https://b.com/p"),
            db,
        )
        assert req.status == "pending"
        assert req.target_org_id == ORG_B
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_exchange_service.py -v
```
Expected: ImportError — exchange service functions don't exist yet.

- [ ] **Step 3: Append exchange functions to backlinks_service.py**

```python
# Append to apps/api/app/services/backlinks_service.py
from app.models.backlinks import ExchangeListing, ExchangeRequest, ExchangeMessage
from app.schemas.backlinks import ExchangeListingCreate, ExchangeRequestCreate
from sqlalchemy.dialects.postgresql import insert as pg_insert


async def get_exchange_board(
    niche: str | None,
    language: str | None,
    exclude_project_id: uuid.UUID,
    db: AsyncSession,
) -> list[ExchangeListing]:
    q = select(ExchangeListing).where(
        ExchangeListing.is_active == True,
        ExchangeListing.project_id != exclude_project_id,
    )
    if niche:
        q = q.where(ExchangeListing.niche == niche)
    if language:
        q = q.where(ExchangeListing.language == language)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_own_listing(
    project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession
) -> ExchangeListing | None:
    result = await db.execute(
        select(ExchangeListing).where(
            ExchangeListing.project_id == project_id,
            ExchangeListing.org_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def upsert_listing(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    data: ExchangeListingCreate,
    db: AsyncSession,
) -> ExchangeListing:
    existing = await get_own_listing(project_id, org_id, db)
    if existing:
        for k, v in data.model_dump(exclude_none=True).items():
            setattr(existing, k, v)
        existing.is_active = True
        await db.commit()
        await db.refresh(existing)
        return existing
    listing = ExchangeListing(project_id=project_id, org_id=org_id, **data.model_dump())
    db.add(listing)
    await db.commit()
    await db.refresh(listing)
    return listing


async def deactivate_listing(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> None:
    listing = await get_own_listing(project_id, org_id, db)
    if listing:
        listing.is_active = False
        await db.commit()


async def list_exchange_requests(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    role: str | None,
    db: AsyncSession,
) -> list[ExchangeRequest]:
    if role == "sent":
        q = select(ExchangeRequest).where(ExchangeRequest.requester_project_id == project_id)
    elif role == "received":
        q = select(ExchangeRequest).where(ExchangeRequest.target_project_id == project_id)
    else:
        from sqlalchemy import or_
        q = select(ExchangeRequest).where(
            or_(ExchangeRequest.requester_project_id == project_id,
                ExchangeRequest.target_project_id == project_id)
        )
    result = await db.execute(q.order_by(ExchangeRequest.created_at.desc()))
    return list(result.scalars().all())


async def create_exchange_request(
    requester_project_id: uuid.UUID,
    requester_org_id: uuid.UUID,
    data: ExchangeRequestCreate,
    db: AsyncSession,
) -> ExchangeRequest:
    target_listing = await db.execute(
        select(ExchangeListing).where(ExchangeListing.project_id == data.target_project_id)
    )
    target = target_listing.scalar_one_or_none()
    target_org_id = target.org_id if target else requester_org_id  # fallback

    req = ExchangeRequest(
        requester_project_id=requester_project_id,
        target_project_id=data.target_project_id,
        requester_org_id=requester_org_id,
        target_org_id=target_org_id,
        requester_url=data.requester_url,
        target_url=data.target_url,
        status="pending",
    )
    db.add(req)
    await db.flush()

    if data.initial_message:
        msg = ExchangeMessage(
            request_id=req.id,
            sender_org_id=requester_org_id,
            body=data.initial_message,
        )
        db.add(msg)

    await db.commit()
    await db.refresh(req)
    return req


async def update_exchange_request(
    request_id: uuid.UUID,
    acting_org_id: uuid.UUID,
    new_status: str,
    db: AsyncSession,
) -> ExchangeRequest | None:
    result = await db.execute(
        select(ExchangeRequest).where(ExchangeRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        return None
    req.status = new_status
    await db.commit()
    await db.refresh(req)
    return req


async def list_messages(
    request_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession
) -> list[ExchangeMessage]:
    result = await db.execute(
        select(ExchangeMessage)
        .where(ExchangeMessage.request_id == request_id)
        .order_by(ExchangeMessage.created_at.asc())
    )
    return list(result.scalars().all())


async def send_message(
    request_id: uuid.UUID,
    sender_org_id: uuid.UUID,
    body: str,
    db: AsyncSession,
) -> ExchangeMessage:
    msg = ExchangeMessage(request_id=request_id, sender_org_id=sender_org_id, body=body)
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && python -m pytest tests/test_exchange_service.py -v
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/backlinks_service.py apps/api/tests/test_exchange_service.py
git commit -m "feat(api): Phase 11c — exchange service functions"
```

---

### Task 3: Exchange Router + Verify Worker

**Files:**
- Modify: `apps/api/app/api/v1/routers/backlinks.py` (replace exchange stubs with real implementations)
- Modify: `apps/api/app/workers/tasks/backlink_tasks.py` (add `verify_exchange_link`)
- Modify: `apps/api/app/workers/worker.py` (add `verify_exchange_link` to functions list)

**Interfaces:**
- Consumes: exchange service functions from Task 2, exchange schemas from Task 1
- Produces: 10 exchange endpoints fully wired; `verify_exchange_link(ctx, request_id: str, side: str)` registered in ARQ

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_exchange_endpoints.py
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

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DATABASE_URL, echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ID = uuid.uuid4()
PROJ_ID = uuid.uuid4()
OTHER_PROJ_ID = uuid.uuid4()

fake_user = User(
    id=uuid.uuid4(), org_id=ORG_ID, email="t@t.com",
    hashed_password="x", full_name="T", role=UserRole.OWNER, is_active=True,
)

async def override_get_db():
    async with Session() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise

async def override_get_current_user():
    return fake_user

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with Session() as s:
        s.add_all([
            Organization(id=ORG_ID, slug="org", name="Org"),
            Project(id=PROJ_ID, org_id=ORG_ID, name="P", domain="p.com", locale="en"),
            Project(id=OTHER_PROJ_ID, org_id=ORG_ID, name="Q", domain="q.com", locale="en"),
        ])
        await s.commit()
    yield
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_board_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"/api/v1/backlinks/exchange/board?project_id={PROJ_ID}", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    assert r.json() == []

@pytest.mark.asyncio
async def test_create_and_get_listing():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            f"/api/v1/backlinks/exchange/listing?project_id={PROJ_ID}",
            json={"site_url": "https://p.com", "niche": "tech"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 201
        r2 = await c.get(f"/api/v1/backlinks/exchange/listing?project_id={PROJ_ID}", headers={"Authorization": "Bearer x"})
        assert r2.status_code == 200
        assert r2.json()["site_url"] == "https://p.com"

@pytest.mark.asyncio
async def test_requests_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"/api/v1/backlinks/exchange/requests?project_id={PROJ_ID}", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    assert r.json() == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_exchange_endpoints.py -v
```
Expected: failures (stubs return wrong shapes).

- [ ] **Step 3: Replace exchange stubs in router**

Replace the `# ── Exchange` section in `apps/api/app/api/v1/routers/backlinks.py` with:

```python
# ── Exchange ──────────────────────────────────────────────────────────────────

from app.schemas.backlinks import (
    ExchangeListingOut, ExchangeListingCreate,
    ExchangeRequestOut, ExchangeRequestCreate, ExchangeRequestUpdate,
    ExchangeMessageOut, ExchangeMessageCreate,
)
from app.services.backlinks_service import (
    get_exchange_board, get_own_listing, upsert_listing, deactivate_listing,
    list_exchange_requests, create_exchange_request, update_exchange_request,
    list_messages, send_message,
)


@router.get("/exchange/board", response_model=list[ExchangeListingOut])
async def exchange_board(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    niche: Optional[str] = Query(default=None),
    language: Optional[str] = Query(default=None),
):
    return await get_exchange_board(niche, language, project_id, db)


@router.get("/exchange/listing", response_model=ExchangeListingOut)
async def get_listing(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    listing = await get_own_listing(project_id, current_user.org_id, db)
    if not listing:
        raise HTTPException(status_code=404, detail="No listing found")
    return listing


@router.post("/exchange/listing", response_model=ExchangeListingOut, status_code=201)
async def create_listing(
    project_id: uuid.UUID,
    body: ExchangeListingCreate,
    current_user: CurrentUser,
    db: DB,
):
    return await upsert_listing(project_id, current_user.org_id, body, db)


@router.delete("/exchange/listing", status_code=204)
async def delete_listing(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await deactivate_listing(project_id, current_user.org_id, db)


@router.get("/exchange/requests", response_model=list[ExchangeRequestOut])
async def list_requests(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    role: Optional[str] = Query(default=None, pattern="^(sent|received)$"),
):
    return await list_exchange_requests(project_id, current_user.org_id, role, db)


@router.post("/exchange/requests", response_model=ExchangeRequestOut, status_code=201)
async def create_request(
    project_id: uuid.UUID,
    body: ExchangeRequestCreate,
    current_user: CurrentUser,
    db: DB,
):
    if body.target_project_id == project_id:
        raise HTTPException(status_code=400, detail="Cannot request exchange with yourself")
    return await create_exchange_request(project_id, current_user.org_id, body, db)


@router.patch("/exchange/requests/{request_id}", response_model=ExchangeRequestOut)
async def update_request(
    request_id: uuid.UUID,
    body: ExchangeRequestUpdate,
    current_user: CurrentUser,
    db: DB,
):
    req = await update_exchange_request(request_id, current_user.org_id, body.status, db)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


@router.post("/exchange/requests/{request_id}/verify", status_code=202)
async def verify_request(
    request_id: uuid.UUID,
    current_user: CurrentUser,
    side: str = Query(pattern="^(requester|target)$"),
):
    redis = await arq.create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    job = await redis.enqueue_job("verify_exchange_link", str(request_id), side)
    await redis.aclose()
    return {"job_id": job.job_id if job else "queued", "status": "queued"}


@router.get("/exchange/requests/{request_id}/messages", response_model=list[ExchangeMessageOut])
async def get_messages(request_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await list_messages(request_id, current_user.org_id, db)


@router.post("/exchange/requests/{request_id}/messages", response_model=ExchangeMessageOut, status_code=201)
async def post_message(
    request_id: uuid.UUID,
    body: ExchangeMessageCreate,
    current_user: CurrentUser,
    db: DB,
):
    return await send_message(request_id, current_user.org_id, body.body, db)
```

- [ ] **Step 4: Add `verify_exchange_link` to backlink_tasks.py**

```python
# Append to apps/api/app/workers/tasks/backlink_tasks.py

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
```

- [ ] **Step 5: Add `verify_exchange_link` to worker.py functions list**

```python
# In apps/api/app/workers/worker.py
# Change the import line to:
from app.workers.tasks.backlink_tasks import sync_backlink_profile, verify_exchange_link, weekly_backlink_discovery

# Add to functions list:
        verify_exchange_link,
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api && python -m pytest tests/test_exchange_endpoints.py tests/test_exchange_service.py -v
```
Expected: 6 PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/api/v1/routers/backlinks.py apps/api/app/workers/tasks/backlink_tasks.py apps/api/app/workers/worker.py apps/api/tests/test_exchange_endpoints.py
git commit -m "feat(api): Phase 11c — exchange marketplace router and verify worker"
```
