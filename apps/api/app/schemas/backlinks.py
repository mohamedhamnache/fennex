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
