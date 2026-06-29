import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.database import Base

# JSONB columns are incompatible with the in-memory SQLite engine used in all
# test files. Remove the offending table from metadata once per session so that
# every test's Base.metadata.create_all() call works without per-file filtering.
_JSONB_TABLES = {"subscription_events"}


@pytest.fixture(autouse=True, scope="session")
def remove_jsonb_tables():
    """Strip JSONB-bearing tables from Base.metadata for SQLite test compatibility."""
    removed = []
    for name in _JSONB_TABLES:
        if name in Base.metadata.tables:
            table = Base.metadata.tables[name]
            Base.metadata.remove(table)
            removed.append(table)
    yield
    for table in removed:
        Base.metadata._add_table(table.name, table.schema, table)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
