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
