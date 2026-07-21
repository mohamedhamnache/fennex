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


async def test_market_data_includes_overview_and_health():
    from types import SimpleNamespace as NS
    from app.services.agents import tools as T
    ov = NS(clicks=10, impressions=100, ctr=0.1, avg_position=5.0, clicks_change=1.0, impressions_change=2.0)
    health = NS(score=80, grade="B", components=[])
    market = NS(clusters=[], ideas=[])
    opps = NS(striking_distance=[], ctr_wins=[], total_potential_clicks=0)
    with patch.object(T, "get_overview", new=AsyncMock(return_value=ov)), \
         patch.object(T, "get_health_score", new=AsyncMock(return_value=health)), \
         patch.object(T, "get_market_insights", new=AsyncMock(return_value=market)), \
         patch.object(T, "get_opportunities", new=AsyncMock(return_value=opps)):
        data = await T.market_data(_brief(), db=None, inputs={})
    assert data["overview"]["clicks"] == 10 and data["overview"]["ctr"] == 0.1
    assert data["health"]["score"] == 80 and data["health"]["grade"] == "B"
