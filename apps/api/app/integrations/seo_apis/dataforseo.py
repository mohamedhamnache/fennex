import asyncio
import time
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
        for task in data.get("tasks", []) or []:
            # `or [{}]` and not a dict default: DataForSEO returns the key with
            # an explicit null when a task found nothing, and .get(k, default)
            # returns that null rather than the default -- so the next subscript
            # raised TypeError and killed the whole keyword-research job for
            # every seed, not just the empty one. A task with no results is a
            # normal outcome, not an error.
            for item in (task.get("result") or [{}])[0].get("items", []) or []:
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

    async def serp_standard(self, keyword: str, language_code: str = "en",
                            location_code: int = 2840, depth: int = 10,
                            timeout_s: float = 600.0) -> list[dict]:
        """SERP via the STANDARD queue instead of Live.

        Standard costs $0.0006 per page against Live's $0.002 -- a 70% saving --
        in exchange for a ~5 minute turnaround instead of ~6 seconds. That is
        the right trade for scheduled work: the rank tracker runs unattended at
        05:30 and nobody is waiting on the result, so paying a 3.3x premium for
        latency buys nothing.

        Task-based rather than a single call: post the task, then poll until it
        is ready. `tasks_ready` is deliberately not used -- it reports across the
        whole account, so two workers polling it would race for each other's
        results. Polling this task's own id is slower but correct.
        """
        async with httpx.AsyncClient(auth=self._auth, timeout=60.0) as client:
            post = await client.post(
                f"{self.BASE_URL}/serp/google/organic/task_post",
                json=[{"keyword": keyword, "language_code": language_code,
                       "location_code": location_code, "depth": depth}],
            )
            post.raise_for_status()
            tasks = (post.json() or {}).get("tasks") or []
            task_id = (tasks[0] or {}).get("id") if tasks else None
            if not task_id:
                return []

            deadline = time.monotonic() + timeout_s
            delay = 10.0
            while time.monotonic() < deadline:
                await asyncio.sleep(delay)
                delay = min(delay * 1.5, 60.0)   # back off; most settle by ~5 min
                got = await client.get(
                    f"{self.BASE_URL}/serp/google/organic/task_get/regular/{task_id}")
                if got.status_code != 200:
                    continue
                for task in (got.json() or {}).get("tasks", []) or []:
                    # 20000 = ok. Anything in the 40000s means still queued.
                    if (task.get("status_code") or 0) != 20000:
                        continue
                    result = (task.get("result") or [{}])[0] or {}
                    return result.get("items") or []
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
