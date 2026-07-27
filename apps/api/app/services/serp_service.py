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


async def fetch_serp(project, keyword: str, db, unit: str = "serp") -> dict | None:
    """Fetch and normalize a live SERP. This is the shared chokepoint for every
    caller that needs one keyword's SERP (rank tracking, content scoring,
    plagiarism-adjacent research, agent tools) -- so metering lives here rather
    than in each caller. `unit` lets the caller attribute the billable
    DataForSEO task to the right SEO-credit bucket (default "serp";
    rank_tracking_service passes "rank_check")."""
    provider = await get_seo_provider_for_org(project.org_id, db)
    if provider is None:
        return None
    items = await provider.serp(keyword, language_code=language_for_project(project),
                                location_code=location_for_project(project))

    # Best-effort metering: attribute to the project's org. Isolated session so a
    # metering hiccup never breaks the SERP lookup itself.
    try:
        from app.core.database import async_session_factory
        from app.services.metering import meter as _meter
        async with async_session_factory() as _mdb:
            await _meter.record_seo(_mdb, org_id=project.org_id, project_id=project.id,
                                    unit=unit, count=1, feature=unit)
    except Exception:  # noqa: BLE001
        logger.warning("serp usage metering failed", exc_info=True)

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
