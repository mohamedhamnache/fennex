"""Unit tests for app/core/billing.py"""
import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.billing import (
    PLAN_LIMITS,
    current_billing_period_start,
    get_current_usage,
    increment_usage,
    check_usage_limit,
)
from app.models.organization import PlanTier


# ── PLAN_LIMITS ───────────────────────────────────────────────────────────────

def test_plan_limits_free_articles():
    assert PLAN_LIMITS["free"]["articles"] == 4

def test_plan_limits_agency_images_unlimited():
    assert PLAN_LIMITS["agency"]["images"] == -1

def test_plan_limits_all_tiers_present():
    for tier in ("free", "starter", "pro", "agency"):
        for resource in ("projects", "articles", "images", "social", "keywords",
                         "seats", "brand_voices", "audits", "backlinks"):
            assert resource in PLAN_LIMITS[tier]


# ── current_billing_period_start ──────────────────────────────────────────────

def test_current_billing_period_start_returns_first_of_month():
    period = current_billing_period_start()
    assert period.day == 1
    assert isinstance(period, date)


# ── get_current_usage ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_current_usage_returns_zero_when_no_row():
    org_id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(return_value=mock_result)

    used = await get_current_usage(org_id, "articles", mock_db)
    assert used == 0

@pytest.mark.asyncio
async def test_get_current_usage_returns_value():
    org_id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = 7
    mock_db.execute = AsyncMock(return_value=mock_result)

    used = await get_current_usage(org_id, "articles", mock_db)
    assert used == 7


# ── check_usage_limit ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_check_usage_limit_unlimited_passes():
    """Agency tier (unlimited = -1) never raises."""
    org = MagicMock()
    org.plan_tier = "agency"
    org.id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_response = MagicMock()

    dep = check_usage_limit("articles")
    await dep(org=org, db=mock_db, response=mock_response)
    # no exception = pass

@pytest.mark.asyncio
async def test_check_usage_limit_under_80_pct_no_warning():
    """Under 80% — no header, no exception."""
    org = MagicMock()
    org.plan_tier = "free"   # free limit = 4 articles
    org.id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = 2  # 50%
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_response = MagicMock()
    mock_response.headers = {}

    dep = check_usage_limit("articles")
    await dep(org=org, db=mock_db, response=mock_response)
    assert "X-Usage-Warning" not in mock_response.headers

@pytest.mark.asyncio
async def test_check_usage_limit_at_80_pct_sets_warning_header():
    """At exactly 80% — sets X-Usage-Warning, no exception."""
    from fastapi import HTTPException
    org = MagicMock()
    org.plan_tier = "free"   # limit = 4
    org.id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = 4  # 100% of 4... wait, 80% of 4 = 3.2 → use starter
    mock_result.scalar_one_or_none.return_value = 16  # 80% of 20 (starter)
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_response = MagicMock()
    mock_response.headers = {}

    org.plan_tier = "starter"  # limit = 20 articles
    dep = check_usage_limit("articles")
    await dep(org=org, db=mock_db, response=mock_response)
    assert "X-Usage-Warning" in mock_response.headers

@pytest.mark.asyncio
async def test_check_usage_limit_at_100_pct_raises_429():
    """At 100% — raises HTTPException 429."""
    from fastapi import HTTPException
    org = MagicMock()
    org.plan_tier = "starter"  # limit = 20
    org.id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = 20
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_response = MagicMock()

    dep = check_usage_limit("articles")
    with pytest.raises(HTTPException) as exc_info:
        await dep(org=org, db=mock_db, response=mock_response)
    assert exc_info.value.status_code == 429
    assert exc_info.value.detail["code"] == "LIMIT_REACHED"
    assert exc_info.value.detail["resource"] == "articles"
