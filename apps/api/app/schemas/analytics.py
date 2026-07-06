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
    keyword_id: Optional[uuid.UUID] = None   # set when the query matches a tracked keyword
    keyword: str
    search_volume: Optional[int]
    intent: Optional[str]
    difficulty: Optional[float]
    current_position: Optional[float]
    position_change: Optional[float]  # negative = improved (rank moved up)
    clicks: int = 0
    impressions: int = 0
    tracked: bool = False


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


class GscSite(BaseModel):
    site_url: str
    permission_level: str


class GscSelectSiteRequest(BaseModel):
    site_url: str


class CompetitorRequest(BaseModel):
    url: str


class CompetitorScorecard(BaseModel):
    score: int
    title: str
    title_length: int
    meta_description: str
    meta_length: int
    word_count: int
    h1_count: int
    h2_count: int
    schema_types: list[str]
    images_without_alt: int
    internal_links: int
    canonical: Optional[str]
    checks: dict


class CompetitorAnalysis(BaseModel):
    ok: bool
    error: Optional[str] = None
    url: Optional[str] = None
    scorecard: Optional[CompetitorScorecard] = None
    outline: list[str] = []
    insights: str = ""


class TopicCluster(BaseModel):
    topic: str
    query_count: int
    clicks: int
    impressions: int
    avg_position: float
    top_query: str


class ContentIdea(BaseModel):
    query: str
    impressions: int
    clicks: int
    position: float
    idea_type: str   # question | how-to | comparison | commercial | list | informational


class MarketInsights(BaseModel):
    clusters: list[TopicCluster]
    ideas: list[ContentIdea]
    total_clicks: int
    total_impressions: int


class HealthComponent(BaseModel):
    key: str
    label: str
    score: int      # 0-100
    detail: str


class HealthScore(BaseModel):
    score: int
    grade: str
    components: list[HealthComponent]
    has_data: bool = True


class AiAgentRequest(BaseModel):
    question: str
    history: list[dict] = []
    persona: str = "creator"


class AgentChartSeries(BaseModel):
    key: str
    name: str


class AgentChart(BaseModel):
    type: str          # "bar" | "line"
    title: str = ""
    x_key: str = "label"
    series: list[AgentChartSeries] = []
    data: list[dict] = []


class AiAgentResponse(BaseModel):
    answer: str
    chart: Optional[AgentChart] = None
    followups: list[str] = []


class OpportunityRow(BaseModel):
    query: str
    url: Optional[str]
    clicks: int
    impressions: int
    ctr: float
    position: float
    potential_clicks: int   # estimated extra clicks over the synced window
    kind: str               # "striking_distance" | "ctr_win"


class OpportunitiesResponse(BaseModel):
    striking_distance: list[OpportunityRow]
    ctr_wins: list[OpportunityRow]
    total_potential_clicks: int


class GscSyncResult(BaseModel):
    ok: bool
    days: int = 0
    date_points: int = 0
    queries: int = 0
    pages: int = 0
    keywords_matched: int = 0
    last_synced_at: Optional[str] = None
    error: Optional[str] = None
