# Magic Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a single URL (or a typed description), auto-discover a business and provision a complete AI Workspace — Brand DNA, knowledge embeddings, and seeded employee memory — through a full-screen `/onboarding` flow.

**Architecture:** A backend discovery pipeline (multi-page crawl → deterministic HTML extractors → one structured Claude synthesis call) runs as an arq background job that writes stage/progress/partial results to a `discovery_runs` row. The frontend polls it, lets the user edit everything, then calls a provisioning endpoint that writes the confirmed profile into the exact stores employees already read (BrandKit, BrandVoice, ProjectDocument embeddings, EmployeeMemory). No employee code changes.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + arq (backend), pytest; Next.js 14 App Router + TanStack Query + Tailwind CSS variables + Lucide + react-i18next (frontend), verified with `npm run typecheck`.

## Global Constraints

- Backend: Python 3.11+, async/await throughout; SQLAlchemy 2 async; new endpoints in `apps/api/app/api/v1/routers/`, business logic in `apps/api/app/services/`; register routers in `apps/api/app/api/v1/router.py`; register arq tasks in `apps/api/app/workers/worker.py`.
- Migrations: raw `op.execute(... IF NOT EXISTS ...)` style matching existing migrations; `down_revision` chains from current head `a6p7q8r9s0t1`.
- LLM calls go through `app.services.llm_service.call_llm(provider, model, api_key, system_prompt, user_prompt, locale, max_tokens)`; pick `(provider, model)` via `app.services.agents.tiers.resolve_model(tier, weight, available)` with `available = list(keys)` from `llm_service.get_org_llm_keys(org_id, db)`.
- Frontend: Next.js 14 App Router, TypeScript; **always** use `apiClient` from `lib/api.ts` (never raw `fetch`); all user-visible strings through `t("key")`; colors only via CSS variables (`hsl(var(--primary))`, `bg-card`, `text-muted-foreground`, …) — never hard-code colors; `cn()` from `lib/cn.ts`; `animate-fade-in`/`animate-scale-in`/`animate-slide-up` for motion; respect `prefers-reduced-motion`.
- **No emoji anywhere** — in code, UI text, comments, or commit messages. Employee icons use Lucide, not emoji.
- Commit style: `feat(onboarding): …` / `fix(onboarding): …`. End every commit message body with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Branch: work on `feat/magic-onboarding` (already created; the design spec is committed there).
- Frontend has no test framework: the "test" gate for frontend tasks is `cd apps/web && npm run typecheck` passing, plus the described visual check.

## The shared discovery result contract

Every task references this JSON shape. It is stored in `discovery_runs.result` (JSONB), returned by the status/patch endpoints, edited by the frontend, and consumed by provisioning. Treat every field as optional/nullable on read (graceful degradation); defaults shown are what an empty run returns.

```json
{
  "business": {
    "name": null, "domain": null, "industry": null, "country": null,
    "language": null, "timezone": null, "cms": null,
    "contact": { "email": null, "phone": null },
    "socials": {},
    "navigation": [], "description": null
  },
  "brand": {
    "logo_url": null, "colors": [], "primary_font": null, "secondary_font": null,
    "tone": null, "personality": [], "mission": null, "vision": null, "values": [],
    "voice_prompt": null, "vocabulary": [], "avoid_words": [],
    "cta_style": null, "reading_level": null, "emoji_policy": null
  },
  "products": [],
  "audience": [],
  "competitors": [],
  "seo": { "score": null, "title": null, "meta_description": null, "word_count": null, "issues": [], "suggested_keywords": [] },
  "goals": [], "success_metrics": []
}
```

- `products[]` item: `{ "name", "description", "category", "price", "benefits": [], "url", "image_url" }`
- `audience[]` item (ICP): `{ "label", "age", "gender", "country", "profession", "interests": [], "pains": [], "goals": [], "budget", "buying_behavior" }`
- `competitors[]` item: `{ "url", "name", "note" }`
- `socials` keys: any of `instagram|facebook|x|linkedin|youtube|pinterest|tiktok` → full URL.

A canonical empty result is produced by `empty_result()` in Task 3 and reused everywhere.

---

# PART A — Backend

### Task 1: `DiscoveryRun` model + migration

**Files:**
- Create: `apps/api/app/models/discovery.py`
- Modify: `apps/api/app/models/__init__.py` (export `DiscoveryRun`)
- Create: `apps/api/alembic/versions/b7q8r9s0t1u2_discovery_runs.py`
- Test: `apps/api/tests/test_discovery_model.py`

**Interfaces:**
- Produces: `DiscoveryRun` ORM model with columns `id, org_id, project_id, input_url, input_description, status, stage, progress, result (JSON), error, created_at, updated_at`. Status values: `"queued" | "running" | "done" | "error"`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_discovery_model.py
import uuid
import pytest
from app.models.discovery import DiscoveryRun


def test_discovery_run_defaults():
    run = DiscoveryRun(org_id=uuid.uuid4(), input_url="https://example.com")
    assert run.status == "queued"
    assert run.progress == 0
    assert run.result == {} or run.result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_discovery_model.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.discovery'`

- [ ] **Step 3: Write the model**

```python
# apps/api/app/models/discovery.py
import uuid

from sqlalchemy import String, Integer, Text, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class DiscoveryRun(Base, TimestampMixin):
    """One onboarding discovery job: crawl + extract + synthesise a business
    profile. The frontend polls this row for live progress; provisioning reads
    its ``result`` once the user confirms."""

    __tablename__ = "discovery_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # Null until the workspace is provisioned from this run.
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    input_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    input_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    stage: Mapped[str | None] = mapped_column(String(60), nullable=True)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    result: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Export the model**

In `apps/api/app/models/__init__.py`, add alongside the other imports:

```python
from app.models.discovery import DiscoveryRun  # noqa: F401
```

- [ ] **Step 5: Write the migration**

```python
# apps/api/alembic/versions/b7q8r9s0t1u2_discovery_runs.py
"""discovery_runs table

Revision ID: b7q8r9s0t1u2
Revises: a6p7q8r9s0t1
"""
from alembic import op

revision = "b7q8r9s0t1u2"
down_revision = "a6p7q8r9s0t1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS discovery_runs (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
            input_url VARCHAR(500),
            input_description TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            stage VARCHAR(60),
            progress INTEGER NOT NULL DEFAULT 0,
            result JSONB NOT NULL DEFAULT '{}'::jsonb,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_discovery_runs_org ON discovery_runs (org_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS discovery_runs")
```

- [ ] **Step 6: Run the model test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_discovery_model.py -v`
Expected: PASS

- [ ] **Step 7: Apply the migration**

Run: `make db-migrate`
Expected: alembic upgrades to `b7q8r9s0t1u2` with no error.

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/models/discovery.py apps/api/app/models/__init__.py apps/api/alembic/versions/b7q8r9s0t1u2_discovery_runs.py apps/api/tests/test_discovery_model.py
git commit -m "feat(onboarding): DiscoveryRun model and migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Brand DNA per-project migration

**Files:**
- Modify: `apps/api/app/models/brand_kit.py` (add `project_id`, drop org-unique constraint)
- Modify: `apps/api/app/models/brand_voice.py` (add `project_id`)
- Create: `apps/api/alembic/versions/c8r9s0t1u2v3_brand_per_project.py`
- Modify: `apps/api/app/api/v1/routers/brand_kit.py` (`_get_or_create` becomes project-scoped)
- Modify: `apps/api/app/api/v1/routers/brand_voice.py` (scope reads/writes by project)
- Test: `apps/api/tests/test_brand_per_project.py`

**Interfaces:**
- Produces: `BrandKit.project_id`, `BrandVoice.project_id` (nullable FK to `projects.id`). `brand_kit.get_or_create_for_project(project_id, org_id, db)` helper.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_brand_per_project.py
from app.models.brand_kit import BrandKit
from app.models.brand_voice import BrandVoice


def test_brand_models_have_project_id():
    assert hasattr(BrandKit, "project_id")
    assert hasattr(BrandVoice, "project_id")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_brand_per_project.py -v`
Expected: FAIL (`project_id` attribute missing)

- [ ] **Step 3: Add `project_id` to both models**

In `apps/api/app/models/brand_kit.py`: remove the `__table_args__` org-unique constraint line and add after `org_id`:

```python
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
```

In `apps/api/app/models/brand_voice.py`, add to `BrandVoice` after `org_id`:

```python
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
```

- [ ] **Step 4: Write the migration**

```python
# apps/api/alembic/versions/c8r9s0t1u2v3_brand_per_project.py
"""brand kit/voice become per-project

Revision ID: c8r9s0t1u2v3
Revises: b7q8r9s0t1u2
"""
from alembic import op

revision = "c8r9s0t1u2v3"
down_revision = "b7q8r9s0t1u2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE brand_kits DROP CONSTRAINT IF EXISTS uq_brand_kit_org")
    # Backfill existing rows to the org's first project (oldest).
    op.execute("""
        UPDATE brand_kits bk SET project_id = (
            SELECT p.id FROM projects p WHERE p.org_id = bk.org_id
            ORDER BY p.created_at ASC LIMIT 1
        ) WHERE bk.project_id IS NULL
    """)
    op.execute("""
        UPDATE brand_voices bv SET project_id = (
            SELECT p.id FROM projects p WHERE p.org_id = bv.org_id
            ORDER BY p.created_at ASC LIMIT 1
        ) WHERE bv.project_id IS NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_brand_kits_project ON brand_kits (project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_brand_voices_project ON brand_voices (project_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_brand_voices_project")
    op.execute("DROP INDEX IF EXISTS ix_brand_kits_project")
    op.execute("ALTER TABLE brand_voices DROP COLUMN IF EXISTS project_id")
    op.execute("ALTER TABLE brand_kits DROP COLUMN IF EXISTS project_id")
```

- [ ] **Step 5: Make the brand_kit router project-scoped**

In `apps/api/app/api/v1/routers/brand_kit.py`, replace `_get_or_create` and add a reusable helper. The router endpoints take an optional `project_id` query param; when absent they fall back to the org's first project (keeps existing callers working).

```python
from app.models.project import Project

async def get_or_create_for_project(project_id: uuid.UUID, org_id: uuid.UUID, db) -> BrandKit:
    result = await db.execute(
        select(BrandKit).where(BrandKit.project_id == project_id, BrandKit.org_id == org_id)
    )
    kit = result.scalar_one_or_none()
    if kit is None:
        kit = BrandKit(org_id=org_id, project_id=project_id, colors=[])
        db.add(kit)
        await db.flush()
        await db.refresh(kit)
    return kit


async def _resolve_project(project_id: uuid.UUID | None, org_id: uuid.UUID, db) -> uuid.UUID:
    if project_id is not None:
        return project_id
    row = await db.execute(
        select(Project.id).where(Project.org_id == org_id).order_by(Project.created_at.asc()).limit(1)
    )
    pid = row.scalar_one_or_none()
    if pid is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No project for this org")
    return pid
```

Update `get_brand_kit` / `update_brand_kit` signatures to accept `project_id: uuid.UUID | None = None` and call `await get_or_create_for_project(await _resolve_project(project_id, current_user.org_id, db), current_user.org_id, db)`.

- [ ] **Step 6: Mirror the same project scoping in `brand_voice.py`**

Where `brand_voice.py` queries `BrandVoice` by `org_id`, add `.where(BrandVoice.project_id == project_id)` using the same `_resolve_project` fallback (import it from `brand_kit`). New `BrandVoice` rows set `project_id`.

- [ ] **Step 7: Run tests + migration**

Run: `cd apps/api && python -m pytest tests/test_brand_per_project.py -v` → PASS
Run: `make db-migrate` → upgrades to `c8r9s0t1u2v3`

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/models/brand_kit.py apps/api/app/models/brand_voice.py apps/api/app/api/v1/routers/brand_kit.py apps/api/app/api/v1/routers/brand_voice.py apps/api/alembic/versions/c8r9s0t1u2v3_brand_per_project.py apps/api/tests/test_brand_per_project.py
git commit -m "feat(onboarding): scope Brand DNA per project

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Deterministic extractors

**Files:**
- Create: `apps/api/app/services/discovery/__init__.py` (empty)
- Create: `apps/api/app/services/discovery/extractors.py`
- Test: `apps/api/tests/test_discovery_extractors.py`
- Test fixture: `apps/api/tests/fixtures/sample_page.html`

**Interfaces:**
- Produces:
  - `empty_result() -> dict` — the canonical empty discovery result (the contract above).
  - `extract_from_page(html: str, base_url: str) -> dict` — returns a **partial** result dict populated only with deterministic fields: `business.name/socials/navigation/language/contact/cms`, `brand.logo_url/colors/primary_font/secondary_font`, `products` (from JSON-LD `Product`).
  - `merge_result(base: dict, patch: dict) -> dict` — deep-merges a partial into a result, list fields de-duplicated, scalar fields only overwritten when the patch value is truthy and the base is empty.

- [ ] **Step 1: Write the fixture**

```html
<!-- apps/api/tests/fixtures/sample_page.html -->
<!doctype html><html lang="fr"><head>
<meta name="theme-color" content="#7C3AED">
<meta name="generator" content="WordPress 6.5">
<link rel="icon" href="/favicon.png">
<style>body{font-family:"Space Grotesk",sans-serif} h1{font-family:"DM Sans"}</style>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Acme Cafe",
 "email":"hi@acme.test","telephone":"+33123456789"}
</script>
</head><body>
<nav><a href="/about">About</a><a href="/shop">Shop</a><a href="/blog">Blog</a></nav>
<a href="https://instagram.com/acmecafe">IG</a>
<a href="https://www.linkedin.com/company/acme">LI</a>
<script type="application/ld+json">
{"@type":"Product","name":"House Blend","description":"Signature roast",
 "offers":{"price":"12.00"}}
</script>
</body></html>
```

- [ ] **Step 2: Write the failing test**

```python
# apps/api/tests/test_discovery_extractors.py
from pathlib import Path
from app.services.discovery import extractors

HTML = (Path(__file__).parent / "fixtures" / "sample_page.html").read_text()


def test_empty_result_shape():
    r = extractors.empty_result()
    assert r["business"]["socials"] == {}
    assert r["brand"]["colors"] == []
    assert r["products"] == []


def test_extract_core_fields():
    p = extractors.extract_from_page(HTML, "https://acme.test")
    assert p["business"]["name"] == "Acme Cafe"
    assert p["business"]["language"] == "fr"
    assert p["business"]["cms"] == "WordPress"
    assert p["business"]["contact"]["email"] == "hi@acme.test"
    assert "instagram" in p["business"]["socials"]
    assert p["business"]["socials"]["linkedin"].startswith("https://")
    assert p["brand"]["logo_url"] == "https://acme.test/favicon.png"
    assert "#7C3AED" in p["brand"]["colors"]
    assert p["brand"]["primary_font"] == "Space Grotesk"
    assert any(prod["name"] == "House Blend" for prod in p["products"])


def test_merge_prefers_existing_truthy():
    base = extractors.empty_result()
    base["business"]["name"] = "Existing"
    merged = extractors.merge_result(base, {"business": {"name": "New"}})
    assert merged["business"]["name"] == "Existing"
    merged2 = extractors.merge_result(extractors.empty_result(), {"business": {"name": "New"}})
    assert merged2["business"]["name"] == "New"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_discovery_extractors.py -v`
Expected: FAIL (`ModuleNotFoundError`)

- [ ] **Step 4: Write the extractors**

```python
# apps/api/app/services/discovery/extractors.py
"""Deterministic (no-LLM) extraction of structured signals from crawled HTML.

These are the fields an LLM cannot reliably return: exact hex colours, the
logo URL, social handles, JSON-LD products. Everything here degrades to empty
rather than raising."""
import copy
import json
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

_SOCIAL_HOSTS = {
    "instagram.com": "instagram", "facebook.com": "facebook", "x.com": "x",
    "twitter.com": "x", "linkedin.com": "linkedin", "youtube.com": "youtube",
    "pinterest.com": "pinterest", "tiktok.com": "tiktok",
}
_HEX_RE = re.compile(r"#[0-9a-fA-F]{6}\b")
_FONT_RE = re.compile(r"font-family\s*:\s*([^;{}]+)", re.I)
_CMS_HINTS = [("WordPress", "wordpress"), ("Shopify", "shopify"),
              ("Wix", "wix"), ("Squarespace", "squarespace"), ("Webflow", "webflow")]


def empty_result() -> dict:
    return {
        "business": {"name": None, "domain": None, "industry": None, "country": None,
                     "language": None, "timezone": None, "cms": None,
                     "contact": {"email": None, "phone": None}, "socials": {},
                     "navigation": [], "description": None},
        "brand": {"logo_url": None, "colors": [], "primary_font": None, "secondary_font": None,
                  "tone": None, "personality": [], "mission": None, "vision": None, "values": [],
                  "voice_prompt": None, "vocabulary": [], "avoid_words": [],
                  "cta_style": None, "reading_level": None, "emoji_policy": None},
        "products": [], "audience": [], "competitors": [],
        "seo": {"score": None, "title": None, "meta_description": None,
                "word_count": None, "issues": [], "suggested_keywords": []},
        "goals": [], "success_metrics": [],
    }


def _jsonld_blocks(soup) -> list[dict]:
    out = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except Exception:
            continue
        out.extend(data if isinstance(data, list) else [data])
    return [b for b in out if isinstance(b, dict)]


def _clean_fonts(decl: str) -> str | None:
    first = decl.split(",")[0].strip().strip('"').strip("'")
    generic = {"sans-serif", "serif", "monospace", "system-ui", "inherit", "cursive"}
    return first if first and first.lower() not in generic else None


def extract_from_page(html: str, base_url: str) -> dict:
    r = empty_result()
    if not html:
        return r
    soup = BeautifulSoup(html, "html.parser")
    b, brand = r["business"], r["brand"]

    html_tag = soup.find("html")
    if html_tag and html_tag.get("lang"):
        b["language"] = html_tag["lang"].split("-")[0].strip() or None

    gen = soup.find("meta", attrs={"name": "generator"})
    haystack = ((gen.get("content") if gen else "") + " " + html[:4000]).lower()
    for label, needle in _CMS_HINTS:
        if needle in haystack:
            b["cms"] = label
            break

    for block in _jsonld_blocks(soup):
        t = block.get("@type", "")
        types = t if isinstance(t, list) else [t]
        if any(x in ("Organization", "LocalBusiness", "WebSite") for x in types):
            b["name"] = b["name"] or block.get("name")
            b["contact"]["email"] = b["contact"]["email"] or block.get("email")
            b["contact"]["phone"] = b["contact"]["phone"] or block.get("telephone")
        if "Product" in types:
            offers = block.get("offers") or {}
            price = offers.get("price") if isinstance(offers, dict) else None
            r["products"].append({
                "name": block.get("name"), "description": block.get("description"),
                "category": block.get("category"), "price": price,
                "benefits": [], "url": block.get("url"),
                "image_url": block.get("image") if isinstance(block.get("image"), str) else None,
            })

    if not b["name"]:
        og = soup.find("meta", property="og:site_name") or soup.find("meta", property="og:title")
        if og and og.get("content"):
            b["name"] = og["content"].strip()
        elif soup.title and soup.title.string:
            b["name"] = soup.title.string.split("|")[0].split("-")[0].strip()

    for a in soup.find_all("a", href=True):
        host = urlparse(a["href"]).netloc.lower().removeprefix("www.")
        for known, key in _SOCIAL_HOSTS.items():
            if host.endswith(known) and key not in b["socials"]:
                b["socials"][key] = a["href"] if a["href"].startswith("http") else urljoin(base_url, a["href"])

    nav = soup.find("nav")
    if nav:
        b["navigation"] = [a.get_text(strip=True) for a in nav.find_all("a") if a.get_text(strip=True)][:12]

    icon = soup.find("link", rel=lambda v: v and "icon" in v.lower())
    og_img = soup.find("meta", property="og:image")
    logo = (icon.get("href") if icon else None) or (og_img.get("content") if og_img else None)
    if logo:
        brand["logo_url"] = logo if logo.startswith("http") else urljoin(base_url, logo)

    colors = []
    meta_theme = soup.find("meta", attrs={"name": "theme-color"})
    if meta_theme and meta_theme.get("content", "").startswith("#"):
        colors.append(meta_theme["content"].upper())
    for m in _HEX_RE.findall(html):
        u = m.upper()
        if u not in colors:
            colors.append(u)
    brand["colors"] = colors[:6]

    fonts = []
    for decl in _FONT_RE.findall(html):
        f = _clean_fonts(decl)
        if f and f not in fonts:
            fonts.append(f)
    brand["primary_font"] = fonts[0] if fonts else None
    brand["secondary_font"] = fonts[1] if len(fonts) > 1 else None
    return r


def _merge_dict(base: dict, patch: dict) -> dict:
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge_dict(base[k], v)
        elif isinstance(v, list):
            existing = base.get(k) or []
            seen = {json.dumps(x, sort_keys=True) for x in existing}
            for item in v:
                key = json.dumps(item, sort_keys=True)
                if key not in seen:
                    existing.append(item)
                    seen.add(key)
            base[k] = existing
        else:
            if v and not base.get(k):
                base[k] = v
    return base


def merge_result(base: dict, patch: dict) -> dict:
    return _merge_dict(copy.deepcopy(base), patch)
```

- [ ] **Step 5: Ensure `beautifulsoup4` is available**

Run: `cd apps/api && python -c "import bs4; print(bs4.__version__)"`
Expected: prints a version. If `ModuleNotFoundError`, add `beautifulsoup4` to `apps/api/requirements.txt` (or `pyproject.toml`) and `pip install beautifulsoup4`. (The crawler already parses HTML; bs4 is almost certainly present.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_discovery_extractors.py -v`
Expected: PASS (all three tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/discovery/__init__.py apps/api/app/services/discovery/extractors.py apps/api/tests/test_discovery_extractors.py apps/api/tests/fixtures/sample_page.html
git commit -m "feat(onboarding): deterministic HTML discovery extractors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Crawl map (which pages to fetch)

**Files:**
- Create: `apps/api/app/services/discovery/crawl_map.py`
- Test: `apps/api/tests/test_crawl_map.py`

**Interfaces:**
- Consumes: the crawler microservice at `settings.CRAWLER_SERVICE_URL/crawl` (POST `{url}` → page dict with `internal_links: [{href, text}]`, `text`, `title`, etc.).
- Produces:
  - `select_urls(home_url: str, home_page: dict, max_pages: int = 8) -> list[str]` — pure function returning the home URL plus up to `max_pages-1` same-domain page URLs prioritised by path keywords (`about, product, shop, service, blog, contact, pricing`).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_crawl_map.py
from app.services.discovery.crawl_map import select_urls


def test_select_prioritises_key_pages_and_caps():
    home = "https://acme.test"
    page = {"internal_links": [
        {"href": "https://acme.test/about", "text": "About"},
        {"href": "https://acme.test/blog/post-1", "text": "Post"},
        {"href": "https://acme.test/shop", "text": "Shop"},
        {"href": "https://other.test/x", "text": "Off"},
        {"href": "https://acme.test/random-1", "text": "R1"},
        {"href": "https://acme.test/random-2", "text": "R2"},
    ]}
    urls = select_urls(home, page, max_pages=4)
    assert urls[0] == home
    assert "https://acme.test/about" in urls
    assert "https://acme.test/shop" in urls
    assert "https://other.test/x" not in urls  # off-domain excluded
    assert len(urls) == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_crawl_map.py -v`
Expected: FAIL (`ModuleNotFoundError`)

- [ ] **Step 3: Write crawl_map**

```python
# apps/api/app/services/discovery/crawl_map.py
"""Decide which pages a discovery run should fetch, from the homepage's links."""
from urllib.parse import urlparse, urldefrag

_PRIORITY = ["about", "product", "shop", "collection", "service",
             "pricing", "contact", "blog"]


def _score(path: str) -> int:
    low = path.lower()
    for i, kw in enumerate(_PRIORITY):
        if kw in low:
            return i
    return len(_PRIORITY)


def select_urls(home_url: str, home_page: dict, max_pages: int = 8) -> list[str]:
    base_host = urlparse(home_url).netloc.lower().removeprefix("www.")
    seen = {home_url.rstrip("/")}
    candidates: list[str] = []
    for link in home_page.get("internal_links") or []:
        href = urldefrag((link.get("href") or "")).url.rstrip("/")
        if not href:
            continue
        host = urlparse(href).netloc.lower().removeprefix("www.")
        if host and host != base_host:
            continue
        if href in seen:
            continue
        seen.add(href)
        candidates.append(href)
    candidates.sort(key=lambda u: _score(urlparse(u).path))
    return [home_url] + candidates[: max(0, max_pages - 1)]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_crawl_map.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/discovery/crawl_map.py apps/api/tests/test_crawl_map.py
git commit -m "feat(onboarding): crawl-map page selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: LLM synthesis

**Files:**
- Create: `apps/api/app/services/discovery/synthesis.py`
- Test: `apps/api/tests/test_discovery_synthesis.py`

**Interfaces:**
- Consumes: `extractors.empty_result`, `extractors.merge_result`; `llm_service.call_llm`.
- Produces:
  - `build_prompt(text: str, partial: dict) -> tuple[str, str]` — returns `(system_prompt, user_prompt)`.
  - `parse_synthesis(raw: str) -> dict` — parses the model's JSON (tolerant of code fences / surrounding prose) into a **partial** result dict with only interpretive fields; malformed → `{}`.
  - `async synthesise(text: str, partial: dict, *, provider, model, api_key, locale) -> dict` — calls the LLM and returns `merge_result(partial, parse_synthesis(raw))`; on any LLM error returns `partial` unchanged.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_discovery_synthesis.py
from app.services.discovery import synthesis, extractors


def test_parse_handles_code_fence_and_prose():
    raw = 'Here you go:\n```json\n{"business":{"industry":"Coffee"},' \
          '"brand":{"tone":"warm"},"audience":[{"label":"Locals"}],' \
          '"goals":["Increase SEO traffic"]}\n```\nHope that helps.'
    p = synthesis.parse_synthesis(raw)
    assert p["business"]["industry"] == "Coffee"
    assert p["brand"]["tone"] == "warm"
    assert p["audience"][0]["label"] == "Locals"
    assert "Increase SEO traffic" in p["goals"]


def test_parse_malformed_returns_empty():
    assert synthesis.parse_synthesis("not json at all") == {}


def test_build_prompt_mentions_json_and_business():
    sysp, userp = synthesis.build_prompt("We roast coffee in Lyon.", extractors.empty_result())
    assert "JSON" in sysp
    assert "coffee" in userp.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_discovery_synthesis.py -v`
Expected: FAIL (`ModuleNotFoundError`)

- [ ] **Step 3: Write synthesis**

```python
# apps/api/app/services/discovery/synthesis.py
"""One structured LLM call that turns crawled text + deterministic signals into
the interpretive discovery fields (industry, mission, tone, audience, goals…)."""
import json
import logging
import re

from app.services.discovery.extractors import empty_result, merge_result
from app.services.llm_service import call_llm

logger = logging.getLogger(__name__)

_ALLOWED_TOP = {"business", "brand", "audience", "competitors", "goals",
                "success_metrics", "products", "seo"}

_SYSTEM = (
    "You are a senior brand and market strategist. Given a company's website "
    "text and already-extracted signals, infer its business profile. "
    "Respond with a single valid JSON object and nothing else. Use only these "
    "top-level keys: business, brand, audience, goals, success_metrics, "
    "competitors. In business set: industry, country, timezone, description "
    "(2-3 sentences on what they do). In brand set: tone, personality (array), "
    "mission, vision, values (array), voice_prompt (one paragraph an AI writer "
    "can follow), vocabulary (array of preferred words), avoid_words (array), "
    "cta_style, reading_level, emoji_policy. audience is an array of 1-2 ICP "
    "objects with: label, age, gender, country, profession, interests (array), "
    "pains (array), goals (array), budget, buying_behavior. goals is an array "
    "of 3-6 concrete marketing goals. success_metrics is an array of 3-5 "
    "metrics. competitors is an array of {name, url, note}. Leave a field out "
    "if you cannot infer it. Never invent a URL."
)


def build_prompt(text: str, partial: dict) -> tuple[str, str]:
    signals = {
        "name": partial["business"].get("name"),
        "language": partial["business"].get("language"),
        "socials": list(partial["business"].get("socials", {}).keys()),
        "navigation": partial["business"].get("navigation"),
        "products": [p.get("name") for p in partial.get("products", []) if p.get("name")],
        "colors": partial["brand"].get("colors"),
    }
    user = (
        "Known signals (already extracted, do not contradict):\n"
        + json.dumps(signals, ensure_ascii=False)
        + "\n\nWebsite text (may be truncated):\n"
        + text[:12000]
    )
    return _SYSTEM, user


def parse_synthesis(raw: str) -> dict:
    if not raw:
        return {}
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if k in _ALLOWED_TOP}


async def synthesise(text: str, partial: dict, *, provider: str, model: str,
                     api_key: str, locale: str = "en") -> dict:
    if not text.strip():
        return partial
    sysp, userp = build_prompt(text, partial)
    try:
        raw = await call_llm(provider, model, api_key, sysp, userp, locale=locale, max_tokens=2000)
    except Exception:
        logger.exception("discovery synthesis LLM call failed")
        return partial
    return merge_result(partial, parse_synthesis(raw))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_discovery_synthesis.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/discovery/synthesis.py apps/api/tests/test_discovery_synthesis.py
git commit -m "feat(onboarding): LLM synthesis of interpretive discovery fields

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Discovery orchestrator service + arq task

**Files:**
- Create: `apps/api/app/services/discovery_service.py`
- Create: `apps/api/app/workers/tasks/discovery_tasks.py`
- Modify: `apps/api/app/workers/worker.py` (import + register `run_discovery`)
- Test: `apps/api/tests/test_discovery_service.py`

**Interfaces:**
- Consumes: `crawl_map.select_urls`, `extractors.*`, `synthesis.synthesise`, `competitor_service.scan_scorecard`, `llm_service.get_org_llm_keys`, `tiers.resolve_model`; the crawler microservice.
- Produces:
  - `async run_discovery_pipeline(run_id: uuid.UUID, fetch=None) -> None` — the orchestration core, updating the `DiscoveryRun` row through stages. `fetch` is an injectable `async (url) -> dict` crawler (defaults to the real microservice) so tests avoid network.
  - Stage labels (exact strings written to `DiscoveryRun.stage`): `"Analyzing website"`, `"Reading pages"`, `"Understanding products"`, `"Finding competitors"`, `"Analyzing SEO"`, `"Building profile"`, `"Done"`.
  - The arq task `async run_discovery(ctx, run_id: str)` wraps `run_discovery_pipeline`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_discovery_service.py
import uuid
import pytest
from app.services import discovery_service
from app.services.discovery import synthesis


@pytest.mark.asyncio
async def test_pipeline_populates_and_completes(db_session, seed_org_and_run, monkeypatch):
    run = seed_org_and_run(url="https://acme.test")

    async def fake_fetch(url):
        return {"url": url, "status_code": 200,
                "internal_links": [{"href": "https://acme.test/about", "text": "About"}],
                "text": "Acme roasts specialty coffee in Lyon.",
                "title": "Acme Cafe", "h2": ["Our beans"], "word_count": 400}

    async def fake_synth(text, partial, **kw):
        partial["business"]["industry"] = "Coffee"
        return partial

    async def fake_model(org_id, db):
        return ("anthropic", "claude-opus-4-8", "key")

    monkeypatch.setattr(synthesis, "synthesise", fake_synth)
    monkeypatch.setattr(discovery_service, "_org_model", fake_model)

    await discovery_service.run_discovery_pipeline(run.id, fetch=fake_fetch)

    refreshed = await db_session.get(type(run), run.id)
    assert refreshed.status == "done"
    assert refreshed.progress == 100
    assert refreshed.result["business"]["industry"] == "Coffee"
    assert refreshed.result["business"]["domain"] == "https://acme.test"
```

Add fixtures to `apps/api/tests/conftest.py` if not present:

```python
# apps/api/tests/conftest.py  (add if missing)
import uuid
import pytest
from app.models.discovery import DiscoveryRun
from app.models.organization import Organization


@pytest.fixture
def seed_org_and_run(db_session):
    def _make(url=None, description=None):
        org = Organization(id=uuid.uuid4(), name="Test Org")
        db_session.add(org)
        run = DiscoveryRun(id=uuid.uuid4(), org_id=org.id, input_url=url,
                           input_description=description, result={})
        db_session.add(run)
        # tests run against a sync-committed session fixture
        import asyncio
        asyncio.get_event_loop().run_until_complete(db_session.commit())
        return run
    return _make
```

> If `apps/api/tests/conftest.py` already provides an async `db_session` and org factory, reuse those instead of the snippet above — match the existing fixture style rather than duplicating it. Inspect a passing async test (e.g. `tests/test_content_plans.py`) first and mirror its fixtures.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_discovery_service.py -v`
Expected: FAIL (`ModuleNotFoundError: app.services.discovery_service`)

- [ ] **Step 3: Write the orchestrator**

```python
# apps/api/app/services/discovery_service.py
"""Runs a DiscoveryRun through its stages and writes progress + result.

Reuses the crawler microservice, the deterministic extractors, one LLM
synthesis call, and the existing SEO scorecard. Never raises out of the
pipeline: a failed stage degrades to a partial result."""
import logging
import uuid

import httpx

from app.core.config import settings
from app.core.database import async_session_factory
from app.models.discovery import DiscoveryRun
from app.services import competitor_service
from app.services.agents.tiers import resolve_model
from app.services.discovery import crawl_map, extractors, synthesis
from app.services.llm_service import get_org_llm_keys

logger = logging.getLogger(__name__)

MAX_PAGES = 8


async def _default_fetch(url: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{settings.CRAWLER_SERVICE_URL}/crawl", json={"url": url})
        return resp.json()


async def _org_model(org_id: uuid.UUID, db):
    """Return (provider, model, api_key) for the org's balanced 'heavy' tier."""
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return None, None, None
    provider, model = resolve_model("balanced", "heavy", list(keys))
    return provider, model, keys[provider]


async def _set(run_id: uuid.UUID, *, stage=None, progress=None, status=None,
               result=None, error=None):
    async with async_session_factory() as db:
        run = await db.get(DiscoveryRun, run_id)
        if run is None:
            return
        if stage is not None:
            run.stage = stage
        if progress is not None:
            run.progress = progress
        if status is not None:
            run.status = status
        if result is not None:
            run.result = result
        if error is not None:
            run.error = error
        await db.commit()


async def run_discovery_pipeline(run_id: uuid.UUID, fetch=None) -> None:
    fetch = fetch or _default_fetch
    async with async_session_factory() as db:
        run = await db.get(DiscoveryRun, run_id)
        if run is None:
            return
        org_id, url, description = run.org_id, run.input_url, run.input_description
        provider, model, api_key = await _org_model(org_id, db)

    result = extractors.empty_result()

    # No-website path: synthesise from the typed description alone.
    if not url:
        await _set(run_id, status="running", stage="Building profile", progress=40)
        result["business"]["description"] = description
        if api_key:
            result = await synthesis.synthesise(description or "", result,
                                                 provider=provider, model=model,
                                                 api_key=api_key, locale="en")
        await _set(run_id, status="done", stage="Done", progress=100, result=result)
        return

    result["business"]["domain"] = url
    try:
        await _set(run_id, status="running", stage="Analyzing website", progress=8)
        home = await fetch(url)
        result = extractors.merge_result(result, extractors.extract_from_page(home.get("text_html") or "", url))
        # crawler returns cleaned text under "text"; extractors want raw HTML when present.

        await _set(run_id, stage="Reading pages", progress=25)
        page_urls = crawl_map.select_urls(url, home, MAX_PAGES)
        corpus = [home.get("text") or ""]
        for i, page_url in enumerate(page_urls[1:], start=1):
            try:
                page = await fetch(page_url)
            except Exception:
                continue
            result = extractors.merge_result(result, extractors.extract_from_page(page.get("text_html") or "", page_url))
            corpus.append(page.get("text") or "")
            await _set(run_id, stage="Reading pages", progress=min(45, 25 + i * 3))

        await _set(run_id, stage="Understanding products", progress=55)
        text = "\n\n".join(t for t in corpus if t)[:16000]
        if api_key:
            result = await synthesis.synthesise(text, result, provider=provider,
                                                 model=model, api_key=api_key, locale="en")

        await _set(run_id, stage="Finding competitors", progress=75)
        # Competitors already inferred by synthesis; the Sable deep-scan is a
        # phase-2 enrichment. Keep synthesised competitors as-is here.

        await _set(run_id, stage="Analyzing SEO", progress=88)
        try:
            card = await competitor_service.scan_scorecard(url)
            result["seo"]["score"] = card.get("score")
            result["seo"]["title"] = card.get("title")
            result["seo"]["meta_description"] = card.get("meta_description")
            result["seo"]["word_count"] = card.get("word_count")
        except Exception:
            logger.info("SEO scorecard skipped for %s", url)

        await _set(run_id, status="done", stage="Done", progress=100, result=result)
    except Exception as exc:  # noqa: BLE001
        logger.exception("discovery pipeline error")
        await _set(run_id, status="done", stage="Done", progress=100,
                   result=result, error=str(exc)[:400])
```

> Note on `text_html`: the crawler currently returns cleaned `text`, not raw HTML. If `page.get("text_html")` is always empty, the extractors still run (returning empty) and the pipeline degrades gracefully. **Task 6b (fold into this task):** add a `"text_html"` field to the crawler response so deterministic extraction works on real sites — see next step.

- [ ] **Step 4: Add raw HTML to the crawler response**

In `services/crawler/app/crawler.py`, the result dict already collects the response; add the raw HTML so discovery extractors can run. Find where `result` is built and the HTTP body is available, and set:

```python
    result["text_html"] = html  # raw response body, for downstream extraction
```

(where `html` is the response `.text` already fetched for parsing). Add `"text_html": None` to the initial `result` dict alongside the other keys.

- [ ] **Step 5: Write the arq task**

```python
# apps/api/app/workers/tasks/discovery_tasks.py
"""ARQ task: run an onboarding discovery pipeline."""
import uuid

from app.services.discovery_service import run_discovery_pipeline


async def run_discovery(ctx, run_id: str):
    await run_discovery_pipeline(uuid.UUID(run_id))
```

- [ ] **Step 6: Register the task**

In `apps/api/app/workers/worker.py`, add the import and add `run_discovery` to `WorkerSettings.functions`:

```python
from app.workers.tasks.discovery_tasks import run_discovery
```
```python
    functions = [
        _noop,
        run_discovery,
        # ... existing entries ...
    ]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_discovery_service.py -v`
Expected: PASS. (Adjust the fixture per the note in Step 1 to match the repo's actual async test setup.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/services/discovery_service.py apps/api/app/workers/tasks/discovery_tasks.py apps/api/app/workers/worker.py services/crawler/app/crawler.py apps/api/tests/test_discovery_service.py apps/api/tests/conftest.py
git commit -m "feat(onboarding): discovery orchestrator, arq task, raw-html crawl field

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Workspace provisioning service

**Files:**
- Create: `apps/api/app/services/workspace_provisioning_service.py`
- Test: `apps/api/tests/test_workspace_provisioning.py`

**Interfaces:**
- Consumes: `DiscoveryRun`, `Project`, `brand_kit.get_or_create_for_project`, `BrandVoice`, `knowledge_service.add_document`, `app.employees.memory.remember`, `llm_service.get_org_llm_keys`.
- Produces:
  - `async provision(run_id: uuid.UUID, *, persona: str | None, db) -> uuid.UUID` — creates/updates the project and writes all five stores; idempotent (re-running on a run whose `project_id` is set updates in place). Returns the `project_id`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_workspace_provisioning.py
import uuid
import pytest
from app.services import workspace_provisioning_service as prov
from app.models.project import Project
from app.models.brand_kit import BrandKit


@pytest.mark.asyncio
async def test_provision_creates_project_and_brand(db_session, seed_org_and_run):
    run = seed_org_and_run(url="https://acme.test")
    run.result = {
        "business": {"name": "Acme Cafe", "domain": "https://acme.test",
                     "industry": "Coffee", "language": "en", "country": "FR",
                     "socials": {"instagram": "https://instagram.com/acme"},
                     "description": "We roast coffee."},
        "brand": {"colors": ["#7C3AED"], "tone": "warm", "primary_font": "DM Sans",
                  "vocabulary": ["artisan"], "avoid_words": ["cheap"], "voice_prompt": "Be warm."},
        "products": [], "audience": [{"label": "Locals"}],
        "competitors": [{"url": "https://rival.test", "name": "Rival"}],
        "seo": {"score": 72, "suggested_keywords": ["specialty coffee lyon"]},
        "goals": ["Increase SEO traffic"], "success_metrics": ["Organic traffic"],
    }
    await db_session.commit()

    pid = await prov.provision(run.id, persona="ecommerce", db=db_session)

    project = await db_session.get(Project, pid)
    assert project.name == "Acme Cafe"
    assert project.industry == "Coffee"
    kit = (await db_session.execute(
        __import__("sqlalchemy").select(BrandKit).where(BrandKit.project_id == pid)
    )).scalar_one()
    assert "#7C3AED" in kit.colors

    # Idempotent: second run does not create a duplicate project.
    pid2 = await prov.provision(run.id, persona="ecommerce", db=db_session)
    assert pid2 == pid
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_workspace_provisioning.py -v`
Expected: FAIL (`ModuleNotFoundError`)

- [ ] **Step 3: Write the provisioning service**

```python
# apps/api/app/services/workspace_provisioning_service.py
"""Turn a confirmed DiscoveryRun into a working workspace: project, Brand DNA,
knowledge embeddings, and seeded employee memory. Idempotent and transactional
-- a re-run updates in place rather than duplicating."""
import uuid

from sqlalchemy import select

from app.api.v1.routers.brand_kit import get_or_create_for_project
from app.employees import memory as memory_layer
from app.models.brand_voice import BrandVoice
from app.models.discovery import DiscoveryRun
from app.models.project import Project
from app.services import knowledge_service
from app.services.llm_service import get_org_llm_keys


def _profile_document(r: dict) -> str:
    b, brand = r.get("business", {}), r.get("brand", {})
    lines = [f"# {b.get('name') or 'Our business'}"]
    if b.get("description"):
        lines.append(b["description"])
    if b.get("industry"):
        lines.append(f"Industry: {b['industry']}")
    if brand.get("mission"):
        lines.append(f"Mission: {brand['mission']}")
    if brand.get("values"):
        lines.append("Values: " + ", ".join(brand["values"]))
    for p in r.get("products", []):
        lines.append(f"Product: {p.get('name')} -- {p.get('description') or ''}")
    for icp in r.get("audience", []):
        lines.append(f"Audience: {icp.get('label')} -- pains: {', '.join(icp.get('pains') or [])}")
    return "\n\n".join(lines)


async def provision(run_id: uuid.UUID, *, persona: str | None, db) -> uuid.UUID:
    run = await db.get(DiscoveryRun, run_id)
    if run is None:
        raise ValueError("Discovery run not found")
    r = run.result or {}
    b, brand = r.get("business", {}), r.get("brand", {})
    org_id = run.org_id

    # 1. Project (idempotent on run.project_id)
    project = await db.get(Project, run.project_id) if run.project_id else None
    if project is None:
        project = Project(id=uuid.uuid4(), org_id=org_id,
                          name=(b.get("name") or "My Workspace")[:255],
                          domain=(b.get("domain") or run.input_url or "")[:255])
        db.add(project)
        await db.flush()
        run.project_id = project.id
    project.name = (b.get("name") or project.name)[:255]
    project.locale = (b.get("language") or project.locale or "en")[:10]
    project.target_country = (b.get("country") or project.target_country)
    project.industry = (b.get("industry") or project.industry)
    project.description = b.get("description") or project.description
    project.persona = persona or project.persona
    pd = dict(project.persona_data or {})
    pd.update({"socials": b.get("socials", {}), "timezone": b.get("timezone"),
               "cms": b.get("cms"), "navigation": b.get("navigation", []),
               "goals": r.get("goals", []), "success_metrics": r.get("success_metrics", []),
               "competitors": r.get("competitors", []),
               "suggested_keywords": (r.get("seo") or {}).get("suggested_keywords", [])})
    project.persona_data = pd
    if brand.get("colors"):
        project.theme = project.theme or "desert"
    await db.flush()

    # 2. Brand DNA
    kit = await get_or_create_for_project(project.id, org_id, db)
    kit.colors = brand.get("colors") or kit.colors
    kit.logo_url = brand.get("logo_url") or kit.logo_url
    kit.primary_font = brand.get("primary_font") or kit.primary_font
    kit.secondary_font = brand.get("secondary_font") or kit.secondary_font
    kit.tone = brand.get("tone") or kit.tone

    voice = (await db.execute(
        select(BrandVoice).where(BrandVoice.project_id == project.id, BrandVoice.org_id == org_id)
    )).scalar_one_or_none()
    if voice is None:
        voice = BrandVoice(id=uuid.uuid4(), org_id=org_id, project_id=project.id,
                           name=f"{project.name} voice", is_default=True)
        db.add(voice)
    voice.voice_prompt = brand.get("voice_prompt") or voice.voice_prompt
    voice.vocabulary = brand.get("vocabulary") or voice.vocabulary
    voice.avoid_words = brand.get("avoid_words") or voice.avoid_words
    await db.flush()

    # 3. Knowledge base (embedded profile document)
    keys = await get_org_llm_keys(org_id, db)
    profile = _profile_document(r)
    if profile.strip():
        try:
            await knowledge_service.add_document(
                project.id, org_id, title="Business profile", body=profile,
                kind="profile", source=run.input_url, keys=keys, db=db)
        except Exception:
            pass  # knowledge is best-effort; never blocks provisioning

    # 4. Workspace + employee memory
    shared = []
    if brand.get("tone"):
        shared.append(("tone", f"Brand tone: {brand['tone']}"))
    if brand.get("mission"):
        shared.append(("mission", f"Mission: {brand['mission']}"))
    if r.get("goals"):
        shared.append(("goals", "Primary goals: " + ", ".join(r["goals"])))
    if brand.get("avoid_words"):
        shared.append(("avoid_words", "Never use: " + ", ".join(brand["avoid_words"])))
    for key, content in shared:
        await memory_layer.remember(db, org_id=org_id, project_id=project.id,
                                    employee_id="zerda", content=content,
                                    scope="workspace", kind="fact", key=key)
    if r.get("competitors"):
        names = ", ".join(c.get("name") or c.get("url") for c in r["competitors"])
        await memory_layer.remember(db, org_id=org_id, project_id=project.id,
                                    employee_id="sable", content=f"Known competitors: {names}",
                                    scope="project", kind="fact", key="competitors")
    if (r.get("seo") or {}).get("suggested_keywords"):
        kws = ", ".join(r["seo"]["suggested_keywords"])
        await memory_layer.remember(db, org_id=org_id, project_id=project.id,
                                    employee_id="zerda", content=f"Seed keywords: {kws}",
                                    scope="project", kind="fact", key="seed_keywords")

    await db.commit()
    return project.id
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_workspace_provisioning.py -v`
Expected: PASS (both assertions, including idempotency)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/workspace_provisioning_service.py apps/api/tests/test_workspace_provisioning.py
git commit -m "feat(onboarding): workspace provisioning writes brand, knowledge, memory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Onboarding API router

**Files:**
- Create: `apps/api/app/api/v1/routers/onboarding.py`
- Modify: `apps/api/app/api/v1/router.py` (register)
- Test: `apps/api/tests/test_onboarding_router.py`

**Interfaces:**
- Produces these endpoints (all under `/api/v1/onboarding`, auth required):
  - `POST /discovery` body `{ "url"?: str, "description"?: str }` → `{ "run_id": str }`; enqueues `run_discovery`.
  - `GET /discovery/{run_id}` → `{ "id", "status", "stage", "progress", "result", "error" }`.
  - `PATCH /discovery/{run_id}` body `{ "result": {...} }` → the updated run (replaces `result`).
  - `POST /provision` body `{ "run_id": str, "persona"?: str }` → `{ "project_id": str }`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_onboarding_router.py
import pytest


@pytest.mark.asyncio
async def test_discovery_lifecycle(client, auth_headers, monkeypatch):
    import arq
    class _Pool:
        async def enqueue_job(self, *a, **k):
            return None
    async def _fake_pool(*a, **k):
        return _Pool()
    monkeypatch.setattr(arq, "create_pool", _fake_pool)

    resp = await client.post("/api/v1/onboarding/discovery",
                             json={"url": "https://acme.test"}, headers=auth_headers)
    assert resp.status_code == 200
    run_id = resp.json()["run_id"]

    got = await client.get(f"/api/v1/onboarding/discovery/{run_id}", headers=auth_headers)
    assert got.status_code == 200
    assert got.json()["status"] in ("queued", "running", "done")

    patched = await client.patch(f"/api/v1/onboarding/discovery/{run_id}",
                                 json={"result": {"business": {"name": "Edited"}}},
                                 headers=auth_headers)
    assert patched.status_code == 200
    assert patched.json()["result"]["business"]["name"] == "Edited"
```

> Reuse the repo's existing `client` / `auth_headers` fixtures (see `tests/test_billing_router.py` for the pattern). If they differ, match them.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_onboarding_router.py -v`
Expected: FAIL (404 — router not registered)

- [ ] **Step 3: Write the router**

```python
# apps/api/app/api/v1/routers/onboarding.py
import uuid
from typing import Optional

import arq
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.discovery import DiscoveryRun
from app.services import workspace_provisioning_service as prov

router = APIRouter()


class DiscoveryStart(BaseModel):
    url: Optional[str] = None
    description: Optional[str] = None


class DiscoveryPatch(BaseModel):
    result: dict


class ProvisionRequest(BaseModel):
    run_id: uuid.UUID
    persona: Optional[str] = None


def _out(run: DiscoveryRun) -> dict:
    return {"id": str(run.id), "status": run.status, "stage": run.stage,
            "progress": run.progress, "result": run.result, "error": run.error}


@router.post("/discovery")
async def start_discovery(body: DiscoveryStart, current_user: CurrentUser, db: DB) -> dict:
    if not body.url and not body.description:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Provide a website URL or a description")
    run = DiscoveryRun(id=uuid.uuid4(), org_id=current_user.org_id,
                       input_url=(body.url or None), input_description=(body.description or None),
                       status="queued", result={})
    db.add(run)
    await db.commit()
    redis = await arq.create_pool(settings.REDIS_SETTINGS)
    await redis.enqueue_job("run_discovery", str(run.id))
    return {"run_id": str(run.id)}


@router.get("/discovery/{run_id}")
async def get_discovery(run_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict:
    run = await db.get(DiscoveryRun, run_id)
    if run is None or run.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return _out(run)


@router.patch("/discovery/{run_id}")
async def patch_discovery(run_id: uuid.UUID, body: DiscoveryPatch,
                          current_user: CurrentUser, db: DB) -> dict:
    run = await db.get(DiscoveryRun, run_id)
    if run is None or run.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    run.result = body.result
    await db.commit()
    await db.refresh(run)
    return _out(run)


@router.post("/provision")
async def provision_workspace(body: ProvisionRequest, current_user: CurrentUser, db: DB) -> dict:
    run = await db.get(DiscoveryRun, body.run_id)
    if run is None or run.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    project_id = await prov.provision(run.id, persona=body.persona, db=db)
    return {"project_id": str(project_id)}
```

- [ ] **Step 4: Register the router**

In `apps/api/app/api/v1/router.py`: add `onboarding` to the `from app.api.v1.routers import (...)` list and add:

```python
api_router.include_router(onboarding.router, prefix="/onboarding", tags=["onboarding"])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_onboarding_router.py -v`
Expected: PASS

- [ ] **Step 6: Full backend suite sanity check**

Run: `cd apps/api && python -m pytest tests/test_discovery_model.py tests/test_discovery_extractors.py tests/test_crawl_map.py tests/test_discovery_synthesis.py tests/test_discovery_service.py tests/test_workspace_provisioning.py tests/test_onboarding_router.py -v`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/api/v1/routers/onboarding.py apps/api/app/api/v1/router.py apps/api/tests/test_onboarding_router.py
git commit -m "feat(onboarding): discovery + provision API endpoints

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PART B — Frontend

All frontend tasks verify with `cd apps/web && npm run typecheck` (no test framework per CLAUDE.md) plus the stated visual check. Match existing component conventions in `apps/web/components/projects/` for styling.

### Task 9: API client + types

**Files:**
- Modify: `apps/web/lib/api.ts` (add types + four functions near `createProject`)

**Interfaces:**
- Produces (TypeScript):
  - `DiscoveryResult` type mirroring the contract.
  - `DiscoveryRun` type: `{ id: string; status: "queued"|"running"|"done"|"error"; stage: string|null; progress: number; result: DiscoveryResult; error: string|null }`.
  - `startDiscovery(body: { url?: string; description?: string }): Promise<{ run_id: string }>`
  - `getDiscovery(runId: string): Promise<DiscoveryRun>`
  - `patchDiscovery(runId: string, result: DiscoveryResult): Promise<DiscoveryRun>`
  - `provisionWorkspace(runId: string, persona?: ProjectPersona): Promise<{ project_id: string }>`

- [ ] **Step 1: Add types and functions to `lib/api.ts`**

```typescript
// --- Onboarding discovery -------------------------------------------------
export interface DiscoveryProduct {
  name?: string; description?: string; category?: string; price?: string;
  benefits?: string[]; url?: string; image_url?: string;
}
export interface DiscoveryICP {
  label?: string; age?: string; gender?: string; country?: string;
  profession?: string; interests?: string[]; pains?: string[];
  goals?: string[]; budget?: string; buying_behavior?: string;
}
export interface DiscoveryCompetitor { url?: string; name?: string; note?: string }
export interface DiscoveryResult {
  business: {
    name: string | null; domain: string | null; industry: string | null;
    country: string | null; language: string | null; timezone: string | null;
    cms: string | null; contact: { email: string | null; phone: string | null };
    socials: Record<string, string>; navigation: string[]; description: string | null;
  };
  brand: {
    logo_url: string | null; colors: string[]; primary_font: string | null;
    secondary_font: string | null; tone: string | null; personality: string[];
    mission: string | null; vision: string | null; values: string[];
    voice_prompt: string | null; vocabulary: string[]; avoid_words: string[];
    cta_style: string | null; reading_level: string | null; emoji_policy: string | null;
  };
  products: DiscoveryProduct[];
  audience: DiscoveryICP[];
  competitors: DiscoveryCompetitor[];
  seo: { score: number | null; title: string | null; meta_description: string | null;
         word_count: number | null; issues: string[]; suggested_keywords: string[] };
  goals: string[]; success_metrics: string[];
}
export interface DiscoveryRun {
  id: string; status: "queued" | "running" | "done" | "error";
  stage: string | null; progress: number; result: DiscoveryResult; error: string | null;
}

export async function startDiscovery(body: { url?: string; description?: string }): Promise<{ run_id: string }> {
  return apiClient.post<{ run_id: string }>("/onboarding/discovery", body);
}
export async function getDiscovery(runId: string): Promise<DiscoveryRun> {
  return apiClient.get<DiscoveryRun>(`/onboarding/discovery/${runId}`);
}
export async function patchDiscovery(runId: string, result: DiscoveryResult): Promise<DiscoveryRun> {
  return apiClient.patch<DiscoveryRun>(`/onboarding/discovery/${runId}`, { result });
}
export async function provisionWorkspace(runId: string, persona?: ProjectPersona): Promise<{ project_id: string }> {
  return apiClient.post<{ project_id: string }>("/onboarding/provision", { run_id: runId, persona });
}
```

> If `apiClient` has no `patch` method, add one mirroring `post` (verify in `lib/api.ts` first — check the `apiClient` definition; PUT exists, PATCH may need adding).

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(onboarding): discovery API client and types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Route scaffold, layout, step state, poll hook

**Files:**
- Create: `apps/web/app/(dashboard)/onboarding/page.tsx`
- Create: `apps/web/components/onboarding/OnboardingShell.tsx`
- Create: `apps/web/components/onboarding/useDiscoveryPoll.ts`
- Create: `apps/web/components/onboarding/types.ts`

**Interfaces:**
- Produces:
  - `OnboardingStep` union: `"welcome" | "discovery" | "review" | "goals" | "brand" | "audience" | "summary" | "provisioning" | "done"`.
  - `OnboardingShell` — renders the progress rail + current step; owns `result` state and `runId`.
  - `useDiscoveryPoll(runId: string | null)` → `{ run: DiscoveryRun | null; done: boolean }`, polling `getDiscovery` every 1500ms until `status === "done" || "error"`.

- [ ] **Step 1: Types**

```typescript
// apps/web/components/onboarding/types.ts
export type OnboardingStep =
  | "welcome" | "discovery" | "review" | "goals"
  | "brand" | "audience" | "summary" | "provisioning" | "done";

export const STEP_ORDER: OnboardingStep[] = [
  "welcome", "discovery", "review", "goals", "brand", "audience", "summary",
];
```

- [ ] **Step 2: Poll hook**

```typescript
// apps/web/components/onboarding/useDiscoveryPoll.ts
import { useEffect, useState } from "react";
import { getDiscovery, type DiscoveryRun } from "@/lib/api";

export function useDiscoveryPoll(runId: string | null) {
  const [run, setRun] = useState<DiscoveryRun | null>(null);
  const done = run?.status === "done" || run?.status === "error";

  useEffect(() => {
    if (!runId || done) return;
    let active = true;
    const tick = async () => {
      try {
        const r = await getDiscovery(runId);
        if (active) setRun(r);
      } catch { /* keep polling */ }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { active = false; clearInterval(id); };
  }, [runId, done]);

  return { run, done };
}
```

- [ ] **Step 3: Shell with progress rail**

```tsx
// apps/web/components/onboarding/OnboardingShell.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { DiscoveryResult, ProjectPersona } from "@/lib/api";
import { STEP_ORDER, type OnboardingStep } from "./types";

const RAIL: { step: OnboardingStep; key: string }[] = [
  { step: "discovery", key: "onboarding.rail.discover" },
  { step: "review", key: "onboarding.rail.review" },
  { step: "goals", key: "onboarding.rail.goals" },
  { step: "brand", key: "onboarding.rail.brand" },
  { step: "audience", key: "onboarding.rail.audience" },
  { step: "summary", key: "onboarding.rail.summary" },
];

export function OnboardingShell() {
  const { t } = useTranslation();
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [runId, setRunId] = useState<string | null>(null);
  // Phase 1 has no persona picker; provisioning treats null as "unset".
  const [persona] = useState<ProjectPersona | null>(null);
  const [result, setResult] = useState<DiscoveryResult | null>(null);

  const activeIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-border p-6 md:block">
        <p className="mb-6 text-sm font-semibold text-foreground">{t("onboarding.title")}</p>
        <ol className="space-y-1">
          {RAIL.map((item, i) => {
            const idx = STEP_ORDER.indexOf(item.step);
            const state = idx < activeIndex ? "done" : idx === activeIndex ? "active" : "todo";
            return (
              <li key={item.step} className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                state === "active" && "bg-primary/10 text-primary font-medium",
                state === "done" && "text-muted-foreground",
                state === "todo" && "text-muted-foreground/60",
              )}>
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  state === "active" ? "bg-primary text-primary-foreground" : "bg-muted")}>{i + 1}</span>
                {t(item.key)}
              </li>
            );
          })}
        </ol>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center p-6 animate-fade-in">
          {/* Step components are wired in Tasks 11-16. Placeholder keeps typecheck green: */}
          <p className="text-sm text-muted-foreground">{t(`onboarding.rail.${step}`, step)}</p>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Route page**

```tsx
// apps/web/app/(dashboard)/onboarding/page.tsx
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";

export default function OnboardingPage() {
  return <OnboardingShell />;
}
```

- [ ] **Step 5: Add i18n strings**

In `apps/web/public/locales/en/common.json` (or the namespace this project uses — check an existing `t("...")` call), add an `onboarding` object with keys used across Tasks 10-16: `title`, `rail.discover|review|goals|brand|audience|summary`, and the step copy referenced later (`welcome.*`, `discovery.*`, `review.*`, `goals.*`, `brand.*`, `audience.*`, `summary.*`, `done.*`). Provide English strings; no emoji.

- [ ] **Step 6: Verify typecheck + visual**

Run: `cd apps/web && npm run typecheck` → no errors.
Visual: `npm run dev`, open `http://localhost:3000/onboarding`, confirm the rail renders and the page is centered.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(dashboard\)/onboarding/page.tsx apps/web/components/onboarding/ apps/web/public/locales
git commit -m "feat(onboarding): route scaffold, progress rail, poll hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Welcome + Business discovery (live progress)

**Files:**
- Create: `apps/web/components/onboarding/WelcomeStep.tsx`
- Create: `apps/web/components/onboarding/DiscoveryStep.tsx`
- Modify: `apps/web/components/onboarding/OnboardingShell.tsx` (wire the two steps)

**Interfaces:**
- Consumes: `startDiscovery`, `useDiscoveryPoll`.
- `WelcomeStep` props: `{ onStart: () => void }`.
- `DiscoveryStep` props: `{ onComplete: (runId: string, result: DiscoveryResult) => void }` — called when polling reports `status==="done"`.

- [ ] **Step 1: WelcomeStep**

```tsx
// apps/web/components/onboarding/WelcomeStep.tsx
"use client";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

export function WelcomeStep({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="text-center animate-fade-in">
      <h1 className="text-3xl font-bold text-foreground">{t("onboarding.welcome.title")}</h1>
      <p className="mt-3 text-muted-foreground">{t("onboarding.welcome.subtitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.welcome.time")}</p>
      <button onClick={onStart} className="btn-primary mx-auto mt-8 flex items-center gap-2 px-6 py-2.5 text-sm">
        {t("onboarding.welcome.start")} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: DiscoveryStep**

```tsx
// apps/web/components/onboarding/DiscoveryStep.tsx
"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Globe } from "lucide-react";
import { startDiscovery, type DiscoveryResult } from "@/lib/api";
import { useDiscoveryPoll } from "./useDiscoveryPoll";

export function DiscoveryStep({ onComplete }: { onComplete: (runId: string, result: DiscoveryResult) => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [noSite, setNoSite] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { run } = useDiscoveryPoll(runId);

  if (run?.status === "done") { onComplete(runId!, run.result); }

  async function begin() {
    setError(null);
    try {
      const { run_id } = await startDiscovery(noSite ? { description } : { url });
      setRunId(run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    }
  }

  if (runId) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">{run?.stage ?? t("onboarding.discovery.starting")}</p>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-500"
               style={{ width: `${run?.progress ?? 5}%` }} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("onboarding.discovery.hint")}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.discovery.title")}</h2>
      {!noSite ? (
        <div className="mt-6">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-input px-3">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://company.com"
                   className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none" />
          </div>
          <button onClick={() => setNoSite(true)} className="mt-3 text-xs text-muted-foreground underline">
            {t("onboarding.discovery.noSite")}
          </button>
        </div>
      ) : (
        <div className="mt-6">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
                    placeholder={t("onboarding.discovery.describe")}
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none" />
        </div>
      )}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      <button onClick={begin} disabled={noSite ? !description.trim() : !url.trim()}
              className="btn-primary mt-6 px-6 py-2.5 text-sm disabled:opacity-50">
        {t("onboarding.discovery.analyze")}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the shell**

In `OnboardingShell.tsx`, replace the placeholder `<main>` body with a switch:

```tsx
{step === "welcome" && <WelcomeStep onStart={() => setStep("discovery")} />}
{step === "discovery" && (
  <DiscoveryStep onComplete={(id, res) => { setRunId(id); setResult(res); setStep("review"); }} />
)}
```

Add the imports at the top.

- [ ] **Step 4: Verify typecheck + visual**

Run: `cd apps/web && npm run typecheck` → no errors.
Visual: on `/onboarding`, Start → enter a URL → confirm the progress bar and live stage label animate (against a running API + worker).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/onboarding/WelcomeStep.tsx apps/web/components/onboarding/DiscoveryStep.tsx apps/web/components/onboarding/OnboardingShell.tsx
git commit -m "feat(onboarding): welcome and live discovery screens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Discovery review (editable cards)

**Files:**
- Create: `apps/web/components/onboarding/ReviewStep.tsx`
- Create: `apps/web/components/onboarding/EditableField.tsx`
- Modify: `apps/web/components/onboarding/OnboardingShell.tsx` (wire step + persist edits)

**Interfaces:**
- `EditableField` props: `{ label: string; value: string | null; onChange: (v: string) => void; placeholder?: string }`.
- `ReviewStep` props: `{ result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void }`.

- [ ] **Step 1: EditableField**

```tsx
// apps/web/components/onboarding/EditableField.tsx
"use client";
export function EditableField({ label, value, onChange, placeholder }: {
  label: string; value: string | null; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input value={value ?? ""} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)}
             className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50" />
    </label>
  );
}
```

- [ ] **Step 2: ReviewStep**

```tsx
// apps/web/components/onboarding/ReviewStep.tsx
"use client";
import { useTranslation } from "react-i18next";
import type { DiscoveryResult } from "@/lib/api";
import { EditableField } from "./EditableField";

export function ReviewStep({ result, onChange, onNext }: {
  result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void;
}) {
  const { t } = useTranslation();
  const b = result.business;
  const set = (patch: Partial<DiscoveryResult["business"]>) =>
    onChange({ ...result, business: { ...b, ...patch } });

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.review.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.review.subtitle")}</p>

      <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">{t("onboarding.review.business")}</p>
        <div className="grid grid-cols-2 gap-3">
          <EditableField label={t("onboarding.review.name")} value={b.name} onChange={(v) => set({ name: v })} />
          <EditableField label={t("onboarding.review.industry")} value={b.industry} onChange={(v) => set({ industry: v })} />
          <EditableField label={t("onboarding.review.country")} value={b.country} onChange={(v) => set({ country: v })} />
          <EditableField label={t("onboarding.review.language")} value={b.language} onChange={(v) => set({ language: v })} />
        </div>
        <EditableField label={t("onboarding.review.description")} value={b.description} onChange={(v) => set({ description: v })} />
      </div>

      {result.brand.colors.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-foreground">{t("onboarding.review.colors")}</p>
          <div className="mt-3 flex gap-2">
            {result.brand.colors.map((c) => (
              <span key={c} className="h-8 w-8 rounded-md border border-border" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        </div>
      )}

      {result.competitors.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-foreground">{t("onboarding.review.competitors")}</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {result.competitors.map((c, i) => <li key={i}>{c.name || c.url}</li>)}
          </ul>
        </div>
      )}

      <button onClick={onNext} className="btn-primary mt-6 px-6 py-2.5 text-sm">{t("onboarding.review.confirm")}</button>
    </div>
  );
}
```

- [ ] **Step 3: Wire step + debounced persist**

In `OnboardingShell.tsx`, render when `step === "review"` and `result`:

```tsx
{step === "review" && result && (
  <ReviewStep result={result} onChange={setResult} onNext={() => setStep("goals")} />
)}
```

Add a debounced effect that persists edits so a refresh resumes from saved state:

```tsx
import { useEffect } from "react";
import { patchDiscovery } from "@/lib/api";
// inside component:
useEffect(() => {
  if (!runId || !result) return;
  const id = setTimeout(() => { patchDiscovery(runId, result).catch(() => {}); }, 800);
  return () => clearTimeout(id);
}, [runId, result]);
```

- [ ] **Step 4: Verify typecheck + visual**

Run: `cd apps/web && npm run typecheck` → no errors.
Visual: after discovery completes, confirm fields are editable, colors show as swatches, and Confirm advances to Goals.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/onboarding/ReviewStep.tsx apps/web/components/onboarding/EditableField.tsx apps/web/components/onboarding/OnboardingShell.tsx
git commit -m "feat(onboarding): editable discovery review screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Goals + success metrics

**Files:**
- Create: `apps/web/components/onboarding/GoalsStep.tsx`
- Create: `apps/web/components/onboarding/ChipMultiSelect.tsx`
- Modify: `apps/web/components/onboarding/OnboardingShell.tsx`

**Interfaces:**
- `ChipMultiSelect` props: `{ options: string[]; selected: string[]; onToggle: (v: string) => void }`.
- `GoalsStep` props: `{ result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void }`.

- [ ] **Step 1: ChipMultiSelect**

```tsx
// apps/web/components/onboarding/ChipMultiSelect.tsx
"use client";
import { cn } from "@/lib/cn";
export function ChipMultiSelect({ options, selected, onToggle }: {
  options: string[]; selected: string[]; onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onToggle(o)}
          className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            selected.includes(o) ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>
          {o}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: GoalsStep**

```tsx
// apps/web/components/onboarding/GoalsStep.tsx
"use client";
import { useTranslation } from "react-i18next";
import type { DiscoveryResult } from "@/lib/api";
import { ChipMultiSelect } from "./ChipMultiSelect";

const GOALS = ["Increase SEO traffic", "Write blog posts", "Generate product pages",
  "Create Instagram content", "Grow Pinterest", "Generate leads", "Increase sales",
  "Launch products", "Email marketing", "Market research", "Competitor analysis"];
const METRICS = ["Organic traffic", "Revenue", "Leads", "Followers", "Newsletter", "Sales", "Appointments"];

export function GoalsStep({ result, onChange, onNext }: {
  result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void;
}) {
  const { t } = useTranslation();
  const toggle = (key: "goals" | "success_metrics", v: string) => {
    const cur = result[key];
    onChange({ ...result, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.goals.title")}</h2>
      <p className="mt-4 mb-2 text-sm font-medium text-foreground">{t("onboarding.goals.goalsLabel")}</p>
      <ChipMultiSelect options={GOALS} selected={result.goals} onToggle={(v) => toggle("goals", v)} />
      <p className="mt-6 mb-2 text-sm font-medium text-foreground">{t("onboarding.goals.metricsLabel")}</p>
      <ChipMultiSelect options={METRICS} selected={result.success_metrics} onToggle={(v) => toggle("success_metrics", v)} />
      <button onClick={onNext} className="btn-primary mt-8 px-6 py-2.5 text-sm">{t("onboarding.goals.next")}</button>
    </div>
  );
}
```

- [ ] **Step 3: Wire step**

In `OnboardingShell.tsx`:
```tsx
{step === "goals" && result && (
  <GoalsStep result={result} onChange={setResult} onNext={() => setStep("brand")} />
)}
```

- [ ] **Step 4: Verify typecheck + visual**

Run: `cd apps/web && npm run typecheck` → no errors. Visual: chips toggle, Next advances to Brand.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/onboarding/GoalsStep.tsx apps/web/components/onboarding/ChipMultiSelect.tsx apps/web/components/onboarding/OnboardingShell.tsx
git commit -m "feat(onboarding): goals and success-metrics screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Brand DNA preview

**Files:**
- Create: `apps/web/components/onboarding/BrandStep.tsx`
- Modify: `apps/web/components/onboarding/OnboardingShell.tsx`

**Interfaces:**
- `BrandStep` props: `{ result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void }`.

- [ ] **Step 1: BrandStep**

```tsx
// apps/web/components/onboarding/BrandStep.tsx
"use client";
import { useTranslation } from "react-i18next";
import type { DiscoveryResult } from "@/lib/api";
import { EditableField } from "./EditableField";

export function BrandStep({ result, onChange, onNext }: {
  result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void;
}) {
  const { t } = useTranslation();
  const brand = result.brand;
  const set = (patch: Partial<DiscoveryResult["brand"]>) =>
    onChange({ ...result, brand: { ...brand, ...patch } });

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.brand.title")}</h2>
      <div className="mt-6 rounded-xl border border-border bg-card p-5 space-y-4">
        {brand.colors.length > 0 && (
          <div className="flex gap-2">
            {brand.colors.map((c) => (
              <span key={c} className="h-8 w-8 rounded-md border border-border" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <EditableField label={t("onboarding.brand.tone")} value={brand.tone} onChange={(v) => set({ tone: v })} />
          <EditableField label={t("onboarding.brand.cta")} value={brand.cta_style} onChange={(v) => set({ cta_style: v })} />
          <EditableField label={t("onboarding.brand.reading")} value={brand.reading_level} onChange={(v) => set({ reading_level: v })} />
          <EditableField label={t("onboarding.brand.emoji")} value={brand.emoji_policy} onChange={(v) => set({ emoji_policy: v })} />
        </div>
        <EditableField label={t("onboarding.brand.mission")} value={brand.mission} onChange={(v) => set({ mission: v })} />
        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("onboarding.brand.voice")}</span>
          <textarea value={brand.voice_prompt ?? ""} rows={3} onChange={(e) => set({ voice_prompt: e.target.value })}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50" />
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {brand.vocabulary.length > 0 && <p><span className="font-medium text-foreground">{t("onboarding.brand.use")}:</span> {brand.vocabulary.join(", ")}</p>}
          {brand.avoid_words.length > 0 && <p><span className="font-medium text-foreground">{t("onboarding.brand.avoid")}:</span> {brand.avoid_words.join(", ")}</p>}
        </div>
      </div>
      <button onClick={onNext} className="btn-primary mt-6 px-6 py-2.5 text-sm">{t("onboarding.brand.next")}</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire step**

```tsx
{step === "brand" && result && (
  <BrandStep result={result} onChange={setResult} onNext={() => setStep("audience")} />
)}
```

- [ ] **Step 3: Verify typecheck + visual**

Run: `cd apps/web && npm run typecheck` → no errors. Visual: swatches + editable brand fields render; Next advances to Audience.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/onboarding/BrandStep.tsx apps/web/components/onboarding/OnboardingShell.tsx
git commit -m "feat(onboarding): brand DNA preview screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: Audience / ICP

**Files:**
- Create: `apps/web/components/onboarding/AudienceStep.tsx`
- Modify: `apps/web/components/onboarding/OnboardingShell.tsx`

**Interfaces:**
- `AudienceStep` props: `{ result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void }`.

- [ ] **Step 1: AudienceStep**

```tsx
// apps/web/components/onboarding/AudienceStep.tsx
"use client";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { DiscoveryResult, DiscoveryICP } from "@/lib/api";
import { EditableField } from "./EditableField";

export function AudienceStep({ result, onChange, onNext }: {
  result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void;
}) {
  const { t } = useTranslation();
  const setICP = (i: number, patch: Partial<DiscoveryICP>) => {
    const audience = result.audience.map((a, idx) => idx === i ? { ...a, ...patch } : a);
    onChange({ ...result, audience });
  };
  const add = () => onChange({ ...result, audience: [...result.audience, { label: "" }] });
  const remove = (i: number) => onChange({ ...result, audience: result.audience.filter((_, idx) => idx !== i) });

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.audience.title")}</h2>
      <div className="mt-6 space-y-4">
        {result.audience.map((icp, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <EditableField label={t("onboarding.audience.label")} value={icp.label ?? ""} onChange={(v) => setICP(i, { label: v })} />
              <button onClick={() => remove(i)} className="ml-3 mt-4 text-muted-foreground hover:text-destructive" aria-label={t("onboarding.audience.remove")}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <EditableField label={t("onboarding.audience.profession")} value={icp.profession ?? ""} onChange={(v) => setICP(i, { profession: v })} />
              <EditableField label={t("onboarding.audience.budget")} value={icp.budget ?? ""} onChange={(v) => setICP(i, { budget: v })} />
            </div>
          </div>
        ))}
        <button onClick={add} className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          <Plus className="h-4 w-4" /> {t("onboarding.audience.add")}
        </button>
      </div>
      <button onClick={onNext} className="btn-primary mt-6 px-6 py-2.5 text-sm">{t("onboarding.audience.next")}</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire step**

```tsx
{step === "audience" && result && (
  <AudienceStep result={result} onChange={setResult} onNext={() => setStep("summary")} />
)}
```

- [ ] **Step 3: Verify typecheck + visual**

Run: `cd apps/web && npm run typecheck` → no errors. Visual: ICP cards add/edit/remove; Next advances to Summary.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/onboarding/AudienceStep.tsx apps/web/components/onboarding/OnboardingShell.tsx
git commit -m "feat(onboarding): audience / ICP screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: Summary, provisioning, done

**Files:**
- Create: `apps/web/components/onboarding/SummaryStep.tsx`
- Create: `apps/web/components/onboarding/ProvisioningStep.tsx`
- Create: `apps/web/components/onboarding/DoneStep.tsx`
- Modify: `apps/web/components/onboarding/OnboardingShell.tsx`

**Interfaces:**
- `SummaryStep` props: `{ result: DiscoveryResult; onEdit: (step: OnboardingStep) => void; onCreate: () => void }`.
- `ProvisioningStep` props: `{ runId: string; persona: ProjectPersona | null; onDone: (projectId: string) => void }`.
- `DoneStep` props: `{ projectId: string }`.

- [ ] **Step 1: SummaryStep**

```tsx
// apps/web/components/onboarding/SummaryStep.tsx
"use client";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import type { DiscoveryResult } from "@/lib/api";
import type { OnboardingStep } from "./types";

export function SummaryStep({ result, onEdit, onCreate }: {
  result: DiscoveryResult; onEdit: (s: OnboardingStep) => void; onCreate: () => void;
}) {
  const { t } = useTranslation();
  const Row = ({ label, value, step }: { label: string; value: string; step: OnboardingStep }) => (
    <div className="flex items-center justify-between border-b border-border py-3">
      <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm text-foreground">{value || "-"}</p></div>
      <button onClick={() => onEdit(step)} className="text-muted-foreground hover:text-primary" aria-label={t("onboarding.summary.edit")}><Pencil className="h-3.5 w-3.5" /></button>
    </div>
  );
  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.summary.title")}</h2>
      <div className="mt-6 rounded-xl border border-border bg-card px-5">
        <Row label={t("onboarding.summary.business")} value={result.business.name ?? ""} step="review" />
        <Row label={t("onboarding.summary.goals")} value={result.goals.join(", ")} step="goals" />
        <Row label={t("onboarding.summary.brand")} value={result.brand.tone ?? ""} step="brand" />
        <Row label={t("onboarding.summary.audience")} value={result.audience.map((a) => a.label).join(", ")} step="audience" />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("onboarding.summary.employeesNote")}</p>
      <button onClick={onCreate} className="btn-primary mt-6 px-6 py-2.5 text-sm">{t("onboarding.summary.create")}</button>
    </div>
  );
}
```

- [ ] **Step 2: ProvisioningStep**

```tsx
// apps/web/components/onboarding/ProvisioningStep.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { provisionWorkspace, type ProjectPersona } from "@/lib/api";

export function ProvisioningStep({ runId, persona, onDone }: {
  runId: string; persona: ProjectPersona | null; onDone: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    provisionWorkspace(runId, persona ?? undefined)
      .then((r) => onDone(r.project_id))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [runId, persona, onDone]);
  return (
    <div className="animate-fade-in text-center">
      {error ? <p className="text-sm text-destructive">{error}</p> : (
        <>
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          <p className="mt-4 text-sm font-medium text-foreground">{t("onboarding.provisioning.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.provisioning.hint")}</p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: DoneStep**

```tsx
// apps/web/components/onboarding/DoneStep.tsx
"use client";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";

export function DoneStep({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const tasks = [
    { key: "onboarding.done.article", href: `/${projectId}/articles` },
    { key: "onboarding.done.competitors", href: `/${projectId}/seo` },
    { key: "onboarding.done.instagram", href: `/${projectId}/social` },
    { key: "onboarding.done.roadmap", href: `/${projectId}/seo` },
  ];
  return (
    <div className="animate-fade-in text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
      <h2 className="mt-4 text-2xl font-bold text-foreground">{t("onboarding.done.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.done.subtitle")}</p>
      <div className="mx-auto mt-6 grid max-w-md grid-cols-2 gap-3">
        {tasks.map((task) => (
          <Link key={task.key} href={task.href}
            className="rounded-xl border border-border bg-card p-4 text-sm text-foreground transition-colors hover:border-primary/50">
            {t(task.key)}
          </Link>
        ))}
      </div>
      <Link href={`/${projectId}/overview`} className="btn-primary mt-8 inline-block px-6 py-2.5 text-sm">
        {t("onboarding.done.dashboard")}
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Wire the final steps**

In `OnboardingShell.tsx`, add state `const [projectId, setProjectId] = useState<string | null>(null);` and:

```tsx
{step === "summary" && result && (
  <SummaryStep result={result} onEdit={setStep} onCreate={() => setStep("provisioning")} />
)}
{step === "provisioning" && runId && (
  <ProvisioningStep runId={runId} persona={persona} onDone={(id) => { setProjectId(id); setStep("done"); }} />
)}
{step === "done" && projectId && <DoneStep projectId={projectId} />}
```

- [ ] **Step 5: Verify typecheck + visual**

Run: `cd apps/web && npm run typecheck` → no errors.
Visual (full run against API + worker): URL → discovery → review → goals → brand → audience → summary → Create → provisioning spinner → Done with first-task cards linking into the new project.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/onboarding/SummaryStep.tsx apps/web/components/onboarding/ProvisioningStep.tsx apps/web/components/onboarding/DoneStep.tsx apps/web/components/onboarding/OnboardingShell.tsx
git commit -m "feat(onboarding): summary, provisioning, and success screens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 17: Retire CreateProjectModal, route New Workspace to /onboarding

**Files:**
- Modify: `apps/web/components/layout/Sidebar.tsx` (route the "New workspace" action to `/onboarding`)
- Delete: `apps/web/components/projects/CreateProjectModal.tsx`
- Modify: any other importer surfaced by grep (e.g. `apps/web/app/(dashboard)/page.tsx` if it renders the modal)

**Interfaces:**
- Consumes: the `/onboarding` route from Task 10.

- [ ] **Step 1: Find all usages**

Run: `cd apps/web && grep -rln "CreateProjectModal" app components`
Expected: `components/layout/Sidebar.tsx` and the modal file itself (confirm no others).

- [ ] **Step 2: Update Sidebar to navigate instead of open the modal**

In `apps/web/components/layout/Sidebar.tsx`, remove the `CreateProjectModal` import and its rendered instance + `open` state. Replace the "New workspace" button's `onClick` with navigation:

```tsx
import { useRouter } from "next/navigation";
// inside component:
const router = useRouter();
// button:
<button onClick={() => router.push("/onboarding")} /* keep existing classes */>
  {/* existing label */}
</button>
```

- [ ] **Step 3: Delete the modal**

Run: `git rm apps/web/components/projects/CreateProjectModal.tsx`

- [ ] **Step 4: Verify typecheck + build**

Run: `cd apps/web && npm run typecheck` → no errors (no dangling imports).
Run: `cd apps/web && npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/layout/Sidebar.tsx
git commit -m "feat(onboarding): route new-workspace to /onboarding, retire modal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Backend suite: `cd apps/api && python -m pytest tests/test_discovery_model.py tests/test_discovery_extractors.py tests/test_crawl_map.py tests/test_discovery_synthesis.py tests/test_discovery_service.py tests/test_workspace_provisioning.py tests/test_onboarding_router.py tests/test_brand_per_project.py -v` → all PASS.
- [ ] Frontend: `cd apps/web && npm run typecheck && npm run build` → both succeed.
- [ ] Migrations applied: `make db-migrate` shows head `c8r9s0t1u2v3`.
- [ ] Manual end-to-end: with API + worker + crawler running, complete `/onboarding` from a real URL and confirm a new project exists with a BrandKit (colors), a "Business profile" knowledge document, and seeded employee memories (check `GET /api/v1/employees/memory/recall?project_id=...`).

---

## Notes for the implementer

- **Graceful degradation is a feature, not an afterthought.** Every extractor and the synthesis call already swallow errors and return partials. Do not add hard failures on top of them.
- **Reuse, don't reinvent.** The crawler, `competitor_service.scan_scorecard`, `knowledge_service.add_document`, `memory_layer.remember`, and `tiers.resolve_model` already exist — call them, do not re-implement.
- **Match existing fixtures.** The test snippets assume async `db_session` / `client` / `auth_headers` fixtures. Inspect `apps/api/tests/conftest.py` and a passing test (`tests/test_content_plans.py`, `tests/test_billing_router.py`) and align names/shapes before writing new tests.
- **i18n:** every visible string uses `t()`. Add keys under an `onboarding.*` namespace in the same locale file the app already loads. No emoji.
```
