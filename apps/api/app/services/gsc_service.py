"""Google Search Console integration — OAuth token refresh, site listing, and
real Search Analytics sync into the analytics tables."""
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.analytics import (
    AnalyticsSnapshot,
    GscConnection,
    GscPageStat,
    GscQueryStat,
    KeywordRanking,
)
from app.models.keyword import Keyword

_WMB = "https://www.googleapis.com/webmasters/v3"
_TOKEN_URL = "https://oauth2.googleapis.com/token"


class GscError(Exception):
    pass


def _friendly_error(resp: httpx.Response) -> str:
    """Turn a Google API error response into a clear, actionable message."""
    try:
        err = resp.json().get("error", {})
    except Exception:
        return f"Google request failed ({resp.status_code})."
    msg = err.get("message", "") or ""
    status = err.get("status", "")
    blob = str(err)

    if "SERVICE_DISABLED" in blob or "has not been used in project" in msg or "it is disabled" in msg:
        m = re.search(r"https://console\.(?:developers|cloud)\.google\.com/\S+", msg)
        url = (m.group(0).rstrip(".") if m
               else "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com")
        return (
            "The Google Search Console API isn't enabled for your Google Cloud project yet. "
            f"Enable it here: {url} — then wait about a minute and try again."
        )
    if resp.status_code == 401 or status == "UNAUTHENTICATED":
        return "Google authorization expired or was revoked — please reconnect Search Console."
    if resp.status_code == 403:
        return msg or "Access denied by Google. Make sure this account has access to the property."
    return msg or f"Google request failed ({resp.status_code})."


async def _ensure_token(conn: GscConnection, db: AsyncSession) -> str:
    """Return a valid access token, refreshing via the refresh_token if expired."""
    exp: datetime | None = None
    if conn.token_expiry:
        try:
            exp = datetime.fromisoformat(conn.token_expiry)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
        except ValueError:
            exp = None

    fresh = exp is not None and exp - datetime.now(timezone.utc) > timedelta(seconds=60)
    if fresh and conn.access_token:
        return conn.access_token

    if not conn.refresh_token:
        if conn.access_token:
            return conn.access_token  # best effort; may 401
        raise GscError("No refresh token — please reconnect Google Search Console.")

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(_TOKEN_URL, data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": conn.refresh_token,
            "grant_type": "refresh_token",
        })
    if resp.status_code != 200:
        raise GscError(f"Token refresh failed: {resp.text[:200]}")
    data = resp.json()
    conn.access_token = data["access_token"]
    expires_in = data.get("expires_in", 3600)
    conn.token_expiry = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    await db.flush()
    return conn.access_token


async def _get_conn(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> GscConnection:
    result = await db.execute(
        select(GscConnection).where(
            GscConnection.project_id == project_id,
            GscConnection.org_id == org_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise GscError("Google Search Console is not connected.")
    return conn


async def list_sites(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """Return the GSC properties the connected account can access."""
    conn = await _get_conn(project_id, org_id, db)
    token = await _ensure_token(conn, db)
    await db.commit()
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(f"{_WMB}/sites", headers={"Authorization": f"Bearer {token}"})
    if resp.status_code != 200:
        raise GscError(_friendly_error(resp))
    entries = resp.json().get("siteEntry", [])
    # Owners/full users first, then alphabetical
    entries.sort(key=lambda e: (e.get("permissionLevel") != "siteOwner", e.get("siteUrl", "")))
    return [
        {"site_url": e["siteUrl"], "permission_level": e.get("permissionLevel", "")}
        for e in entries
    ]


async def select_site(project_id: uuid.UUID, org_id: uuid.UUID, site_url: str, db: AsyncSession) -> None:
    conn = await _get_conn(project_id, org_id, db)
    conn.site_url = site_url
    conn.is_active = True
    await db.commit()


async def _query(client: httpx.AsyncClient, token: str, site_url: str, body: dict) -> list[dict]:
    url = f"{_WMB}/sites/{quote(site_url, safe='')}/searchAnalytics/query"
    resp = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=body)
    if resp.status_code != 200:
        raise GscError(_friendly_error(resp))
    return resp.json().get("rows", [])


async def sync(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession, days: int = 90) -> dict:
    """Pull real Search Analytics data into snapshots, query/page stats and keyword rankings."""
    conn = await _get_conn(project_id, org_id, db)
    if not conn.site_url:
        raise GscError("No site selected. Choose a Search Console property first.")
    token = await _ensure_token(conn, db)
    site = conn.site_url

    # GSC data lags ~2-3 days; end 2 days ago for complete data.
    end = date.today() - timedelta(days=2)
    start = end - timedelta(days=days - 1)
    start_s, end_s = start.isoformat(), end.isoformat()

    async with httpx.AsyncClient(timeout=45) as client:
        by_date = await _query(client, token, site, {
            "startDate": start_s, "endDate": end_s, "dimensions": ["date"], "rowLimit": 500,
        })
        by_qp = await _query(client, token, site, {
            "startDate": start_s, "endDate": end_s, "dimensions": ["query", "page"], "rowLimit": 5000,
        })

    # ── Daily snapshots ─────────────────────────────────────────────────────
    existing = await db.execute(
        select(AnalyticsSnapshot).where(
            AnalyticsSnapshot.project_id == project_id,
            AnalyticsSnapshot.date >= start,
            AnalyticsSnapshot.date <= end,
        )
    )
    snap_map = {s.date: s for s in existing.scalars().all()}
    for row in by_date:
        d = date.fromisoformat(row["keys"][0])
        clicks = int(row.get("clicks", 0))
        impressions = int(row.get("impressions", 0))
        ctr = float(row.get("ctr", 0.0))
        pos = float(row.get("position", 0.0))
        snap = snap_map.get(d)
        if snap:
            snap.clicks, snap.impressions, snap.ctr, snap.avg_position = clicks, impressions, ctr, pos
        else:
            db.add(AnalyticsSnapshot(
                project_id=project_id, org_id=org_id, date=d,
                clicks=clicks, impressions=impressions, ctr=ctr, avg_position=pos,
            ))

    # ── Aggregate query+page rows ───────────────────────────────────────────
    q_agg: dict[str, dict] = {}
    p_agg: dict[str, dict] = {}
    for row in by_qp:
        q, pg = row["keys"][0], row["keys"][1]
        clicks = float(row.get("clicks", 0))
        impr = float(row.get("impressions", 0))
        pos = float(row.get("position", 0.0))
        for key, agg, k in ((q, q_agg, "top_url"), (pg, p_agg, None)):
            a = agg.setdefault(key, {"clicks": 0.0, "impr": 0.0, "pos_w": 0.0, "best": (0.0, "")})
            a["clicks"] += clicks
            a["impr"] += impr
            a["pos_w"] += pos * impr  # impression-weighted position (matches GSC)
        # track best page per query for keyword URL
        qa = q_agg[q]
        if clicks >= qa["best"][0]:
            qa["best"] = (clicks, pg)

    def finalize(agg: dict) -> dict:
        for a in agg.values():
            a["ctr"] = a["clicks"] / a["impr"] if a["impr"] else 0.0
            a["position"] = a["pos_w"] / a["impr"] if a["impr"] else 0.0
        return agg
    finalize(q_agg)
    finalize(p_agg)

    # ── Replace query & page stats with the latest sync ─────────────────────
    await db.execute(delete(GscQueryStat).where(GscQueryStat.project_id == project_id))
    await db.execute(delete(GscPageStat).where(GscPageStat.project_id == project_id))

    top_q = sorted(q_agg.items(), key=lambda kv: kv[1]["clicks"], reverse=True)[:200]
    for q, a in top_q:
        db.add(GscQueryStat(
            project_id=project_id, org_id=org_id, query=q[:500],
            clicks=int(a["clicks"]), impressions=int(a["impr"]),
            ctr=round(a["ctr"], 4), position=round(a["position"], 1), top_url=a["best"][1] or None,
        ))
    top_p = sorted(p_agg.items(), key=lambda kv: kv[1]["clicks"], reverse=True)[:200]
    for pg, a in top_p:
        db.add(GscPageStat(
            project_id=project_id, org_id=org_id, url=pg[:2048],
            clicks=int(a["clicks"]), impressions=int(a["impr"]),
            ctr=round(a["ctr"], 4), position=round(a["position"], 1),
        ))

    # ── Real keyword rankings (match tracked keywords to GSC queries) ────────
    kw_result = await db.execute(
        select(Keyword).where(Keyword.project_id == project_id, Keyword.org_id == org_id)
    )
    keywords = kw_result.scalars().all()
    today = date.today()
    matched = 0
    if keywords:
        q_lower = {q.lower(): a for q, a in q_agg.items()}
        existing_r = await db.execute(
            select(KeywordRanking).where(
                KeywordRanking.project_id == project_id,
                KeywordRanking.date == today,
            )
        )
        rank_map = {r.keyword_id: r for r in existing_r.scalars().all()}
        for kw in keywords:
            a = q_lower.get(kw.keyword.lower())
            if not a:
                continue
            matched += 1
            pos = round(a["position"], 1)
            url = a["best"][1] or None
            r = rank_map.get(kw.id)
            if r:
                r.position, r.url = pos, url
            else:
                db.add(KeywordRanking(
                    keyword_id=kw.id, project_id=project_id, org_id=org_id,
                    date=today, position=pos, url=url,
                ))

    conn.last_synced_at = datetime.now(timezone.utc).isoformat()
    await db.commit()

    return {
        "ok": True,
        "days": days,
        "date_points": len(by_date),
        "queries": len(top_q),
        "pages": len(top_p),
        "keywords_matched": matched,
        "last_synced_at": conn.last_synced_at,
    }
