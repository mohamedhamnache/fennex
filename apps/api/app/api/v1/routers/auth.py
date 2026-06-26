from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.schemas.auth import LoginRequest, RefreshRequest, RegisterRequest, TokenResponse, UserResponse
from app.services.auth_service import AuthService

router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    service = AuthService(db)
    user, _ = await service.register(
        email=body.email,
        password=body.password,
        full_name=body.full_name,
        org_name=body.org_name,
    )
    payload = {"sub": str(user.id), "org_id": str(user.org_id), "role": user.role.value}
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    service = AuthService(db)
    user = await service.authenticate(email=body.email, password=body.password)
    payload = {"sub": str(user.id), "org_id": str(user.org_id), "role": user.role.value}
    return TokenResponse(
        access_token=create_access_token(payload),
        refresh_token=create_refresh_token(payload),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    new_payload = {"sub": payload["sub"], "org_id": payload["org_id"], "role": payload["role"]}
    return TokenResponse(
        access_token=create_access_token(new_payload),
        refresh_token=create_refresh_token(new_payload),
    )


@router.post("/logout", status_code=204)
async def logout():
    return None


@router.get("/me", response_model=UserResponse)
async def me(db: AsyncSession = Depends(get_db)):
    # Placeholder — requires auth dependency wired up
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Use /api/v1/users/me")
