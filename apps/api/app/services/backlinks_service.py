import uuid
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.backlinks import BacklinkProfile, Backlink, BacklinkOpportunity, ExchangeListing, ExchangeRequest, ExchangeMessage
from app.models.project import Project
from app.schemas.backlinks import ExchangeListingCreate, ExchangeRequestCreate

PAGE_SIZE = 25


async def get_profile(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> BacklinkProfile | None:
    result = await db.execute(
        select(BacklinkProfile).where(
            BacklinkProfile.project_id == project_id,
            BacklinkProfile.org_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def list_backlinks(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    is_spam: bool | None,
    page: int,
    db: AsyncSession,
) -> list[Backlink]:
    q = select(Backlink).where(
        Backlink.project_id == project_id,
        Backlink.org_id == org_id,
    )
    if is_spam is not None:
        q = q.where(Backlink.is_spam == is_spam)
    q = q.order_by(Backlink.domain_authority.desc().nullslast()).offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
    result = await db.execute(q)
    return list(result.scalars().all())


async def list_opportunities(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    status: str | None,
    db: AsyncSession,
) -> list[BacklinkOpportunity]:
    q = select(BacklinkOpportunity).where(
        BacklinkOpportunity.project_id == project_id,
        BacklinkOpportunity.org_id == org_id,
        BacklinkOpportunity.is_spam == False,
    )
    if status:
        q = q.where(BacklinkOpportunity.status == status)
    q = q.order_by(BacklinkOpportunity.domain_authority.desc().nullslast())
    result = await db.execute(q)
    return list(result.scalars().all())


async def update_opportunity_status(
    opportunity_id: uuid.UUID,
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    status: str,
    db: AsyncSession,
) -> BacklinkOpportunity | None:
    result = await db.execute(
        select(BacklinkOpportunity).where(
            BacklinkOpportunity.id == opportunity_id,
            BacklinkOpportunity.project_id == project_id,
            BacklinkOpportunity.org_id == org_id,
        )
    )
    opp = result.scalar_one_or_none()
    if not opp:
        return None
    opp.status = status
    await db.commit()
    await db.refresh(opp)
    return opp


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
        q = select(ExchangeRequest).where(
            ExchangeRequest.requester_project_id == project_id,
            ExchangeRequest.requester_org_id == org_id,
        )
    elif role == "received":
        q = select(ExchangeRequest).where(
            ExchangeRequest.target_project_id == project_id,
            ExchangeRequest.target_org_id == org_id,
        )
    else:
        q = select(ExchangeRequest).where(
            or_(ExchangeRequest.requester_project_id == project_id,
                ExchangeRequest.target_project_id == project_id),
            or_(ExchangeRequest.requester_org_id == org_id,
                ExchangeRequest.target_org_id == org_id),
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
    if target:
        target_org_id = target.org_id
    else:
        target_project = await db.execute(
            select(Project).where(Project.id == data.target_project_id)
        )
        tp = target_project.scalar_one_or_none()
        if tp is None:
            raise ValueError("Target project not found")
        target_org_id = tp.org_id

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
    if acting_org_id not in (req.requester_org_id, req.target_org_id):
        return None
    req.status = new_status
    await db.commit()
    await db.refresh(req)
    return req


async def list_messages(
    request_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession
) -> list[ExchangeMessage]:
    req_result = await db.execute(
        select(ExchangeRequest).where(
            ExchangeRequest.id == request_id,
            or_(ExchangeRequest.requester_org_id == org_id, ExchangeRequest.target_org_id == org_id),
        )
    )
    if not req_result.scalar_one_or_none():
        return []
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
) -> ExchangeMessage | None:
    req_result = await db.execute(
        select(ExchangeRequest).where(
            ExchangeRequest.id == request_id,
            or_(ExchangeRequest.requester_org_id == sender_org_id, ExchangeRequest.target_org_id == sender_org_id),
        )
    )
    if not req_result.scalar_one_or_none():
        return None
    msg = ExchangeMessage(request_id=request_id, sender_org_id=sender_org_id, body=body)
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg
