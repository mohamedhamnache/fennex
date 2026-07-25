import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.core.security import encrypt_value
from app.models.provider_account import ProviderAccount

router = APIRouter()


def _require_staff(current_user: CurrentUser) -> None:
    admin_emails = {e.lower() for e in (settings.PLATFORM_ADMIN_EMAILS or [])}
    if current_user.email.lower() not in admin_emails:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")


class CreateAccount(BaseModel):
    kind: str
    provider: str
    label: str
    credentials: str
    priority: int = 100
    monthly_budget_cents: Optional[int] = None


def _out(a: ProviderAccount) -> dict:
    return {
        "id": str(a.id), "kind": a.kind, "provider": a.provider, "label": a.label,
        "is_active": a.is_active, "priority": a.priority,
        "monthly_budget_cents": a.monthly_budget_cents,
        "credentials_hint": "****",  # never expose the secret; hint is fixed mask
    }


@router.get("")
async def list_accounts(current_user: CurrentUser, db: DB) -> list[dict]:
    _require_staff(current_user)
    rows = (await db.execute(
        select(ProviderAccount).order_by(ProviderAccount.kind, ProviderAccount.priority)
    )).scalars().all()
    return [_out(a) for a in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_account(body: CreateAccount, current_user: CurrentUser, db: DB) -> dict:
    _require_staff(current_user)
    if body.kind not in ("llm", "seo"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="kind must be llm|seo")
    acct = ProviderAccount(
        id=uuid.uuid4(), kind=body.kind, provider=body.provider, label=body.label,
        encrypted_credentials=encrypt_value(body.credentials),
        priority=body.priority, monthly_budget_cents=body.monthly_budget_cents,
    )
    db.add(acct)
    await db.commit()
    await db.refresh(acct)
    out = _out(acct)
    if body.kind == "llm":
        out["credentials_hint"] = "…" + body.credentials[-4:]  # last-4 hint on create
    # kind == "seo": credentials is "login:password" (DataForSEO) — last-4 would
    # leak part of the password, so keep the fixed "****" mask from _out().
    return out


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: uuid.UUID, current_user: CurrentUser, db: DB) -> None:
    _require_staff(current_user)
    acct = await db.get(ProviderAccount, account_id)
    if acct is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.delete(acct)
    await db.commit()
