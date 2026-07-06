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
        # data URIs are stored locally — download them directly via httpx
        async with httpx.AsyncClient(timeout=30) as client:
            img_resp = await client.get(image_url)
            img_resp.raise_for_status()
            image_bytes = img_resp.content
            content_type = img_resp.headers.get("content-type", "image/png")

        ext = "jpg" if "jpeg" in content_type else content_type.split("/")[-1]
        filename = f"{seo_filename or 'image'}.{ext}"
        credentials = base64.b64encode(f"{wp_user}:{wp_app_password}".encode()).decode()

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{wp_url.rstrip('/')}/wp-json/wp/v2/media",
                content=image_bytes,
                headers={
                    "Authorization": f"Basic {credentials}",
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Content-Type": content_type,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        media_id = data["id"]

        if alt_text:
            async with httpx.AsyncClient(timeout=30) as client:
                await client.post(
                    f"{wp_url.rstrip('/')}/wp-json/wp/v2/media/{media_id}",
                    json={"alt_text": alt_text},
                    headers={"Authorization": f"Basic {credentials}"},
                )

        return {
            "ok": True,
            "external_id": str(media_id),
            "external_url": data.get("source_url", ""),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def publish_to_shopify(
    image_url: str,
    alt_text: str | None,
    shopify_domain: str,
    shopify_token: str,
) -> dict:
    """Upload image to Shopify Files API via GraphQL."""
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
