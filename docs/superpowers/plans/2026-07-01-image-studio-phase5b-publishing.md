# Image Studio Phase 5B — Publishing & Connectors

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **Dependency:** Plan 2C (`exportImage` endpoint for format conversion). Existing `social_connections_service.py` for WordPress/Shopify/social OAuth tokens. Plan 5A (DAM) for `is_deleted` and `seo_filename`.

**Goal:** Let users publish images directly from the studio to WordPress (as media library items), Shopify (as product images or files), and download in multiple formats (PNG, JPG, WebP, SVG placeholder, PSD placeholder). Adds a "Publish" button on image cards that opens a target selector modal.

**Architecture:** New `PublishRecord` model to track every publish event (platform, external URL, published_at). New `POST /images/{id}/publish` endpoint dispatches to the appropriate connector. WordPress connector uses the existing WordPress REST API credentials from `social_connections`. Shopify connector uses the Shopify Admin REST API. Social connectors (Instagram/LinkedIn) are intentionally deferred — those require media pipelines and OAuth scopes not yet in place. Export is already covered by Plan 2C's `/images/{id}/export` endpoint.

**Tech Stack:** FastAPI, httpx, SQLAlchemy 2 async, Alembic, existing `social_connections_service`, Next.js 14 App Router, TanStack Query v5

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors
- TDD: write failing test first, then implement

---

### Task 1: PublishRecord model + migration

**Files:**
- Create: `apps/api/app/models/publish_record.py`
- Modify: `apps/api/app/models/__init__.py`
- Create: migration

**Interfaces:**
- Produces: `PublishRecord` (image_id, platform, external_id, external_url, published_at) — consumed by Task 3

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_publish_model.py
async def test_publish_records_table_exists():
    from sqlalchemy import inspect
    from app.core.database import async_engine
    async with async_engine.connect() as conn:
        insp = await conn.run_sync(inspect)
        assert "publish_records" in insp.get_table_names()
```

- [ ] **Step 2: Create model**

```python
# apps/api/app/models/publish_record.py
import uuid
from datetime import datetime
from sqlalchemy import String, ForeignKey, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class PublishRecord(Base):
    __tablename__ = "publish_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generated_images.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 3: Register, migrate, test, commit**

```python
# apps/api/app/models/__init__.py:
from app.models.publish_record import PublishRecord  # noqa
```

```bash
docker compose exec api alembic revision --autogenerate -m "publish_records"
make db-migrate
cd apps/api && pytest tests/test_publish_model.py -v
git add apps/api/app/models/publish_record.py apps/api/app/models/__init__.py apps/api/alembic/versions/ apps/api/tests/test_publish_model.py
git commit -m "feat(publishing): add PublishRecord model"
```

---

### Task 2: Publishing connectors

**Files:**
- Create: `apps/api/app/services/publish_service.py`
- Test: `apps/api/tests/test_publish_service.py`

**Interfaces:**
- Produces:
  - `publish_to_wordpress(image_url, seo_filename, alt_text, wp_url, wp_user, wp_app_password) -> dict`
  - `publish_to_shopify(image_url, alt_text, shopify_domain, shopify_token) -> dict`
  - Each returns `{"ok": True, "external_id": str, "external_url": str}` or `{"ok": False, "error": str}`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_publish_service.py
import pytest
from unittest.mock import patch, AsyncMock
from app.services.publish_service import publish_to_wordpress, publish_to_shopify


@pytest.mark.asyncio
async def test_publish_to_wordpress_success():
    mock_response = AsyncMock()
    mock_response.status_code = 201
    mock_response.json.return_value = {
        "id": 42,
        "source_url": "https://myblog.com/wp-content/uploads/product.png",
    }
    mock_response.raise_for_status = lambda: None

    with patch("httpx.AsyncClient.post", return_value=mock_response):
        result = await publish_to_wordpress(
            image_url="https://s3.example.com/img.png",
            seo_filename="red-sneaker",
            alt_text="Red sneaker product shot",
            wp_url="https://myblog.com",
            wp_user="admin",
            wp_app_password="xxxx xxxx xxxx",
        )
    assert result["ok"] is True
    assert result["external_id"] == "42"
    assert "source_url" in result["external_url"]


@pytest.mark.asyncio
async def test_publish_to_shopify_success():
    mock_response = AsyncMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "image": {"id": 789, "src": "https://cdn.shopify.com/files/product.png"}
    }
    mock_response.raise_for_status = lambda: None

    with patch("httpx.AsyncClient.post", return_value=mock_response):
        result = await publish_to_shopify(
            image_url="https://s3.example.com/img.png",
            alt_text="Product shot",
            shopify_domain="mystore.myshopify.com",
            shopify_token="shpat_xxxx",
        )
    assert result["ok"] is True
    assert result["external_id"] == "789"
```

- [ ] **Step 2: Create publish_service.py**

```python
# apps/api/app/services/publish_service.py
"""Connectors for publishing images to external platforms."""
import base64
import httpx


async def publish_to_wordpress(
    image_url: str,
    seo_filename: str | None,
    alt_text: str | None,
    wp_url: str,
    wp_user: str,
    wp_app_password: str,
) -> dict:
    """Upload image to WordPress media library via REST API."""
    try:
        # Download image first
        async with httpx.AsyncClient(timeout=30) as client:
            img_resp = await client.get(image_url)
            img_resp.raise_for_status()
            image_bytes = img_resp.content

        filename = f"{seo_filename or 'image'}.jpg"
        credentials = base64.b64encode(f"{wp_user}:{wp_app_password}".encode()).decode()

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{wp_url.rstrip('/')}/wp-json/wp/v2/media",
                content=image_bytes,
                headers={
                    "Authorization": f"Basic {credentials}",
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Content-Type": "image/jpeg",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        # Update alt text
        if alt_text and data.get("id"):
            async with httpx.AsyncClient(timeout=30) as client:
                await client.post(
                    f"{wp_url.rstrip('/')}/wp-json/wp/v2/media/{data['id']}",
                    json={"alt_text": alt_text},
                    headers={"Authorization": f"Basic {credentials}"},
                )

        return {"ok": True, "external_id": str(data["id"]), "external_url": data.get("source_url", "")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def publish_to_shopify(
    image_url: str,
    alt_text: str | None,
    shopify_domain: str,
    shopify_token: str,
) -> dict:
    """Upload image to Shopify Files API."""
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"https://{shopify_domain}/admin/api/2024-01/graphql.json",
                json={
                    "query": """
                        mutation fileCreate($files: [FileCreateInput!]!) {
                          fileCreate(files: $files) {
                            files { id alt }
                            userErrors { field message }
                          }
                        }
                    """,
                    "variables": {
                        "files": [{
                            "alt": alt_text or "",
                            "contentType": "IMAGE",
                            "originalSource": image_url,
                        }]
                    },
                },
                headers={
                    "X-Shopify-Access-Token": shopify_token,
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        errors = data.get("data", {}).get("fileCreate", {}).get("userErrors", [])
        if errors:
            return {"ok": False, "error": errors[0]["message"]}

        files = data.get("data", {}).get("fileCreate", {}).get("files", [])
        file_id = files[0]["id"] if files else ""
        return {"ok": True, "external_id": str(file_id), "external_url": image_url}
    except Exception as e:
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 3: Run tests and commit**

```bash
cd apps/api && pytest tests/test_publish_service.py -v
git add apps/api/app/services/publish_service.py apps/api/tests/test_publish_service.py
git commit -m "feat(publishing): add WordPress and Shopify publish connectors"
```

---

### Task 3: Publish endpoint

**Files:**
- Create: `apps/api/app/api/v1/routers/publishing.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_publishing_api.py`

**Interfaces:**
- `POST /api/v1/images/{id}/publish` body: `{platform: "wordpress"|"shopify"}` → `PublishRecordOut`

Fetches platform credentials from `SocialConnection` records (already exists in the DB via settings → Social Connections).

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_publishing_api.py
async def test_publish_unknown_platform(client, auth_headers, sample_image):
    response = await client.post(
        f"/api/v1/images/{sample_image.id}/publish",
        json={"platform": "myspace"},
        headers=auth_headers,
    )
    assert response.status_code == 400

async def test_publish_wordpress_no_connection(client, auth_headers, sample_image):
    response = await client.post(
        f"/api/v1/images/{sample_image.id}/publish",
        json={"platform": "wordpress"},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert "not connected" in response.json()["detail"].lower()
```

- [ ] **Step 2: Create publishing router**

```python
# apps/api/app/api/v1/routers/publishing.py
import uuid
from datetime import datetime
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.models.image import GeneratedImage
from app.models.publish_record import PublishRecord
from app.models.social_connection import SocialConnection
from app.services.publish_service import publish_to_wordpress, publish_to_shopify

router = APIRouter()

SUPPORTED_PLATFORMS = {"wordpress", "shopify"}


class PublishRequest(BaseModel):
    platform: str


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
async def publish_image(image_id: uuid.UUID, body: PublishRequest, current_user: CurrentUser, db: DB):
    if body.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unsupported platform. Supported: {SUPPORTED_PLATFORMS}")

    # Fetch image
    img_result = await db.execute(
        select(GeneratedImage).where(GeneratedImage.id == image_id, GeneratedImage.org_id == current_user.org_id)
    )
    image = img_result.scalar_one_or_none()
    if not image:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    if not image.image_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image has no URL")

    # Fetch social connection
    conn_result = await db.execute(
        select(SocialConnection).where(
            SocialConnection.org_id == current_user.org_id,
            SocialConnection.platform == body.platform,
        )
    )
    connection = conn_result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{body.platform} is not connected. Go to Settings → Social Connections.")

    # Dispatch to connector
    if body.platform == "wordpress":
        creds = connection.credentials or {}
        result = await publish_to_wordpress(
            image_url=image.image_url,
            seo_filename=image.seo_filename,
            alt_text=image.alt_text,
            wp_url=creds.get("url", ""),
            wp_user=creds.get("username", ""),
            wp_app_password=creds.get("app_password", ""),
        )
    elif body.platform == "shopify":
        creds = connection.credentials or {}
        result = await publish_to_shopify(
            image_url=image.image_url,
            alt_text=image.alt_text,
            shopify_domain=creds.get("shop_domain", ""),
            shopify_token=creds.get("access_token", ""),
        )
    else:
        result = {"ok": False, "error": "Not implemented"}

    record = PublishRecord(
        image_id=image_id,
        org_id=current_user.org_id,
        platform=body.platform,
        external_id=result.get("external_id"),
        external_url=result.get("external_url"),
        error=None if result.get("ok") else result.get("error"),
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    await db.commit()
    return PublishRecordOut.model_validate(record)
```

- [ ] **Step 3: Register, test, commit**

```python
# router.py:
from app.api.v1.routers import publishing
api_router.include_router(publishing.router, prefix="/images", tags=["publishing"])
```

```bash
cd apps/api && pytest tests/test_publishing_api.py -v
git add apps/api/app/api/v1/routers/publishing.py apps/api/app/api/v1/router.py apps/api/tests/test_publishing_api.py
git commit -m "feat(publishing): add POST /images/{id}/publish endpoint (WordPress, Shopify)"
```

---

### Task 4: Frontend — Publish button + modal

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/PublishModal.tsx`
- Modify: image card component

- [ ] **Step 1: Add API function**

```typescript
// apps/web/lib/api.ts

export interface PublishRecord {
  id: string;
  image_id: string;
  platform: string;
  external_url: string | null;
  published_at: string;
  error: string | null;
}

export async function publishImage(imageId: string, platform: string): Promise<PublishRecord> {
  return apiClient.post<PublishRecord>(`/images/${imageId}/publish`, { platform });
}
```

- [ ] **Step 2: Create PublishModal**

```tsx
// apps/web/components/studio/PublishModal.tsx
"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Globe, ExternalLink, X, Check, Loader2 } from "lucide-react";
import { publishImage } from "@/lib/api";

const PLATFORMS = [
  { id: "wordpress", label: "WordPress", icon: "🌐", description: "Publish to media library" },
  { id: "shopify",   label: "Shopify",   icon: "🛍️", description: "Upload to Files" },
];

interface PublishModalProps {
  imageId: string;
  onClose: () => void;
}

export function PublishModal({ imageId, onClose }: PublishModalProps) {
  const [selected, setSelected] = useState("wordpress");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => publishImage(imageId, selected),
    onSuccess: (data) => { if (data.external_url) setPublishedUrl(data.external_url); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-card border border-border shadow-xl flex flex-col gap-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Publish Image</span>
          </div>
          <button type="button" onClick={onClose}><X className="h-4 w-4 text-muted-foreground hover:text-foreground" /></button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p.id)}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                selected === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40"
              }`}
            >
              <span className="text-xl">{p.icon}</span>
              <div>
                <p className={`text-sm font-medium ${selected === p.id ? "text-primary" : "text-foreground"}`}>{p.label}</p>
                <p className="text-xs text-muted-foreground">{p.description}</p>
              </div>
            </button>
          ))}
        </div>

        {publishedUrl && (
          <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
            <Check className="h-4 w-4 text-green-500 shrink-0" />
            <a href={publishedUrl} target="_blank" rel="noopener noreferrer"
               className="text-xs text-green-600 hover:underline flex items-center gap-1 truncate">
              Published <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
        )}

        {mutation.isError && (
          <p className="mx-5 mb-3 text-xs text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Publish failed"}
          </p>
        )}

        <div className="px-5 pb-5">
          <button
            type="button"
            disabled={mutation.isPending || !!publishedUrl}
            onClick={() => mutation.mutate()}
            className="btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {publishedUrl ? "Published!" : mutation.isPending ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add Publish button to image cards**

On the studio result card, add a "Publish" button alongside the existing Edit/Download buttons that opens `<PublishModal>`.

- [ ] **Step 4: Typecheck, visual test, commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts apps/web/components/studio/PublishModal.tsx apps/web/components/studio/
git commit -m "feat(publishing): add Publish button and modal with WordPress/Shopify support"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| `PublishRecord` tracks every publish event | Task 1 |
| WordPress media library upload | Task 2 |
| Shopify Files API upload | Task 2 |
| Alt text sent with published image | Task 2 |
| SEO filename used for WordPress upload | Task 2 |
| Publish button on image cards → platform selector modal | Task 4 |
| Published URL shown after success | Task 4 |
| Graceful error if platform not connected | Task 3 |
| Export formats (PNG/JPG/WebP) | Already in Plan 2C |

All §14 requirements covered (social direct publish deferred — requires media upload OAuth not yet in scope). ✓
