import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.backlinks import BacklinkProfile, Backlink, BacklinkOpportunity
from app.schemas.backlinks import BacklinkProfileOut, BacklinkOut, BacklinkOpportunityOut

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
