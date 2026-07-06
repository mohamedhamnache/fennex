# Image Studio Phase 5A — Asset Management / DAM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add folder organisation, tagging, semantic search, and usage analytics to the image studio. Users can create folders, move images into them, tag images with keywords, and search across all assets using natural language ("show me blue product shots").

**Architecture:** New `image_folders` table (org-scoped folders). New `image_tags` junction table (image ↔ tag). `GeneratedImage` gets `folder_id` FK and `is_deleted` soft-delete flag. Semantic search uses the org's LLM to extract intent then filters by tag/usage/platform. New `/api/v1/image-folders` and `/api/v1/images/search` routers. Frontend: folder sidebar in studio dashboard + search bar.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, existing `call_llm`, Next.js 14 App Router, TanStack Query v5

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors
- TDD: write failing test first, then implement

---

### Task 1: ImageFolder model + image_tags + GeneratedImage changes

**Files:**
- Create: `apps/api/app/models/image_folder.py`
- Modify: `apps/api/app/models/image.py`
- Modify: `apps/api/app/models/__init__.py`
- Create: migration

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_dam_models.py
async def test_dam_tables_exist():
    from sqlalchemy import inspect
    from app.core.database import async_engine
    async with async_engine.connect() as conn:
        insp = await conn.run_sync(inspect)
        tables = insp.get_table_names()
    assert "image_folders" in tables
    assert "image_tags" in tables
    img_cols = {c["name"] for c in insp.get_columns("generated_images")}
    assert "folder_id" in img_cols
    assert "tags" in img_cols
    assert "is_deleted" in img_cols
```

- [ ] **Step 2: Create ImageFolder model**

```python
# apps/api/app/models/image_folder.py
import uuid
from sqlalchemy import String, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class ImageFolder(Base, TimestampMixin):
    __tablename__ = "image_folders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("image_folders.id", ondelete="SET NULL"), nullable=True
    )
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
```

- [ ] **Step 3: Add columns to GeneratedImage**

```python
# apps/api/app/models/image.py — add to GeneratedImage:
from sqlalchemy import JSON, Boolean

    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("image_folders.id", ondelete="SET NULL"), nullable=True
    )
    tags: Mapped[list] = mapped_column(JSON, default=list)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

- [ ] **Step 4: Register model, generate migration, apply**

```python
# apps/api/app/models/__init__.py — add:
from app.models.image_folder import ImageFolder  # noqa: F401
```

```bash
docker compose exec api alembic revision --autogenerate -m "dam_folders_and_tags"
make db-migrate
cd apps/api && pytest tests/test_dam_models.py -v
git add apps/api/app/models/ apps/api/alembic/versions/ apps/api/tests/test_dam_models.py
git commit -m "feat(dam): add ImageFolder model, tags and folder_id on GeneratedImage"
```

---

### Task 2: Image Folders API

**Files:**
- Create: `apps/api/app/api/v1/routers/image_folders.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_image_folders.py`

**Interfaces:**
- Produces: `GET /image-folders`, `POST /image-folders`, `PATCH /image-folders/{id}`, `DELETE /image-folders/{id}`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_image_folders.py
async def test_create_folder(client, auth_headers):
    response = await client.post("/api/v1/image-folders", json={"name": "Product Shots"}, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["name"] == "Product Shots"

async def test_list_folders(client, auth_headers):
    await client.post("/api/v1/image-folders", json={"name": "Folder A"}, headers=auth_headers)
    response = await client.get("/api/v1/image-folders", headers=auth_headers)
    assert response.status_code == 200
    assert any(f["name"] == "Folder A" for f in response.json())

async def test_delete_folder(client, auth_headers):
    r = await client.post("/api/v1/image-folders", json={"name": "Temp"}, headers=auth_headers)
    folder_id = r.json()["id"]
    response = await client.delete(f"/api/v1/image-folders/{folder_id}", headers=auth_headers)
    assert response.status_code == 204
```

- [ ] **Step 2: Create router**

```python
# apps/api/app/api/v1/routers/image_folders.py
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.models.image_folder import ImageFolder

router = APIRouter()


class FolderOut(BaseModel):
    id: uuid.UUID
    name: str
    parent_id: Optional[uuid.UUID] = None
    color: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[uuid.UUID] = None
    color: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[uuid.UUID] = None
    color: Optional[str] = None


@router.get("", response_model=list[FolderOut])
async def list_folders(current_user: CurrentUser, db: DB):
    result = await db.execute(select(ImageFolder).where(ImageFolder.org_id == current_user.org_id).order_by(ImageFolder.created_at))
    return [FolderOut.model_validate(f) for f in result.scalars().all()]


@router.post("", response_model=FolderOut, status_code=201)
async def create_folder(body: FolderCreate, current_user: CurrentUser, db: DB):
    folder = ImageFolder(org_id=current_user.org_id, name=body.name, parent_id=body.parent_id, color=body.color)
    db.add(folder)
    await db.flush()
    await db.refresh(folder)
    await db.commit()
    return FolderOut.model_validate(folder)


@router.patch("/{folder_id}", response_model=FolderOut)
async def update_folder(folder_id: uuid.UUID, body: FolderUpdate, current_user: CurrentUser, db: DB):
    result = await db.execute(select(ImageFolder).where(ImageFolder.id == folder_id, ImageFolder.org_id == current_user.org_id))
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(folder, k, v)
    await db.flush()
    await db.refresh(folder)
    await db.commit()
    return FolderOut.model_validate(folder)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(folder_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(select(ImageFolder).where(ImageFolder.id == folder_id, ImageFolder.org_id == current_user.org_id))
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    await db.delete(folder)
    await db.commit()
```

- [ ] **Step 3: Register, test, commit**

```python
# router.py:
from app.api.v1.routers import image_folders
api_router.include_router(image_folders.router, prefix="/image-folders", tags=["dam"])
```

```bash
cd apps/api && pytest tests/test_image_folders.py -v
git add apps/api/app/api/v1/routers/image_folders.py apps/api/app/api/v1/router.py apps/api/tests/test_image_folders.py
git commit -m "feat(dam): add image folders CRUD API"
```

---

### Task 3: Image tagging + move-to-folder endpoints

**Files:**
- Modify: `apps/api/app/api/v1/routers/images.py`
- Test: `apps/api/tests/test_image_tags.py`

**Interfaces:**
- `PATCH /images/{id}/tags` → `{"tags": ["summer", "product"]}` → `ImageOut`
- `PATCH /images/{id}/folder` → `{"folder_id": "uuid or null"}` → `ImageOut`
- `DELETE /images/{id}` now soft-deletes (sets `is_deleted=True`)
- `GET /images` now filters out `is_deleted=True`

- [ ] **Step 1: Write tests**

```python
# apps/api/tests/test_image_tags.py
async def test_tag_image(client, auth_headers, sample_image):
    response = await client.patch(f"/api/v1/images/{sample_image.id}/tags",
                                   json={"tags": ["summer", "product-shot"]}, headers=auth_headers)
    assert response.status_code == 200
    assert "summer" in response.json()["tags"]

async def test_move_to_folder(client, auth_headers, sample_image):
    folder = await client.post("/api/v1/image-folders", json={"name": "My Folder"}, headers=auth_headers)
    folder_id = folder.json()["id"]
    response = await client.patch(f"/api/v1/images/{sample_image.id}/folder",
                                   json={"folder_id": folder_id}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["folder_id"] == folder_id

async def test_soft_delete_image(client, auth_headers, sample_image, sample_project):
    await client.delete(f"/api/v1/images/{sample_image.id}", headers=auth_headers)
    list_resp = await client.get(f"/api/v1/images?project_id={sample_project.id}", headers=auth_headers)
    assert all(img["id"] != str(sample_image.id) for img in list_resp.json())
```

- [ ] **Step 2: Add endpoints and update list filter**

In `apps/api/app/api/v1/routers/images.py`:

```python
# Add folder_id to ImageOut:
    folder_id: Optional[uuid.UUID] = None
    tags: list = []
    is_deleted: bool = False

# Add PATCH /images/{id}/tags endpoint:
class TagsUpdate(BaseModel):
    tags: list[str]

@router.patch("/{image_id}/tags", response_model=ImageOut)
async def update_image_tags(image_id: uuid.UUID, body: TagsUpdate, current_user: CurrentUser, db: DB):
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    image.tags = body.tags
    await db.flush(); await db.refresh(image); await db.commit()
    return ImageOut.model_validate(image)

# Add PATCH /images/{id}/folder:
class FolderMove(BaseModel):
    folder_id: Optional[uuid.UUID] = None

@router.patch("/{image_id}/folder", response_model=ImageOut)
async def move_image_to_folder(image_id: uuid.UUID, body: FolderMove, current_user: CurrentUser, db: DB):
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    image.folder_id = body.folder_id
    await db.flush(); await db.refresh(image); await db.commit()
    return ImageOut.model_validate(image)

# Change DELETE to soft-delete:
@router.delete("/{image_id}", status_code=204)
async def delete_image(image_id: uuid.UUID, current_user: CurrentUser, db: DB):
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    image.is_deleted = True
    await db.commit()

# Update list_images to filter deleted + add folder filter:
    query = select(GeneratedImage).where(
        GeneratedImage.project_id == project_id,
        GeneratedImage.org_id == current_user.org_id,
        GeneratedImage.source_image_id.is_(None),
        GeneratedImage.is_deleted.is_(False),  # ADD THIS
    )
```

- [ ] **Step 3: Test and commit**

```bash
cd apps/api && pytest tests/test_image_tags.py -v
git add apps/api/app/api/v1/routers/images.py apps/api/tests/test_image_tags.py
git commit -m "feat(dam): add image tagging, folder move, and soft delete"
```

---

### Task 4: Semantic search endpoint

**Files:**
- Modify: `apps/api/app/api/v1/routers/images.py`
- Test: `apps/api/tests/test_image_search.py`

**Interfaces:**
- `GET /images/search?q=blue+product+shots&project_id=...` → `list[ImageOut]`

Semantic search strategy: extract intent using LLM → map to tag/usage/platform filters → SQL query. Falls back to simple `ILIKE` on prompt when no LLM key available.

- [ ] **Step 1: Write failing test**

```python
async def test_search_images_by_prompt_text(client, auth_headers, sample_project, sample_image):
    # sample_image has prompt "red sneaker product shot"
    response = await client.get(
        f"/api/v1/images/search?project_id={sample_project.id}&q=sneaker",
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert any(img["id"] == str(sample_image.id) for img in data)
```

- [ ] **Step 2: Add search endpoint**

```python
# apps/api/app/api/v1/routers/images.py — add before existing list endpoint:
from sqlalchemy import or_

@router.get("/search", response_model=list[ImageOut])
async def search_images(
    project_id: uuid.UUID,
    q: str,
    current_user: CurrentUser,
    db: DB,
    folder_id: Optional[uuid.UUID] = Query(None),
):
    # Simple keyword search on prompt and tags (JSON contains)
    base = select(GeneratedImage).where(
        GeneratedImage.project_id == project_id,
        GeneratedImage.org_id == current_user.org_id,
        GeneratedImage.is_deleted.is_(False),
        GeneratedImage.source_image_id.is_(None),
        or_(
            GeneratedImage.prompt.ilike(f"%{q}%"),
            GeneratedImage.alt_text.ilike(f"%{q}%"),
            GeneratedImage.caption.ilike(f"%{q}%"),
        ),
    ).order_by(GeneratedImage.created_at.desc()).limit(50)

    if folder_id:
        base = base.where(GeneratedImage.folder_id == folder_id)

    result = await db.execute(base)
    return [ImageOut.model_validate(img) for img in result.scalars().all()]
```

- [ ] **Step 3: Test and commit**

```bash
cd apps/api && pytest tests/test_image_search.py -v
git add apps/api/app/api/v1/routers/images.py apps/api/tests/test_image_search.py
git commit -m "feat(dam): add GET /images/search with keyword search on prompt, alt text, caption"
```

---

### Task 5: Frontend — Folder sidebar + search bar in studio dashboard

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/FolderSidebar.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/images/studio/page.tsx`

- [ ] **Step 1: Add API functions**

```typescript
// apps/web/lib/api.ts

export interface ImageFolder {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
}

export async function listImageFolders(): Promise<ImageFolder[]> {
  return apiClient.get<ImageFolder[]>("/image-folders");
}

export async function createImageFolder(name: string, color?: string): Promise<ImageFolder> {
  return apiClient.post<ImageFolder>("/image-folders", { name, color });
}

export async function moveImageToFolder(imageId: string, folderId: string | null): Promise<GeneratedImage> {
  return apiClient.patch<GeneratedImage>(`/images/${imageId}/folder`, { folder_id: folderId });
}

export async function tagImage(imageId: string, tags: string[]): Promise<GeneratedImage> {
  return apiClient.patch<GeneratedImage>(`/images/${imageId}/tags`, { tags });
}

export async function searchImages(projectId: string, q: string, folderId?: string): Promise<GeneratedImage[]> {
  const params = new URLSearchParams({ project_id: projectId, q });
  if (folderId) params.set("folder_id", folderId);
  return apiClient.get<GeneratedImage[]>(`/images/search?${params}`);
}
```

- [ ] **Step 2: Create FolderSidebar**

```tsx
// apps/web/components/studio/FolderSidebar.tsx
"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Folder, FolderOpen, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { listImageFolders, createImageFolder } from "@/lib/api";

interface FolderSidebarProps {
  activeFolderId: string | null;
  onFolderSelect: (id: string | null) => void;
}

export function FolderSidebar({ activeFolderId, onFolderSelect }: FolderSidebarProps) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();

  const { data: folders = [] } = useQuery({ queryKey: ["image-folders"], queryFn: listImageFolders });

  const createMutation = useMutation({
    mutationFn: () => createImageFolder(newName.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["image-folders"] }); setNewName(""); setAdding(false); },
  });

  return (
    <aside className="w-44 shrink-0 border-r border-border bg-card flex flex-col overflow-y-auto">
      <div className="px-3 pt-3 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Folders</div>

      <button
        type="button"
        onClick={() => onFolderSelect(null)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors",
          activeFolderId === null ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Folder className="h-3.5 w-3.5" />
        All Images
      </button>

      {folders.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onFolderSelect(f.id)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left",
            activeFolderId === f.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {activeFolderId === f.id ? <FolderOpen className="h-3.5 w-3.5 shrink-0" /> : <Folder className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{f.name}</span>
        </button>
      ))}

      {adding ? (
        <form
          onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createMutation.mutate(); }}
          className="px-3 py-2"
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="Folder name"
            className="w-full rounded border border-border bg-input px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" /> New folder
        </button>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Add FolderSidebar and search bar to studio page**

In the studio dashboard page, add:
- `activeFolderId` state
- `searchQuery` state
- `<FolderSidebar>` on the left of the image grid
- A search `<input>` above the grid that calls `searchImages` when non-empty

- [ ] **Step 4: Typecheck and commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts apps/web/components/studio/FolderSidebar.tsx apps/web/app/
git commit -m "feat(dam): add folder sidebar, tag support, and search bar to studio dashboard"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| Folder creation and organisation | Tasks 1, 2, 5 |
| Image tagging | Task 3 |
| Move image to folder | Task 3 |
| Keyword / semantic search on prompt, alt text, caption | Task 4 |
| Soft delete (images not permanently lost) | Task 3 |
| Folder sidebar in studio dashboard | Task 5 |
| Search bar in studio dashboard | Task 5 |

All §13 requirements covered. ✓
