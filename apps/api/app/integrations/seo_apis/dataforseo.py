import httpx
from app.integrations.seo_apis.base import KeywordData, _classify_intent


class DataForSEOProvider:
    """Real DataForSEO implementation. Requires login + password credentials."""
    BASE_URL = "https://api.dataforseo.com/v3"

    def __init__(self, login: str, password: str):
        self._auth = (login, password)

    async def get_keyword_ideas(self, seed: str, location_code: int = 2840) -> list[KeywordData]:
        async with httpx.AsyncClient(auth=self._auth, timeout=30.0) as client:
            resp = await client.post(
                f"{self.BASE_URL}/dataforseo_labs/google/keyword_ideas/live",
                json=[{"keyword": seed, "location_code": location_code, "language_code": "en", "limit": 50}]
            )
            resp.raise_for_status()
            data = resp.json()
        results = []
        for task in data.get("tasks", []):
            for item in task.get("result", [{}])[0].get("items", []):
                kw = item.get("keyword", "")
                metrics = item.get("keyword_info", {})
                results.append(KeywordData(
                    keyword=kw,
                    search_volume=metrics.get("search_volume"),
                    difficulty=item.get("keyword_properties", {}).get("keyword_difficulty"),
                    cpc=metrics.get("cpc"),
                    intent=_classify_intent(kw),
                    serp_features=item.get("serp_info", {}).get("serp_item_types", []),
                ))
        return results

    async def serp(self, keyword: str, language_code: str = "en", location_code: int = 2840,
                   depth: int = 100) -> list[dict]:
        """Live Google organic SERP. Returns the raw item list (rank, type, domain,
        url, title). ``depth`` (number of results) drives cost -- keep it low when
        you only need the top of the page (e.g. competitor discovery)."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.BASE_URL}/serp/google/organic/live/regular",
                auth=self._auth,
                json=[{"keyword": keyword, "language_code": language_code,
                       "location_code": location_code, "depth": depth}],
            )
            resp.raise_for_status()
            data = resp.json()
        try:
            return data["tasks"][0]["result"][0]["items"] or []
        except (KeyError, IndexError, TypeError):
            return []

    async def serp_batch(self, keywords: list[str], language_code: str = "en",
                         location_code: int = 2840, depth: int = 100) -> dict[str, list[dict]]:
        """Fetch several keywords' SERPs in ONE request. DataForSEO's live endpoint
        accepts an array of tasks, so N keywords cost one HTTP round trip instead of
        N. Returns {keyword: items}. (Billing is still per SERP task, so also keep
        the keyword count and ``depth`` small.)"""
        tasks = [
            {"keyword": kw, "language_code": language_code,
             "location_code": location_code, "depth": depth}
            for kw in keywords if kw and kw.strip()
        ]
        if not tasks:
            return {}
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                f"{self.BASE_URL}/serp/google/organic/live/regular",
                auth=self._auth, json=tasks,
            )
            resp.raise_for_status()
            data = resp.json()
        out: dict[str, list[dict]] = {}
        for task in data.get("tasks", []) or []:
            kw = (task.get("data") or {}).get("keyword")
            if kw is None:
                continue
            try:
                out[kw] = task["result"][0]["items"] or []
            except (KeyError, IndexError, TypeError):
                out[kw] = []
        return out
