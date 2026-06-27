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
