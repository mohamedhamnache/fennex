"""POST /images/{id}/publish — publish an image to WordPress or Shopify."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_credentials, decrypt_api_key
from app.models.api_key import APIKey
from app.models.image import GeneratedImage
from app.models.publish_record import PublishRecord
from app.models.publishing import PublishingConnection, PublishingPlatform
from app.services.publish_service import publish_to_wordpress, publish_to_shopify
from app.services.shopify_service import get_credentials as get_shopify_credentials

router = APIRouter()

SUPPORTED_PLATFORMS = {"wordpress", "shopify"}


class ImagePublishRequest(BaseModel):
    platform: str
    config: dict = {}


class PublishRecordOut(BaseModel):
    id: uuid.UUID
    image_id: uuid.UUID
    platform: str
    external_id: Optional[str] = None
    external_url: Optional[str] = None
    published_at: datetime
    error: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


@router.post("/{image_id}/publish", response_model=PublishRecordOut)
async def publish_image(image_id: uuid.UUID, body: ImagePublishRequest, current_user: CurrentUser, db: DB):
    if body.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported platform '{body.platform}'. Supported: {sorted(SUPPORTED_PLATFORMS)}",
        )

    img_result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == current_user.org_id,
        )
    )
    image = img_result.scalar_one_or_none()
    if not image:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    if not image.image_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image has no URL")

    if body.platform == "wordpress":
        conn_result = await db.execute(
            select(PublishingConnection).where(
                PublishingConnection.org_id == current_user.org_id,
                PublishingConnection.platform == PublishingPlatform.wordpress,
            )
        )
        connection = conn_result.scalars().first()
        if not connection or not connection.credentials_encrypted:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "WordPress is not connected. Go to Settings > Publishing.",
            )
        creds = decrypt_credentials(connection.credentials_encrypted)
        result = await publish_to_wordpress(
            image_url=image.image_url,
            seo_filename=image.seo_filename,
            alt_text=image.alt_text,
            wp_url=connection.site_url,
            wp_user=creds.get("username", ""),
            wp_app_password=creds.get("app_password", ""),
        )

    elif body.platform == "shopify":
        shopify_domain = ""
        shopify_token = ""
        # Prefer the project's stored Shopify store connection (Integration Hub).
        creds = await get_shopify_credentials(image.project_id, current_user.org_id, db)
        if creds:
            shopify_domain, shopify_token = creds
        else:
            # Fall back to the legacy per-org API key + per-request domain.
            key_result = await db.execute(
                select(APIKey).where(
                    APIKey.org_id == current_user.org_id,
                    APIKey.provider == "shopify",
                )
            )
            api_key_row = key_result.scalar_one_or_none()
            if not api_key_row:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "Shopify is not connected. Connect your store in Integrations.",
                )
            shopify_token = decrypt_api_key(api_key_row.encrypted_value)
            shopify_domain = body.config.get("shopify_domain", "")
        result = await publish_to_shopify(
            image_url=image.image_url,
            alt_text=image.alt_text,
            shopify_domain=shopify_domain,
            shopify_token=shopify_token,
        )

    else:
        result = {"ok": False, "error": "Not implemented"}

    record = PublishRecord(
        image_id=image_id,
        org_id=current_user.org_id,
        platform=body.platform,
        external_id=result.get("external_id"),
        external_url=result.get("external_url"),
        published_at=datetime.now(timezone.utc),
        error=None if result.get("ok") else result.get("error"),
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    await db.commit()
    return PublishRecordOut.model_validate(record)
