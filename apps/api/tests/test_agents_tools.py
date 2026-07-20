import uuid, pytest
from unittest.mock import AsyncMock, patch
from app.services.agents.brief import Brief
from app.services.agents.tools import TOOLS, run_tools


def _brief():
    return Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])


def test_registry_has_expected_tools():
    for name in ["gsc_opportunities", "market_insights", "tracked_keywords", "crawl_competitor",
                 "store_products", "our_demand", "market_data"]:
        assert name in TOOLS


async def test_run_tools_wraps_ok_and_swallows_errors():
    async def boom(brief, db, inputs): raise RuntimeError("x")
    async def good(brief, db, inputs): return {"v": 1}
    with patch.dict(TOOLS, {"boom": boom, "good": good}, clear=False):
        out = await run_tools(["good", "boom"], _brief(), db=None, inputs={})
    assert out["good"] == {"ok": True, "data": {"v": 1}}
    assert out["boom"]["ok"] is False
