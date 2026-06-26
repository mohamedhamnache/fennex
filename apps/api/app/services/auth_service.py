import re
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.models.organization import Organization
from app.models.user import User, UserRole


def _slugify(name: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", name.lower())
    slug = re.sub(r"[\s_-]+", "-", slug).strip("-")
    return slug or "org"


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def register(
        self, email: str, password: str, full_name: str, org_name: str
    ) -> tuple[User, Organization]:
        existing = await self.db.scalar(select(User).where(User.email == email))
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

        base_slug = _slugify(org_name)
        slug = base_slug
        counter = 1
        while await self.db.scalar(select(Organization).where(Organization.slug == slug)):
            slug = f"{base_slug}-{counter}"
            counter += 1

        org = Organization(id=uuid.uuid4(), slug=slug, name=org_name)
        self.db.add(org)
        await self.db.flush()

        user = User(
            id=uuid.uuid4(),
            org_id=org.id,
            email=email,
            hashed_password=hash_password(password),
            full_name=full_name,
            role=UserRole.OWNER,
            is_active=True,
        )
        self.db.add(user)
        await self.db.flush()
        return user, org

    async def authenticate(self, email: str, password: str) -> User:
        user = await self.db.scalar(select(User).where(User.email == email))
        if not user or not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
        return user

    async def get_user_by_id(self, user_id: uuid.UUID) -> User | None:
        return await self.db.scalar(select(User).where(User.id == user_id))
