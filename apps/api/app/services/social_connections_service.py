import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.social import SocialConnection, SocialPlatform
from app.core.security import encrypt_value

VALID_PLATFORMS = {p.value for p in SocialPlatform}


async def list_connections(org_id: uuid.UUID, db: AsyncSession) -> list[SocialConnection]:
    result = await db.execute(
        select(SocialConnection).where(SocialConnection.org_id == org_id).order_by(SocialConnection.platform)
    )
    return list(result.scalars().all())


async def upsert_connection(
    org_id: uuid.UUID,
    platform: str,
    handle: str | None,
    token: str,
    db: AsyncSession,
) -> SocialConnection:
    result = await db.execute(
        select(SocialConnection).where(
            SocialConnection.org_id == org_id,
            SocialConnection.platform == platform,
        )
    )
    conn = result.scalar_one_or_none()
    if conn:
        conn.handle = handle
        conn.encrypted_token = encrypt_value(token)
    else:
        conn = SocialConnection(
            org_id=org_id,
            platform=platform,
            handle=handle,
            encrypted_token=encrypt_value(token),
        )
        db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn


async def delete_connection(org_id: uuid.UUID, platform: str, db: AsyncSession) -> bool:
    result = await db.execute(
        select(SocialConnection).where(
            SocialConnection.org_id == org_id,
            SocialConnection.platform == platform,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        return False
    await db.delete(conn)
    await db.commit()
    return True
