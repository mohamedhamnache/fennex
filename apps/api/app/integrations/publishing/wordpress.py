"""WordPress REST API v2 connector."""
import httpx
from typing import Any


class WordPressConnector:
    """
    Connects to a self-hosted WordPress site via Application Password credentials.
    Credentials format: {"username": "...", "app_password": "..."}
    """

    def __init__(self, site_url: str, username: str, app_password: str):
        # Normalize site_url: strip trailing slash, ensure https prefix
        self.site_url = site_url.rstrip("/")
        self.api_base = f"{self.site_url}/wp-json/wp/v2"
        self.auth = (username, app_password)

    async def test_connection(self) -> dict:
        """
        Calls GET /wp-json/wp/v2/users/me to verify credentials.
        Returns {"ok": True, "user": display_name} or {"ok": False, "error": message}.
        Timeout: 10s.
        """
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{self.api_base}/users/me", auth=self.auth)
            if r.status_code == 200:
                data = r.json()
                return {"ok": True, "user": data.get("name", "unknown")}
            return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
        except httpx.TimeoutException:
            return {"ok": False, "error": "Connection timed out"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def publish_post(
        self,
        title: str,
        content_html: str,
        status: str = "draft",          # "draft" | "publish"
        slug: str | None = None,
        meta_title: str | None = None,
        meta_description: str | None = None,
        tags: list[str] | None = None,
        categories: list[int] | None = None,
    ) -> dict:
        """
        Creates a WordPress post via POST /wp-json/wp/v2/posts.
        Returns {"ok": True, "post_id": int, "url": str} or {"ok": False, "error": str}.

        Content: sends body_html as-is.
        Meta SEO: if Yoast or Rank Math plugin is active they read `meta.yoast_head_json` —
        we send meta in the post `meta` field dict under keys `_yoast_wpseo_title` and
        `_yoast_wpseo_metadesc` for Yoast compatibility. Ghost/Rank Math ignored for now.

        Tags: resolve tag names to IDs via GET /tags?search=name, create if not found.
        Categories: pass int IDs directly. Default to [1] (Uncategorized) if not provided.
        """
        # Resolve or create tags
        tag_ids = []
        if tags:
            for tag_name in tags:
                tag_id = await self._resolve_or_create_tag(tag_name)
                if tag_id:
                    tag_ids.append(tag_id)

        payload: dict[str, Any] = {
            "title": title,
            "content": content_html,
            "status": status,
            "categories": categories or [1],
        }
        if tag_ids:
            payload["tags"] = tag_ids
        if slug:
            payload["slug"] = slug
        if meta_title or meta_description:
            payload["meta"] = {}
            if meta_title:
                payload["meta"]["_yoast_wpseo_title"] = meta_title
            if meta_description:
                payload["meta"]["_yoast_wpseo_metadesc"] = meta_description

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(f"{self.api_base}/posts", json=payload, auth=self.auth)
            if r.status_code in (200, 201):
                data = r.json()
                return {
                    "ok": True,
                    "post_id": data["id"],
                    "url": data.get("link", ""),
                    "raw": data,
                }
            return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:500]}"}
        except httpx.TimeoutException:
            return {"ok": False, "error": "Request timed out"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _resolve_or_create_tag(self, name: str) -> int | None:
        """Search for tag by name; create if missing. Returns tag ID or None on error."""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{self.api_base}/tags", params={"search": name, "per_page": 5}, auth=self.auth)
                if r.status_code == 200:
                    existing = [t for t in r.json() if t["name"].lower() == name.lower()]
                    if existing:
                        return existing[0]["id"]
                    # Create
                    cr = await client.post(f"{self.api_base}/tags", json={"name": name}, auth=self.auth)
                    if cr.status_code in (200, 201):
                        return cr.json()["id"]
        except Exception:
            pass
        return None
