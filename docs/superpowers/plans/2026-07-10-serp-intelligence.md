# SERP Intelligence (E1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Google rank tracking (up to 25 keywords/project, daily snapshots, who-ranks, SERP features, alerts on moves) + Surfer-class content scoring against the live top-10 — key-gated on the org's own DataForSEO account, never fabricated.

**Architecture:** Org-aware provider resolution on the existing `seo_apis` scaffold (org APIKey `"dataforseo"` → env fallback → None + honest UI gate). Two new tables (`tracked_keywords`, `serp_snapshots`). `serp_service` normalizes SERPs; `rank_tracking_service` snapshots daily via cron and emits `serp_drop`/`serp_gain` alerts through the existing monitoring engine; `content_scoring_service` combines SERP top-10 + crawler text extraction + deterministic term analysis + one locale-aware LLM brief. New `/seo` router, SEO hub page, and an Optimize tab in the article editor.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + arq cron + httpx (backend); DataForSEO REST v3; existing crawler service (BeautifulSoup); Next.js 14 + TanStack Query + recharts + react-i18next (frontend). No new dependencies.

Spec: `docs/superpowers/specs/2026-07-10-serp-intelligence-design.md`
Branch: create `feat/serp-intelligence` off `main` (monitoring is merged — the alert engine is available).

## Global Constraints

- **NO EMOJI** anywhere (code, UI, comments, commit messages).
- **Key-gated honesty:** no DataForSEO credentials → `get_seo_provider_for_org` returns None → endpoints return 409 `{"detail": {"code": "no_seo_provider"}}` → UI shows the connect state. The mock provider is used ONLY in tests. Never fabricate data.
- **Cost caps (exact):** 25 active tracked keywords per project; one snapshot per (keyword, date); content-score SERP fetches reuse a tracked keyword's snapshot when it is <= 7 days old.
- Backend tests inside docker from repo root: `docker compose exec -T api pytest tests/test_seo_intel.py -v`. Migrations via `make db-migrate`. **Verify migration revision ids unused** (`grep -r "<id>" apps/api/alembic/versions/` empty) before use. Commit style `feat(seo): ...`.
- All DataForSEO/crawler/LLM calls patched in tests (no network).
- Frontend: `apiClient` only; Tailwind CSS variables only (no hex in TSX); every visible string via `t()` with **native translations in all six locales** (`en/fr/es/de/pt/ar`), key parity; "Pack" stays untranslated; dates via the active locale. `cd apps/web && npm run typecheck` → exit 0. Dev server port 3001.
- Alert kinds added: `serp_drop | serp_gain` (severities reuse `info|warning|critical`; ISO-week dedupe via the existing unique `(project_id, dedupe_key)`).
- SERP thresholds (exact): drop = position worsened >= 3.0 (a keyword leaving the top 100, position null, counts as position 101); critical iff it left the top 10 (was <= 10.0, now > 10.0 or null), else warning; gain = improved >= 3.0 or newly entered the top 100 (null -> ranked, treated as from 101), severity info.
- Language for SERP = first 2 letters of `project.locale`; location via `COUNTRY_LOCATIONS` with fallback: locale `fr` → 2250 (France), else 2840 (US).

---

### Task 1: Org-aware provider + `serp()` + Settings DataForSEO card

**Files:**
- Modify: `apps/api/app/integrations/seo_apis/__init__.py`
- Modify: `apps/api/app/integrations/seo_apis/dataforseo.py` (add `serp`)
- Modify: `apps/api/app/integrations/seo_apis/mock_provider.py` (add `serp` for tests)
- Modify: `apps/api/app/integrations/seo_apis/base.py` (Protocol gains `serp`)
- Modify: `apps/web/app/(dashboard)/settings/page.tsx` (SEO data card in the AI Keys section)
- Modify: `apps/web/public/locales/{en,fr,es,de,pt,ar}/common.json` (`settings.seoData.*`)
- Test: `apps/api/tests/test_seo_intel.py` (new — harness + provider tests)

**Interfaces:**
- Produces: `async get_seo_provider_for_org(org_id, db) -> DataForSEOProvider | None` (org APIKey `provider=="dataforseo"` whose decrypted value is `login:password` → real provider; else env `DATAFORSEO_LOGIN/PASSWORD` → real; else None); `DataForSEOProvider.serp(keyword: str, language_code: str = "en", location_code: int = 2840) -> list[dict]` (raw organic items: each has `rank_absolute` or `rank_group`, `type`, `domain`, `url`, `title`); `MockSEOProvider.serp(...)` (deterministic 10 items for tests).

- [ ] **Step 1: Create the test harness + failing provider tests** in `apps/api/tests/test_seo_intel.py`. Copy the SQLite harness idiom from `tests/test_monitoring.py` (`db_session`, `SQLITE_COMPATIBLE_TABLES`, `FAKE_ORG_ID`, `_mk_project`); tables for this file (grow over tasks): `projects, gsc_connections, api_keys, tracked_keywords, serp_snapshots, alerts, monitor_snapshots`. First tests:

```python
@pytest.mark.asyncio
async def test_provider_resolution_precedence(db_session, monkeypatch):
    from app.integrations.seo_apis import get_seo_provider_for_org
    from app.core.security import encrypt_value
    from app.models.api_key import APIKey
    # 1. nothing -> None
    monkeypatch.setattr("app.core.config.settings.DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr("app.core.config.settings.DATAFORSEO_PASSWORD", "", raising=False)
    assert await get_seo_provider_for_org(FAKE_ORG_ID, db_session) is None
    # 2. env fallback -> real provider
    monkeypatch.setattr("app.core.config.settings.DATAFORSEO_LOGIN", "envuser", raising=False)
    monkeypatch.setattr("app.core.config.settings.DATAFORSEO_PASSWORD", "envpass", raising=False)
    p = await get_seo_provider_for_org(FAKE_ORG_ID, db_session)
    assert p is not None and p._auth == ("envuser", "envpass")
    # 3. org key wins over env
    db_session.add(APIKey(org_id=FAKE_ORG_ID, provider="dataforseo",
                          encrypted_value=encrypt_value("orguser:orgpass")))
    await db_session.commit()
    p = await get_seo_provider_for_org(FAKE_ORG_ID, db_session)
    assert p._auth == ("orguser", "orgpass")
```

Check `APIKey`'s real constructor fields (open `app/models/api_key.py` — it may require `masked_value` or similar; fill required fields accordingly) and how existing code decrypts (`decrypt_value`).

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_seo_intel.py -v` → FAIL (`get_seo_provider_for_org` not defined).

- [ ] **Step 3: Implement.** In `apps/api/app/integrations/seo_apis/__init__.py` add (keep the existing `get_seo_provider()` untouched for legacy callers):

```python
async def get_seo_provider_for_org(org_id, db) -> DataForSEOProvider | None:
    """Org-scoped provider: the org's DataForSEO key wins, env is a dev fallback,
    otherwise None (callers show a connect state - never the mock)."""
    from sqlalchemy import select
    from app.core.security import decrypt_value
    from app.models.api_key import APIKey

    row = (await db.execute(select(APIKey).where(
        APIKey.org_id == org_id, APIKey.provider == "dataforseo",
    ))).scalars().first()
    if row is not None:
        value = decrypt_value(row.encrypted_value)
        login, _, password = value.partition(":")
        if login and password:
            return DataForSEOProvider(login, password)
    if settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD:
        return DataForSEOProvider(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    return None
```

In `dataforseo.py` add to the class:

```python
    async def serp(self, keyword: str, language_code: str = "en", location_code: int = 2840) -> list[dict]:
        """Live Google organic SERP. Returns the raw item list (rank, type, domain, url, title)."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.BASE_URL}/serp/google/organic/live/regular",
                auth=self._auth,
                json=[{"keyword": keyword, "language_code": language_code,
                       "location_code": location_code, "depth": 100}],
            )
            resp.raise_for_status()
            data = resp.json()
        try:
            return data["tasks"][0]["result"][0]["items"] or []
        except (KeyError, IndexError, TypeError):
            return []
```

(Match the file's existing httpx import/usage style.) In `mock_provider.py` add a deterministic `serp` (10 organic items: `{"type": "organic", "rank_absolute": i, "domain": f"site{i}.com", "url": f"https://site{i}.com/page", "title": f"Result {i} for {keyword}"}` for i 1..10 — tests for later tasks override with their own fakes anyway). In `base.py` add `async def serp(self, keyword: str, language_code: str = "en", location_code: int = 2840) -> list[dict]: ...` to the Protocol.

- [ ] **Step 4: Settings card.** In `apps/web/app/(dashboard)/settings/page.tsx`, inside `AIKeysSection` after the add-key form, add an "SEO data" card: shows DataForSEO connected state (derived from `keys.some(k => k.provider === "dataforseo")`), a remove button (existing `deleteApiKey`), and when not connected a two-field form (login + password inputs) submitting `createApiKey("dataforseo", `${login}:${password}`)` (reuse the section's mutation pattern + toasts). i18n `settings.seoData.*` keys in ALL SIX locales (native): `title` ("SEO data - DataForSEO"), `hint` ("Powers rank tracking and content scoring. Pay-per-use with your own DataForSEO account."), `login`, `password`, `connect`, `connected`, `remove`.

- [ ] **Step 5: Run tests + typecheck** — `docker compose exec -T api pytest tests/test_seo_intel.py -v` → PASS; `cd apps/web && npm run typecheck` → exit 0; locale JSONs valid.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/integrations/seo_apis/ apps/api/tests/test_seo_intel.py "apps/web/app/(dashboard)/settings/page.tsx" apps/web/public/locales/*/common.json
git commit -m "feat(seo): org-scoped DataForSEO provider with SERP endpoint and settings card"
```

---

### Task 2: Models + migration (`tracked_keywords`, `serp_snapshots`)

**Files:**
- Create: `apps/api/app/models/seo_intel.py`
- Create: `apps/api/alembic/versions/c9d0e1f2a3b4_serp_intelligence_tables.py`
- Test: `apps/api/tests/test_seo_intel.py` (append constraint smoke tests)

**Interfaces:**
- Produces: `TrackedKeyword(org_id, project_id, keyword: str(500), language: str(10), location_code: int, is_active: bool=True)` unique `(project_id, keyword)`; `SerpSnapshot(org_id, project_id, tracked_keyword_id FK cascade, date: Date, position: float|None, url: str(2048)|None, top10: JSON, features: JSON)` unique `(tracked_keyword_id, date)`. Table names exactly `tracked_keywords`, `serp_snapshots`.

- [ ] **Step 1: Verify revision id unused**: `grep -r "c9d0e1f2a3b4" apps/api/alembic/versions/` → empty, and `docker compose exec -T api alembic heads` → single head `b8c9d0e1f2a3` (the monitoring migration; it is merged to main). If the id is taken pick another unused 12-char id consistently.

- [ ] **Step 2: Create `apps/api/app/models/seo_intel.py`** (match `app/models/monitoring.py` import style — `Base` and `TimestampMixin` from the same modules it uses):

```python
import uuid

from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

# match monitoring.py's actual import paths for Base/TimestampMixin


class TrackedKeyword(Base, TimestampMixin):
    """A keyword whose real Google SERP position Zerda tracks daily."""
    __tablename__ = "tracked_keywords"
    __table_args__ = (UniqueConstraint("project_id", "keyword", name="uq_tracked_keyword"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    keyword: Mapped[str] = mapped_column(String(500), nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    location_code: Mapped[int] = mapped_column(Integer, default=2840, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class SerpSnapshot(Base, TimestampMixin):
    """One day's SERP result for a tracked keyword."""
    __tablename__ = "serp_snapshots"
    __table_args__ = (UniqueConstraint("tracked_keyword_id", "date", name="uq_serp_snapshot_day"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    tracked_keyword_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tracked_keywords.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[object] = mapped_column(Date, nullable=False)  # datetime.date
    position: Mapped[float | None] = mapped_column(Float)
    url: Mapped[str | None] = mapped_column(String(2048))
    top10: Mapped[list | None] = mapped_column(JSON)
    features: Mapped[list | None] = mapped_column(JSON)
```

(Use `Mapped[date]` with a proper `from datetime import date` import — mirror how `campaign.py` typed `week_of`.)

- [ ] **Step 3: Migration** `c9d0e1f2a3b4_serp_intelligence_tables.py` — `down_revision = "b8c9d0e1f2a3"`; two `create_table` calls with the exact columns above (UUID pk, FKs with CASCADE, timestamps matching the monitoring migration's convention), the two unique constraints, and indexes on `project_id` (both tables) + `tracked_keyword_id`; downgrade drops `serp_snapshots` then `tracked_keywords`.

- [ ] **Step 4: Append smoke tests**: inserting two `TrackedKeyword` with the same (project, keyword) raises; two `SerpSnapshot` same (keyword, date) raises (same pattern as monitoring's dedupe smoke test). Add the two new tables + `api_keys` to `SQLITE_COMPATIBLE_TABLES` and import the models.

- [ ] **Step 5: Apply + test** — `make db-migrate` applies `b8c9d0e1f2a3 -> c9d0e1f2a3b4`; `docker compose exec -T api pytest tests/test_seo_intel.py -v` → ALL pass; import sanity `python -c "import app.models.seo_intel"`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/models/seo_intel.py apps/api/alembic/versions/c9d0e1f2a3b4_serp_intelligence_tables.py apps/api/tests/test_seo_intel.py
git commit -m "feat(seo): tracked_keywords and serp_snapshots tables"
```

---

### Task 3: `serp_service` + `rank_tracking_service`

**Files:**
- Create: `apps/api/app/services/serp_service.py`
- Create: `apps/api/app/services/rank_tracking_service.py`
- Test: `apps/api/tests/test_seo_intel.py` (append)

**Interfaces:**
- Consumes: `get_seo_provider_for_org` (T1), models (T2).
- Produces:
  - `serp_service.COUNTRY_LOCATIONS: dict[str, int]` (`US 2840, FR 2250, GB 2826, DE 2276, ES 2724, PT 2620, IT 2380, BE 2056, CH 2756, CA 2124, MA 2504, DZ 2012, TN 2788`), `location_for_project(project) -> int` (target_country uppercased in map → that; else locale startswith "fr" → 2250; else 2840), `language_for_project(project) -> str` (first 2 of locale, default "en").
  - `async serp_service.fetch_serp(project, keyword: str, db) -> dict | None` — None when no provider; else `{"position": float | None, "url": str | None, "top10": [{"rank": int, "domain": str, "url": str, "title": str}], "features": [str]}`. Position/url = first organic item whose domain matches the project's domain (normalize both by stripping `www.` and lowercasing; match when equal OR item domain endswith "." + project domain). `top10` = first 10 organic items; `features` = sorted set of non-organic item `type` values.
  - `rank_tracking_service`: `TRACKED_CAP = 25`; `async add_keyword(project, keyword, db) -> TrackedKeyword` (strips; raises `CapReached`/`DuplicateKeyword` custom exceptions defined in the module); `async remove_keyword(keyword_id, org_id, db) -> bool`; `async list_with_stats(project_id, org_id, db) -> list[dict]` (each: id, keyword, latest position/url/features/date, delta_7d, delta_30d, spark: last-30-day [{date, position}]); `async snapshot_keyword(project, tk, db) -> SerpSnapshot | None` (None when no provider or already snapshotted today; stores snapshot); `async history(keyword_id, org_id, days, db) -> dict` (snapshots asc + latest top10/features).
  - Delta convention: `delta_7d = old_position - new_position` (positive = improvement); null positions treated as 101.

- [ ] **Step 1: Write failing tests** (append; patch `serp_service.get_seo_provider_for_org` to return a fake provider object whose `serp()` returns a crafted item list):

```python
def _serp_items(project_domain_rank: int | None = 3, n: int = 12):
    items = []
    rank = 1
    for i in range(1, n + 1):
        domain = "pure-saveur.fr" if project_domain_rank == i else f"site{i}.com"
        items.append({"type": "organic", "rank_absolute": rank,
                      "domain": domain, "url": f"https://{domain}/p", "title": f"R{i}"})
        rank += 1
    items.append({"type": "people_also_ask", "rank_absolute": rank})
    return items


class _FakeProvider:
    def __init__(self, items): self._items = items
    async def serp(self, keyword, language_code="en", location_code=2840): return self._items


@pytest.mark.asyncio
async def test_fetch_serp_normalizes_and_matches_domain(db_session):
    from app.services import serp_service
    p = await _mk_project(db_session)  # ensure _mk_project sets domain="pure-saveur.fr"
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(3)))):
        res = await serp_service.fetch_serp(p, "menu digital", db_session)
    assert res["position"] == 3.0 and "pure-saveur.fr" in res["url"]
    assert len(res["top10"]) == 10 and res["top10"][0]["rank"] == 1
    assert "people_also_ask" in res["features"]


@pytest.mark.asyncio
async def test_fetch_serp_not_ranked_and_no_provider(db_session):
    from app.services import serp_service
    p = await _mk_project(db_session)
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(None)))):
        res = await serp_service.fetch_serp(p, "kw", db_session)
    assert res["position"] is None and res["url"] is None
    with patch.object(serp_service, "get_seo_provider_for_org", new=AsyncMock(return_value=None)):
        assert await serp_service.fetch_serp(p, "kw", db_session) is None


@pytest.mark.asyncio
async def test_tracking_cap_duplicate_and_snapshot_idempotency(db_session):
    from app.services import serp_service, rank_tracking_service as rts
    p = await _mk_project(db_session)
    for i in range(25):
        await rts.add_keyword(p, f"kw {i}", db_session)
    with pytest.raises(rts.CapReached):
        await rts.add_keyword(p, "kw 26", db_session)
    with pytest.raises(rts.DuplicateKeyword):
        await rts.add_keyword(p, "kw 0", db_session)
    tk = (await db_session.execute(select(TrackedKeyword).where(
        TrackedKeyword.keyword == "kw 0"))).scalars().first()
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(2)))):
        s1 = await rts.snapshot_keyword(p, tk, db_session)
        s2 = await rts.snapshot_keyword(p, tk, db_session)  # same day -> None
    assert s1 is not None and s1.position == 2.0 and s2 is None


@pytest.mark.asyncio
async def test_list_with_stats_deltas(db_session):
    from app.services import rank_tracking_service as rts
    p = await _mk_project(db_session)
    tk = await rts.add_keyword(p, "menu digital", db_session)
    today = date.today()
    for days_ago, pos in [(30, 12.0), (7, 9.0), (0, 4.0)]:
        db_session.add(SerpSnapshot(org_id=FAKE_ORG_ID, project_id=p.id,
                                    tracked_keyword_id=tk.id, date=today - timedelta(days=days_ago),
                                    position=pos, url="https://pure-saveur.fr/p", top10=[], features=[]))
    await db_session.commit()
    rows = await rts.list_with_stats(p.id, FAKE_ORG_ID, db_session)
    row = rows[0]
    assert row["position"] == 4.0
    assert row["delta_7d"] == 5.0      # 9 -> 4 improvement
    assert row["delta_30d"] == 8.0     # 12 -> 4
    assert len(row["spark"]) >= 2
```

- [ ] **Step 2: Run to verify fail** — module-not-found failures.

- [ ] **Step 3: Implement both services.** `serp_service.py`:

```python
"""SERP fetching + normalization on the org's DataForSEO provider."""
import logging
from urllib.parse import urlparse

from app.integrations.seo_apis import get_seo_provider_for_org

logger = logging.getLogger(__name__)

COUNTRY_LOCATIONS = {
    "US": 2840, "FR": 2250, "GB": 2826, "DE": 2276, "ES": 2724, "PT": 2620,
    "IT": 2380, "BE": 2056, "CH": 2756, "CA": 2124, "MA": 2504, "DZ": 2012, "TN": 2788,
}


def language_for_project(project) -> str:
    return (project.locale or "en")[:2].lower()


def location_for_project(project) -> int:
    country = (project.target_country or "").strip().upper()
    if country in COUNTRY_LOCATIONS:
        return COUNTRY_LOCATIONS[country]
    return 2250 if language_for_project(project) == "fr" else 2840


def _norm_domain(d: str) -> str:
    d = (d or "").lower()
    return d[4:] if d.startswith("www.") else d


def _project_domain(project) -> str:
    dom = project.domain or ""
    if "://" in dom:
        dom = urlparse(dom).netloc
    return _norm_domain(dom)


async def fetch_serp(project, keyword: str, db) -> dict | None:
    provider = await get_seo_provider_for_org(project.org_id, db)
    if provider is None:
        return None
    items = await provider.serp(keyword, language_code=language_for_project(project),
                                location_code=location_for_project(project))
    mine = _project_domain(project)
    position = None
    url = None
    top10 = []
    features: set[str] = set()
    for item in items:
        itype = item.get("type") or ""
        if itype != "organic":
            features.add(itype)
            continue
        rank = item.get("rank_absolute") or item.get("rank_group") or 0
        dom = _norm_domain(item.get("domain") or "")
        if position is None and dom and (dom == mine or dom.endswith("." + mine)):
            position = float(rank)
            url = item.get("url")
        if len(top10) < 10:
            top10.append({"rank": int(rank), "domain": dom,
                          "url": item.get("url") or "", "title": item.get("title") or ""})
    return {"position": position, "url": url, "top10": top10, "features": sorted(features)}
```

`rank_tracking_service.py`:

```python
"""Tracked-keyword CRUD, daily snapshots, history and deltas."""
import logging
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo_intel import SerpSnapshot, TrackedKeyword
from app.services import serp_service

logger = logging.getLogger(__name__)

TRACKED_CAP = 25
NOT_RANKED = 101.0


class CapReached(Exception): ...
class DuplicateKeyword(Exception): ...


async def add_keyword(project, keyword: str, db: AsyncSession) -> TrackedKeyword:
    kw = " ".join((keyword or "").split()).strip()
    if not kw:
        raise ValueError("keyword required")
    dup = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.project_id == project.id,
        TrackedKeyword.keyword == kw))).scalars().first()
    if dup is not None:
        raise DuplicateKeyword(kw)
    count = (await db.execute(select(func.count()).select_from(TrackedKeyword).where(
        TrackedKeyword.project_id == project.id,
        TrackedKeyword.is_active.is_(True)))).scalar() or 0
    if count >= TRACKED_CAP:
        raise CapReached(TRACKED_CAP)
    tk = TrackedKeyword(org_id=project.org_id, project_id=project.id, keyword=kw,
                        language=serp_service.language_for_project(project),
                        location_code=serp_service.location_for_project(project))
    db.add(tk)
    await db.commit()
    await db.refresh(tk)
    return tk


async def remove_keyword(keyword_id, org_id, db: AsyncSession) -> bool:
    tk = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.id == keyword_id, TrackedKeyword.org_id == org_id))).scalars().first()
    if tk is None:
        return False
    await db.delete(tk)
    await db.commit()
    return True


def _pos(v: float | None) -> float:
    return v if v is not None else NOT_RANKED


async def snapshot_keyword(project, tk: TrackedKeyword, db: AsyncSession) -> SerpSnapshot | None:
    today = date.today()
    existing = (await db.execute(select(SerpSnapshot).where(
        SerpSnapshot.tracked_keyword_id == tk.id, SerpSnapshot.date == today))).scalars().first()
    if existing is not None:
        return None
    res = await serp_service.fetch_serp(project, tk.keyword, db)
    if res is None:
        return None
    snap = SerpSnapshot(org_id=project.org_id, project_id=project.id, tracked_keyword_id=tk.id,
                        date=today, position=res["position"], url=res["url"],
                        top10=res["top10"], features=res["features"])
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return snap


async def _snapshots_since(project_id, since: date, db) -> list[SerpSnapshot]:
    return list((await db.execute(select(SerpSnapshot).where(
        SerpSnapshot.project_id == project_id, SerpSnapshot.date >= since,
    ).order_by(SerpSnapshot.date))).scalars().all())


async def list_with_stats(project_id, org_id, db: AsyncSession) -> list[dict]:
    tks = list((await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.project_id == project_id, TrackedKeyword.org_id == org_id,
        TrackedKeyword.is_active.is_(True)).order_by(TrackedKeyword.created_at))).scalars().all())
    snaps = await _snapshots_since(project_id, date.today() - timedelta(days=31), db)
    by_kw: dict = {}
    for s in snaps:
        by_kw.setdefault(s.tracked_keyword_id, []).append(s)

    def closest(hist: list[SerpSnapshot], days_ago: int) -> SerpSnapshot | None:
        target = date.today() - timedelta(days=days_ago)
        older = [s for s in hist if s.date <= target]
        return older[-1] if older else None

    rows = []
    for tk in tks:
        hist = by_kw.get(tk.id, [])
        latest = hist[-1] if hist else None
        d7 = closest(hist, 7)
        d30 = closest(hist, 30)
        rows.append({
            "id": str(tk.id), "keyword": tk.keyword,
            "position": latest.position if latest else None,
            "url": latest.url if latest else None,
            "features": (latest.features or []) if latest else [],
            "last_checked": latest.date.isoformat() if latest else None,
            "delta_7d": (_pos(d7.position) - _pos(latest.position)) if latest and d7 else None,
            "delta_30d": (_pos(d30.position) - _pos(latest.position)) if latest and d30 else None,
            "spark": [{"date": s.date.isoformat(), "position": s.position} for s in hist],
        })
    return rows


async def history(keyword_id, org_id, days: int, db: AsyncSession) -> dict | None:
    tk = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.id == keyword_id, TrackedKeyword.org_id == org_id))).scalars().first()
    if tk is None:
        return None
    snaps = list((await db.execute(select(SerpSnapshot).where(
        SerpSnapshot.tracked_keyword_id == tk.id,
        SerpSnapshot.date >= date.today() - timedelta(days=days),
    ).order_by(SerpSnapshot.date))).scalars().all())
    latest = snaps[-1] if snaps else None
    return {"keyword": tk.keyword,
            "points": [{"date": s.date.isoformat(), "position": s.position} for s in snaps],
            "top10": (latest.top10 or []) if latest else [],
            "features": (latest.features or []) if latest else [],
            "url": latest.url if latest else None}
```

- [ ] **Step 4: Run to verify pass** — ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/serp_service.py apps/api/app/services/rank_tracking_service.py apps/api/tests/test_seo_intel.py
git commit -m "feat(seo): serp normalization and rank tracking services"
```

---

### Task 4: Daily cron + `serp_drop`/`serp_gain` alerts

**Files:**
- Modify: `apps/api/app/services/rank_tracking_service.py` (alert emission on snapshot)
- Create: `apps/api/app/workers/tasks/seo_tasks.py`
- Modify: `apps/api/app/workers/worker.py` (import, functions, cron 05:30 daily)
- Modify: `apps/web/components/monitoring/AlertsBell.tsx` + `apps/web/app/(dashboard)/[projectId]/alerts/page.tsx` (KIND_AGENT/KIND_GRADIENT gain `serp_drop`/`serp_gain` → zerda) + `apps/web/public/locales/*/common.json` (`alertsCenter.kinds.serp_drop/serp_gain`, native, 6 locales)
- Test: `apps/api/tests/test_seo_intel.py` (append)

**Interfaces:**
- Consumes: `monitoring_service._create_alert` (existing; import at module scope in rank_tracking_service as `create_monitor_alert` for patchability), `monitoring_service._iso_week`.
- Produces: alert emission inside `snapshot_keyword` (after storing, when a previous snapshot exists); `async run_rank_tracker(ctx)` in `seo_tasks.py`; cron `cron(run_rank_tracker, hour=5, minute=30, run_at_startup=False)`.

- [ ] **Step 1: Write failing tests** (append):

```python
@pytest.mark.asyncio
async def test_snapshot_emits_serp_alerts_with_thresholds(db_session):
    from app.services import serp_service, rank_tracking_service as rts
    p = await _mk_project(db_session)
    tk = await rts.add_keyword(p, "menu digital", db_session)
    yesterday = date.today() - timedelta(days=1)
    db_session.add(SerpSnapshot(org_id=FAKE_ORG_ID, project_id=p.id, tracked_keyword_id=tk.id,
                                date=yesterday, position=8.0, url="https://pure-saveur.fr/p",
                                top10=[], features=[]))
    await db_session.commit()
    # today: not in top 100 -> drop from 8 to null (101) -> critical (left top 10)
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(None)))):
        await rts.snapshot_keyword(p, tk, db_session)
    a = (await db_session.execute(select(Alert).where(Alert.kind == "serp_drop"))).scalars().one()
    assert a.severity == "critical" and "/seo" in a.url and "menu digital" in a.title


@pytest.mark.asyncio
async def test_snapshot_gain_and_first_snapshot_silent(db_session):
    from app.services import serp_service, rank_tracking_service as rts
    p = await _mk_project(db_session)
    tk = await rts.add_keyword(p, "kw gain", db_session)
    # first snapshot: baseline, silent
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(None)))):
        await rts.snapshot_keyword(p, tk, db_session)
    assert (await db_session.execute(select(Alert))).scalars().first() is None
    # next day: enters at position 5 -> gain (101 -> 5)
    snap = (await db_session.execute(select(SerpSnapshot))).scalars().one()
    snap.date = date.today() - timedelta(days=1)
    await db_session.commit()
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(5)))):
        await rts.snapshot_keyword(p, tk, db_session)
    g = (await db_session.execute(select(Alert).where(Alert.kind == "serp_gain"))).scalars().one()
    assert g.severity == "info"


@pytest.mark.asyncio
async def test_rank_tracker_cron_isolates_and_filters(db_session):
    from app.workers.tasks import seo_tasks
    p_ok = await _mk_project(db_session)
    from app.services import rank_tracking_service as rts
    await rts.add_keyword(p_ok, "kw", db_session)
    await _mk_project(db_session)  # no tracked keywords -> skipped
    calls = []

    async def fake_snapshot_project(project, db):
        calls.append(project.id)
        raise RuntimeError("boom")

    with patch.object(seo_tasks, "snapshot_project", new=fake_snapshot_project), \
         patch.object(seo_tasks, "async_session_factory", new=lambda: _single_session(db_session)):
        await seo_tasks.run_rank_tracker(None)
    assert calls == [p_ok.id]
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement.** In `rank_tracking_service.py`: module-scope imports `from app.services.monitoring_service import _create_alert as create_monitor_alert, _iso_week`; add `snapshot_project(project, db) -> int` (loops active keywords, calls `snapshot_keyword`, counts snapshots) and extend `snapshot_keyword` — after storing the new snapshot, look up the most recent PREVIOUS snapshot (`date < today`, order desc limit 1); if one exists:

```python
    prev_pos = _pos(prev.position)
    new_pos = _pos(snap.position)
    delta = new_pos - prev_pos
    wk = _iso_week()
    if delta >= 3.0:
        fell_out = prev_pos <= 10.0 < new_pos
        await create_monitor_alert(
            project.id, project.org_id, kind="serp_drop",
            severity="critical" if fell_out else "warning",
            title=f"SERP drop: '{tk.keyword}'",
            detail=(f"Google position {_fmt_pos(prev.position)} -> {_fmt_pos(snap.position)} "
                    f"({tk.language}/{tk.location_code})."),
            url=f"/{project.id}/seo", dedupe_key=f"serp_drop:{tk.keyword}:{wk}", db=db)
        await db.commit()
    elif delta <= -3.0:
        await create_monitor_alert(
            project.id, project.org_id, kind="serp_gain", severity="info",
            title=f"SERP gain: '{tk.keyword}'",
            detail=f"Google position {_fmt_pos(prev.position)} -> {_fmt_pos(snap.position)}.",
            url=f"/{project.id}/seo", dedupe_key=f"serp_gain:{tk.keyword}:{wk}", db=db)
        await db.commit()
```

with `def _fmt_pos(v): return f"{v:.1f}" if v is not None else "not in top 100"`. Create `seo_tasks.py` mirroring `autopilot_tasks.py`: select projects having >= 1 active TrackedKeyword (join distinct), per-project try/except, module-scope `from app.services.rank_tracking_service import snapshot_project` and `async_session_factory`. Register in worker: `cron(run_rank_tracker, hour=5, minute=30, run_at_startup=False)`. Frontend: add both kinds to the two KIND_AGENT/KIND_GRADIENT maps (zerda), and `alertsCenter.kinds.serp_drop` ("SERP drop" / native) + `serp_gain` in the six locales.

- [ ] **Step 4: Run to verify pass + worker registers** — all tests pass; worker log lists `run_rank_tracker`; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/rank_tracking_service.py apps/api/app/workers/tasks/seo_tasks.py apps/api/app/workers/worker.py apps/web/components/monitoring/AlertsBell.tsx "apps/web/app/(dashboard)/[projectId]/alerts/page.tsx" apps/web/public/locales/*/common.json apps/api/tests/test_seo_intel.py
git commit -m "feat(seo): daily rank tracker cron with serp_drop/serp_gain alerts"
```

---

### Task 5: `/seo` router + frontend client

**Files:**
- Create: `apps/api/app/api/v1/routers/seo_hub.py`
- Modify: `apps/api/app/api/v1/router.py` (register prefix `/seo`, tags `["seo"]`)
- Modify: `apps/web/lib/api.ts`
- Test: `apps/api/tests/test_seo_intel.py` (append endpoint tests; copy the `client` fixture from `tests/test_monitoring.py`)

**Interfaces:**
- Consumes: T3/T4 services; ownership-guard idiom from `routers/monitoring.py` (`_assert_project`).
- Produces (backend): `GET /seo/provider-status?project_id=` → `{connected, source: "org"|"env"|null}`; `GET /seo/keywords?project_id=` → `list_with_stats` rows; `POST /seo/keywords` {project_id, keyword} → 201 row | 400 cap/blank | 409 dup | 404 foreign project; `DELETE /seo/keywords/{id}` → {ok} | 404; `POST /seo/keywords/{id}/refresh` → snapshot result or 409 `{"detail": {"code": "no_seo_provider"}}`; `GET /seo/keywords/{id}/history?days=90` → history dict | 404; `GET /seo/suggestions?project_id=` → up to 10 `{keyword, impressions}` from GSC top queries (reuse `analytics_service.get_top_queries(project_id, org_id, db)` — verify its exact signature/return shape first) excluding already-tracked keywords, `[]` when no GSC data. All org-scoped.
- Produces (frontend `api.ts`):

```typescript
export interface TrackedKeywordRow {
  id: string; keyword: string; position: number | null; url: string | null;
  features: string[]; last_checked: string | null;
  delta_7d: number | null; delta_30d: number | null;
  spark: { date: string; position: number | null }[];
}
export interface KeywordHistory {
  keyword: string; points: { date: string; position: number | null }[];
  top10: { rank: number; domain: string; url: string; title: string }[];
  features: string[]; url: string | null;
}
export async function getSeoProviderStatus(projectId: string): Promise<{ connected: boolean; source: string | null }>
export async function listTrackedKeywords(projectId: string): Promise<TrackedKeywordRow[]>
export async function addTrackedKeyword(projectId: string, keyword: string): Promise<TrackedKeywordRow>
export async function removeTrackedKeyword(id: string): Promise<{ ok: boolean }>
export async function refreshTrackedKeyword(id: string): Promise<{ ok: boolean }>
export async function getKeywordHistory(id: string, days?: number): Promise<KeywordHistory>
export async function getKeywordSuggestions(projectId: string): Promise<{ keyword: string; impressions: number }[]>
```

- [ ] **Step 1: Failing endpoint tests** (append; `client` fixture copied from test_monitoring):

```python
@pytest.mark.asyncio
async def test_seo_keyword_endpoints(client, db_session, org_and_project):
    p = await _mk_project(db_session)
    r = await client.get(f"/api/v1/seo/provider-status?project_id={p.id}")
    assert r.status_code == 200 and r.json()["connected"] in (True, False)
    r = await client.post("/api/v1/seo/keywords", json={"project_id": str(p.id), "keyword": "menu digital"})
    assert r.status_code == 201, r.text
    kid = r.json()["id"]
    r = await client.post("/api/v1/seo/keywords", json={"project_id": str(p.id), "keyword": "menu digital"})
    assert r.status_code == 409
    r = await client.post("/api/v1/seo/keywords", json={"project_id": str(uuid.uuid4()), "keyword": "x"})
    assert r.status_code == 404
    r = await client.get(f"/api/v1/seo/keywords?project_id={p.id}")
    assert len(r.json()) == 1 and r.json()[0]["keyword"] == "menu digital"
    r = await client.get(f"/api/v1/seo/keywords/{kid}/history?days=30")
    assert r.status_code == 200 and r.json()["keyword"] == "menu digital"
    r = await client.delete(f"/api/v1/seo/keywords/{kid}")
    assert r.status_code == 200
    r = await client.get(f"/api/v1/seo/keywords?project_id={p.id}")
    assert r.json() == []


@pytest.mark.asyncio
async def test_refresh_without_provider_returns_409_code(client, db_session, org_and_project, monkeypatch):
    from app.services import serp_service
    p = await _mk_project(db_session)
    r = await client.post("/api/v1/seo/keywords", json={"project_id": str(p.id), "keyword": "kw"})
    kid = r.json()["id"]
    with patch.object(serp_service, "get_seo_provider_for_org", new=AsyncMock(return_value=None)):
        r = await client.post(f"/api/v1/seo/keywords/{kid}/refresh")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_seo_provider"
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement the router** (mirror `routers/monitoring.py` idioms incl. `_assert_project`; map `CapReached` → 400, `DuplicateKeyword` → 409, blank → 400; `provider-status` resolves via `get_seo_provider_for_org` and reports `source` by checking org key first then env). `refresh` loads the TrackedKeyword org-scoped, loads the project, calls `snapshot_keyword`; when `fetch_serp` would be provider-less (check provider first) → 409 code payload. Register in `router.py`. Add the api.ts types/functions per the Interfaces block.

- [ ] **Step 4: Run to verify pass** — backend all green; `npm run typecheck` exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/seo_hub.py apps/api/app/api/v1/router.py apps/web/lib/api.ts apps/api/tests/test_seo_intel.py
git commit -m "feat(seo): seo hub API and frontend client"
```

---

### Task 6: SEO hub page (Rank Tracker) + nav + i18n

**Files:**
- Create: `apps/web/app/(dashboard)/[projectId]/seo/page.tsx`
- Create: `apps/web/components/seo/RankTrackerTable.tsx`, `apps/web/components/seo/KeywordDrawer.tsx`, `apps/web/components/seo/AddKeywordBar.tsx`, `apps/web/components/seo/ProviderGate.tsx`
- Modify: `apps/web/components/layout/Sidebar.tsx` (NAV_ITEMS `seo` + persona lists)
- Modify: `apps/web/public/locales/{en,fr,es,de,pt,ar}/common.json` (`seoHub.*`, `nav.seo`)

**Interfaces:**
- Consumes: Task 5 client functions/types; recharts (LineChart) idioms from the analytics page; `Card`, `PageHeader`, `useToast`; `FENNEX_AGENTS.zerda` for attribution.
- Produces: the `/[projectId]/seo` route.

- [ ] **Step 1: Build the page + components.** Exact behavior:
  - Page: `PageHeader` (icon `TrendingUp`, title `t("seoHub.title")`, description `t("seoHub.subtitle")`); `useQuery(["seo-provider", projectId], getSeoProviderStatus)`; when `!connected` render `ProviderGate` (Card hero: Zerda avatar, `t("seoHub.gate.title")`, `t("seoHub.gate.body")`, button `t("seoHub.gate.cta")` → `/settings`); else `AddKeywordBar` + `RankTrackerTable` + (when a row selected) `KeywordDrawer`.
  - `AddKeywordBar`: input + add button (`addTrackedKeyword`; 400/409 → toast server message; on success invalidate `["seo-keywords", projectId]`); shows `t("seoHub.cap", {max: 25})` hint and disables at 25 rows; below it a suggestions row: `useQuery(["seo-suggestions", projectId], () => getKeywordSuggestions(projectId))` rendered as clickable chips (`t("seoHub.suggested")` label; click = add that keyword), hidden when empty.
  - `RankTrackerTable` (`useQuery(["seo-keywords", projectId], listTrackedKeywords, staleTime 60s)`): columns keyword / position (null → `t("seoHub.notRanked")`) / delta chips 7d & 30d (positive = green `text-success` with up arrow, negative = red `text-destructive`, computed sign directly from `delta_7d`) / best URL (truncated, external link) / features badges (small chips of feature type) / last checked (locale date) / sparkline (tiny recharts `LineChart` of `spark`, Y reversed so up = better) / actions (refresh → `refreshTrackedKeyword` with 409 → gate toast; remove). Empty state `t("seoHub.empty")`. Row click opens drawer.
  - `KeywordDrawer` (right panel, like campaigns StepPanel): `useQuery(["seo-history", id], () => getKeywordHistory(id, 90))`; 90-day position `LineChart` (Y axis reversed, domain [1, 'auto']); top-10 list (rank, title, domain) with your domain's row highlighted `bg-primary/10`; features; close button.
  - Sidebar: `seo: { key: "seo", href: "seo", icon: TrendingUp }` in NAV_ITEMS; add `"seo"` after `"analytics"` in all three persona lists; `nav.seo` = "SEO" in all six locales.
  - i18n `seoHub.*` (native, 6 locales): `title` ("Rank Tracker"), `subtitle` ("Zerda tracks your keywords' real Google positions every day"), `gate.title` ("Connect your SEO data provider"), `gate.body` ("Rank tracking and content scoring run on your own DataForSEO account. Add your credentials in Settings - pay-per-use, a fraction of a cent per check."), `gate.cta` ("Open Settings"), `addPlaceholder` ("Add a keyword to track..."), `add` ("Track"), `cap` ("Up to {{max}} keywords per project"), `empty` ("No tracked keywords yet. Add your first one above."), `notRanked` ("not in top 100"), `columns.keyword/position/delta7/delta30/url/features/checked`, `refresh` ("Refresh"), `remove` ("Remove"), `drawer.top10` ("Top 10"), `drawer.you` ("you"), `suggested` ("From your search data:").
- [ ] **Step 2: Verify** — typecheck exit 0; 6 locale JSONs valid; `docker compose restart web && sleep 9 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/` → 200/302; no hardcoded strings/emoji greps clean.
- [ ] **Step 3: Commit**

```bash
git add apps/web/components/seo/ "apps/web/app/(dashboard)/[projectId]/seo/page.tsx" apps/web/components/layout/Sidebar.tsx apps/web/public/locales/*/common.json
git commit -m "feat(seo): rank tracker page with provider gate, table and keyword drawer"
```

---

### Task 7: Content scoring service + `/seo/score` + crawler text field

**Files:**
- Modify: `services/crawler/app/crawler.py` (+`text` field) and `services/crawler/tests/test_crawler.py` (assert field)
- Create: `apps/api/app/services/content_scoring_service.py`
- Modify: `apps/api/app/api/v1/routers/seo_hub.py` (POST `/seo/score`)
- Modify: `apps/web/lib/api.ts` (score types + fn)
- Test: `apps/api/tests/test_seo_intel.py` (append)

**Interfaces:**
- Consumes: `serp_service.fetch_serp` + latest `SerpSnapshot` cache (<= 7 days); crawler `POST /crawl` (now returns `text`); `call_llm` + `project_locale` from `llm_service`; `Article` model (`body_markdown`/`title`).
- Produces: `async score_content(project, keyword: str, db, *, article_id=None, url=None, text=None) -> dict` returning `{"score": int, "terms": [{"term", "status": "present"|"underused"|"missing", "count", "target"}], "structure": {"word_count", "target_words", "headings", "target_headings"}, "questions": [str], "brief": str | None, "serp_median_words": int, "pages_analyzed": int}`; raises `NoProvider` (module exception) when provider-less and no fresh snapshot; router `POST /seo/score` {project_id, keyword, article_id?|url?|text?} → 200 payload | 422 no content | 409 no_seo_provider.
- Crawler: `result["text"]` = `soup.get_text(" ", strip=True)` truncated to 20000 chars (after removing `script`/`style` tags).

- [ ] **Step 1: Crawler change + its test.** In `services/crawler/app/crawler.py`: add `"text": None` to the result skeleton; after parsing, `for tag in soup(["script", "style", "noscript"]): tag.decompose()` then `result["text"] = soup.get_text(" ", strip=True)[:20000]`. Extend the existing crawler test asserting `"text"` present and non-empty for the fixture page. Run the crawler's own tests per its README/pytest layout (`docker compose exec -T crawler pytest` or local — check how existing crawler tests run; if the crawler container has no pytest, run locally with its venv or verify via a live `curl` to `/crawl`).
- [ ] **Step 2: Failing scoring tests** (append to test_seo_intel; patch `content_scoring_service._crawl_page` and `serp_service.fetch_serp` and `content_scoring_service.call_llm`):

```python
@pytest.mark.asyncio
async def test_score_content_terms_and_structure(db_session):
    from app.services import content_scoring_service as css
    p = await _mk_project(db_session)
    serp = {"position": None, "url": None, "features": [],
            "top10": [{"rank": i, "domain": f"s{i}.com", "url": f"https://s{i}.com", "title": f"T{i}"} for i in range(1, 11)]}
    corpus = ("menu digital restaurant qr code carte restaurant menu digital "
              "prix menu digital exemple restaurant support") * 40  # ~ 4400 words total corpus
    async def fake_crawl(url):
        return {"text": corpus, "word_count": len(corpus.split()), "h2": ["A", "B", "C"], "title": "t"}
    my_text = "menu digital pour votre restaurant " * 30  # mentions some terms, misses others
    with patch.object(css, "fetch_serp", new=AsyncMock(return_value=serp)), \
         patch.object(css, "_crawl_page", new=fake_crawl), \
         patch.object(css, "call_llm", new=AsyncMock(return_value="Brief: add pricing section")):
        res = await css.score_content(p, "menu digital", db_session, text=my_text)
    assert 0 <= res["score"] <= 100
    statuses = {t["term"]: t["status"] for t in res["terms"]}
    assert "menu" in statuses and statuses.get("prix") in ("missing", "underused")
    assert res["structure"]["target_words"] > 0 and res["pages_analyzed"] == 5
    assert res["brief"] == "Brief: add pricing section"


@pytest.mark.asyncio
async def test_score_content_degrades_without_llm_and_partial_crawls(db_session):
    from app.services import content_scoring_service as css
    p = await _mk_project(db_session)
    serp = {"position": None, "url": None, "features": [],
            "top10": [{"rank": i, "domain": f"s{i}.com", "url": f"https://s{i}.com", "title": f"T{i}"} for i in range(1, 11)]}
    calls = {"n": 0}
    async def flaky_crawl(url):
        calls["n"] += 1
        if calls["n"] % 2 == 0:
            raise RuntimeError("crawl fail")
        return {"text": "menu digital " * 200, "word_count": 400, "h2": ["A"], "title": "t"}
    with patch.object(css, "fetch_serp", new=AsyncMock(return_value=serp)), \
         patch.object(css, "_crawl_page", new=flaky_crawl), \
         patch.object(css, "call_llm", new=AsyncMock(side_effect=RuntimeError("no key"))):
        res = await css.score_content(p, "menu digital", db_session, text="menu digital restaurant")
    assert res["brief"] is None and res["pages_analyzed"] >= 1
```

- [ ] **Step 3: Implement `content_scoring_service.py`:**

```python
"""Content scoring vs the live top-10 SERP: deterministic term/structure analysis
plus one optional locale-aware LLM brief (Dune)."""
import logging
import re
from collections import Counter
from datetime import date, timedelta

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.models.seo_intel import SerpSnapshot, TrackedKeyword
from app.services.serp_service import fetch_serp
from app.services.llm_service import call_llm, get_org_llm_keys

logger = logging.getLogger(__name__)

TOP_PAGES = 5
TERMS_LIMIT = 20
SNAPSHOT_MAX_AGE_DAYS = 7

_STOPWORDS = {
    "en": {"the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "is", "are",
           "your", "you", "it", "this", "that", "at", "by", "from", "as", "be", "we", "our"},
    "fr": {"le", "la", "les", "un", "une", "des", "et", "ou", "de", "du", "en", "pour", "sur",
           "avec", "est", "sont", "votre", "vos", "vous", "ce", "cette", "au", "aux", "par",
           "dans", "que", "qui", "plus", "pas", "nous", "notre"},
}


class NoProvider(Exception): ...


async def _crawl_page(url: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{settings.CRAWLER_SERVICE_URL}/crawl", json={"url": url})
        resp.raise_for_status()
        page = resp.json()
    if page.get("error") or (page.get("status_code") or 0) >= 400:
        raise RuntimeError(page.get("error") or "crawl failed")
    return page


def _tokenize(text: str, lang: str) -> list[str]:
    words = re.findall(r"[a-z0-9à-öø-ÿœç']+", (text or "").lower())
    stop = _STOPWORDS.get(lang, _STOPWORDS["en"])
    return [w for w in words if len(w) > 2 and w not in stop]


async def _serp_top10(project, keyword: str, db) -> list[dict]:
    tk = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.project_id == project.id, TrackedKeyword.keyword == keyword,
    ))).scalars().first()
    if tk is not None:
        snap = (await db.execute(select(SerpSnapshot).where(
            SerpSnapshot.tracked_keyword_id == tk.id,
            SerpSnapshot.date >= date.today() - timedelta(days=SNAPSHOT_MAX_AGE_DAYS),
        ).order_by(SerpSnapshot.date.desc()))).scalars().first()
        if snap is not None and snap.top10:
            return snap.top10
    serp = await fetch_serp(project, keyword, db)
    if serp is None:
        raise NoProvider()
    return serp["top10"]


async def score_content(project, keyword: str, db, *, article_id=None, url=None, text=None) -> dict:
    lang = (project.locale or "en")[:2].lower()
    if article_id is not None:
        from app.models.article import Article
        art = await db.get(Article, article_id)
        content = f"{art.title or ''}\n{art.body_markdown or ''}" if art else ""
        my_headings = len(re.findall(r"^#{1,3} ", art.body_markdown or "", re.M)) if art else 0
    elif url is not None:
        page = await _crawl_page(url)
        content = page.get("text") or ""
        my_headings = len(page.get("h2") or [])
    elif text is not None:
        content = text
        my_headings = 0
    else:
        raise ValueError("one of article_id, url, text is required")

    top10 = await _serp_top10(project, keyword, db)
    corpus_tokens: list[str] = []
    word_counts: list[int] = []
    heading_counts: list[int] = []
    questions: list[str] = []
    analyzed = 0
    for item in top10[:TOP_PAGES]:
        try:
            page = await _crawl_page(item["url"])
        except Exception:
            continue
        analyzed += 1
        corpus_tokens.extend(_tokenize(page.get("text") or "", lang))
        word_counts.append(int(page.get("word_count") or 0))
        heading_counts.append(len(page.get("h2") or []))
        for h in (page.get("h2") or []):
            if "?" in h:
                questions.append(h)
    if analyzed == 0:
        raise RuntimeError("Could not analyze any top-ranking page.")

    top_terms = [t for t, _ in Counter(corpus_tokens).most_common(TERMS_LIMIT)]
    mine = Counter(_tokenize(content, lang))
    corpus_freq = Counter(corpus_tokens)
    terms = []
    present = 0
    for term in top_terms:
        target = max(1, round(corpus_freq[term] / max(analyzed, 1) / 4))
        count = mine.get(term, 0)
        if count == 0:
            status = "missing"
        elif count < target:
            status = "underused"
        else:
            status = "present"
            present += 1
        terms.append({"term": term, "status": status, "count": count, "target": target})

    word_counts.sort()
    median_words = word_counts[len(word_counts) // 2] if word_counts else 0
    my_words = len(content.split())
    coverage = present / max(len(top_terms), 1)
    length_ratio = min(my_words / median_words, 1.0) if median_words else 0.0
    score = round(coverage * 70 + length_ratio * 30)

    brief = None
    try:
        keys = await get_org_llm_keys(project.org_id, db)
        pm = next(((p, m) for p, m in [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-4o-mini")] if p in keys), None)
        if pm:
            missing = ", ".join(t["term"] for t in terms if t["status"] != "present")[:400]
            brief = (await call_llm(pm[0], pm[1], keys[pm[0]],
                "You are Dune, an SEO content editor. Given gaps versus top-ranking pages, "
                "write a prioritized 4-6 bullet improvement brief. Be concrete and terse.",
                f"KEYWORD: {keyword}\nMY WORD COUNT: {my_words} (SERP median {median_words})\n"
                f"WEAK/MISSING TERMS: {missing}\nQUESTIONS ON SERP: {'; '.join(questions[:6])}",
                locale=project.locale)).strip()
    except Exception:
        brief = None

    return {"score": score, "terms": terms,
            "structure": {"word_count": my_words, "target_words": median_words,
                          "headings": my_headings,
                          "target_headings": (sorted(heading_counts)[len(heading_counts) // 2] if heading_counts else 0)},
            "questions": questions[:10], "brief": brief,
            "serp_median_words": median_words, "pages_analyzed": analyzed}
```

Router: `POST /seo/score` — body {project_id, keyword, article_id?, url?, text?}; `_assert_project`; 422 when all three content args absent; `NoProvider` → 409 `{"code": "no_seo_provider"}`; `RuntimeError` from zero-crawls → 502 with the message. api.ts: `ContentScore` interface mirroring the payload + `scoreContent(projectId, keyword, opts: {articleId?, url?, text?})`.

- [ ] **Step 4: Run to verify pass** — `pytest tests/test_seo_intel.py -v` all green; typecheck clean; crawler `text` verified.

- [ ] **Step 5: Commit**

```bash
git add services/crawler/app/crawler.py services/crawler/tests/test_crawler.py apps/api/app/services/content_scoring_service.py apps/api/app/api/v1/routers/seo_hub.py apps/web/lib/api.ts apps/api/tests/test_seo_intel.py
git commit -m "feat(seo): content scoring vs live top-10 with crawler text extraction"
```

---

### Task 8: ContentScoreCard + editor Optimize tab + i18n

**Files:**
- Create: `apps/web/components/seo/ScoreResult.tsx` (shared result view)
- Create: `apps/web/components/seo/ContentScoreCard.tsx` (SEO hub)
- Create: `apps/web/components/seo/OptimizePanel.tsx` (article editor)
- Modify: `apps/web/app/(dashboard)/[projectId]/seo/page.tsx` (mount ContentScoreCard below the tracker)
- Modify: `apps/web/app/(dashboard)/[projectId]/articles/page.tsx` (Optimize tab in the editor right panel)
- Modify: `apps/web/public/locales/{en,fr,es,de,pt,ar}/common.json` (`seoHub.score.*`)

**Interfaces:**
- Consumes: `scoreContent` + `ContentScore` (T7); the editor's existing right-panel structure (read the section around the `articles.editor.seoScore` / `articles.editor.breakdown` markers in `articles/page.tsx` before editing); `ProgressRing` from `@/components/ui/ProgressRing`.
- Produces: `<ScoreResult data={ContentScore} />`; `<OptimizePanel projectId articleId targetKeyword />`.

- [ ] **Step 1: Build.** Exact behavior:
  - `ScoreResult`: score `ProgressRing` (value = score) + `t("seoHub.score.of100")`; three term groups (missing / underused / present) as chip lists with count/target tooltips (`title` attr); structure row (words vs target, headings vs target); questions list; brief rendered as text lines when non-null. Locale numbers.
  - `ContentScoreCard` (hub): inputs keyword + URL-or-text toggle (two tabs: `t("seoHub.score.byUrl")` / `t("seoHub.score.byText")`), submit → `scoreContent`; 409 no_seo_provider → gate toast; loading state; renders `ScoreResult`.
  - `OptimizePanel` (editor): props from the open article (`articleId`, `target_keyword` prefilled but editable input); score button → `scoreContent(projectId, kw, {articleId})`; compact `ScoreResult`; re-score button; provider-gate inline message (409). Mount as a collapsible section in the editor's right panel directly below the existing SEO score/breakdown block — match the panel's existing section styling (read it first). Attribute to Dune (`FENNEX_AGENTS.dune` icon + name in the section header).
  - i18n `seoHub.score.*` (native, 6 locales): `title` ("Content Optimizer"), `subtitle` ("Dune scores your content against the live top 10"), `keyword`, `byUrl`, `byText`, `urlPlaceholder`, `textPlaceholder`, `analyze` ("Analyze"), `rescore` ("Re-score"), `of100` ("/100"), `missing` ("Missing"), `underused` ("Underused"), `present` ("Covered"), `words` ("{{count}} words (target {{target}})"), `headings` ("{{count}} headings (target {{target}})"), `questions` ("Questions to answer"), `brief` ("Dune's brief"), `optimize` ("Optimize").
- [ ] **Step 2: Verify** — typecheck exit 0; JSONs valid; restart web → 200; greps clean (no hardcoded strings/emoji/hex).
- [ ] **Step 3: Commit**

```bash
git add apps/web/components/seo/ "apps/web/app/(dashboard)/[projectId]/seo/page.tsx" "apps/web/app/(dashboard)/[projectId]/articles/page.tsx" apps/web/public/locales/*/common.json
git commit -m "feat(seo): content optimizer card and article editor optimize panel"
```

---

## Final verification

- [ ] Backend: `docker compose exec -T api pytest tests/test_seo_intel.py tests/test_monitoring.py tests/test_autopilot.py tests/test_campaigns.py -v` — ALL pass.
- [ ] `make db-migrate` idempotent; worker logs list `run_rank_tracker` + existing tasks.
- [ ] Frontend: typecheck clean; 6 locale JSONs valid with `seoHub.*`, `settings.seoData.*`, `nav.seo`, `alertsCenter.kinds.serp_*` parity.
- [ ] Live (requires a real DataForSEO account, else verify the gate states): Settings → add DataForSEO login/password → SEO page shows tracker; add a keyword → Refresh → position + top-10 appear; run `docker compose exec -T api python -c "import asyncio; from app.workers.tasks.seo_tasks import run_rank_tracker; asyncio.run(run_rank_tracker(None))"`; force a drop by editing yesterday's snapshot position in DB → re-run → alert in the bell. Score an article via the editor Optimize tab. Without credentials: `/seo` shows the connect gate, refresh/score return the gate toast — never fake data.
- [ ] Both themes + one RTL locale spot-check. Ledger updated; branch ready.
