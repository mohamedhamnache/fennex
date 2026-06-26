import uuid
from datetime import date
from typing import Optional

from pydantic import BaseModel


class AnalyticsOverview(BaseModel):
    clicks: int
    impressions: int
    ctr: float
    avg_position: float
    clicks_change: float        # % vs prior period; positive = grew
    impressions_change: float
    ctr_change: float
    position_change: float      # positive = rank got worse (higher number)


class TrafficDataPoint(BaseModel):
    date: date
    clicks: int
    impressions: int
    ctr: float
    avg_position: float


class RankingRow(BaseModel):
    keyword_id: uuid.UUID
    keyword: str
    search_volume: Optional[int]
    intent: Optional[str]
    difficulty: Optional[float]
    current_position: Optional[float]
    position_change: Optional[float]  # negative = improved (rank moved up)


class ContentPerformanceRow(BaseModel):
    article_id: uuid.UUID
    title: str
    published_url: Optional[str]
    status: str
    clicks: int
    impressions: int
    ctr: float


class TopPageRow(BaseModel):
    url: str
    clicks: int
    impressions: int
    ctr: float
    avg_position: float


class TopQueryRow(BaseModel):
    query: str
    clicks: int
    impressions: int
    ctr: float
    avg_position: float


class GscConnectionStatus(BaseModel):
    is_connected: bool
    google_email: Optional[str]
    site_url: Optional[str]
    last_synced_at: Optional[str]


class GscConnectResponse(BaseModel):
    redirect_url: str
