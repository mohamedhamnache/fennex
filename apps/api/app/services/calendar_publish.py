"""Publish dispatch for calendar entries. Reuses the existing per-type publish paths."""
import json
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_credentials, decrypt_value
from app.integrations.publishing.wordpress import WordPressConnector
from app.models.article import Article, ArticleStatus
from app.models.calendar_entry import CalendarEntry
from app.models.image import GeneratedImage
from app.models.publishing import PublishingConnection, PublishingPlatform, PublishJob, PublishJobStatus
from app.models.social import SocialConnection, SocialPlatform, SocialPost, SocialPostStatus
from app.services.publish_service import publish_to_wordpress


async def _wp_connection(entry: CalendarEntry, db: AsyncSession) -> PublishingConnection:
    conn = (await db.execute(select(PublishingConnection).where(
        PublishingConnection.id == entry.connection_id, PublishingConnection.org_id == entry.org_id,
        PublishingConnection.platform == PublishingPlatform.wordpress))).scalars().first()
    if conn is None or not conn.credentials_encrypted:
        raise RuntimeError("WordPress connection missing or has no credentials.")
    if not conn.is_active:
        raise RuntimeError("WordPress connection is inactive.")
    return conn


async def _publish_article(entry: CalendarEntry, db: AsyncSession) -> dict:
    art = (await db.execute(select(Article).where(
        Article.id == entry.content_id, Article.org_id == entry.org_id))).scalars().first()
    if art is None:
        raise RuntimeError("Article no longer exists.")
    if art.status not in (ArticleStatus.ready, ArticleStatus.published):
        raise RuntimeError("Article is not ready to publish (status must be ready or published).")
    conn = await _wp_connection(entry, db)
    creds = decrypt_credentials(conn.credentials_encrypted)
    wp = WordPressConnector(site_url=conn.site_url, username=creds["username"], app_password=creds["app_password"])
    result = await wp.publish_post(
        title=art.title, content_html=art.body_html or "", status="publish",
        meta_title=art.meta_title, meta_description=art.meta_description,
    )
    if not result.get("ok"):
        raise RuntimeError(f"WordPress publish failed: {result}")
    db.add(PublishJob(org_id=entry.org_id, project_id=entry.project_id, connection_id=conn.id,
                      article_id=art.id, status=PublishJobStatus.done,
                      platform_post_id=str(result.get("post_id")), published_url=result.get("url")))
    art.status = ArticleStatus.published
    return {"ok": True, "url": result.get("url")}


async def _publish_banner(entry: CalendarEntry, db: AsyncSession) -> dict:
    img = (await db.execute(select(GeneratedImage).where(
        GeneratedImage.id == entry.content_id, GeneratedImage.org_id == entry.org_id))).scalars().first()
    if img is None or not img.image_url:
        raise RuntimeError("Banner image no longer exists.")
    conn = await _wp_connection(entry, db)
    creds = decrypt_credentials(conn.credentials_encrypted)
    result = await publish_to_wordpress(
        image_url=img.image_url, seo_filename=img.seo_filename, alt_text=img.alt_text,
        wp_url=conn.site_url, wp_user=creds.get("username", ""), wp_app_password=creds.get("app_password", ""),
    )
    if not result.get("ok"):
        raise RuntimeError(f"WordPress image publish failed: {result}")
    return {"ok": True, "url": result.get("external_url")}


async def _publish_social(entry: CalendarEntry, db: AsyncSession) -> dict:
    post = (await db.execute(select(SocialPost).where(
        SocialPost.id == entry.content_id, SocialPost.org_id == entry.org_id))).scalars().first()
    if post is None:
        raise RuntimeError("Social post no longer exists.")
    if post.platform != SocialPlatform.linkedin:
        raise RuntimeError("Only LinkedIn auto-publish is supported.")
    conn = (await db.execute(select(SocialConnection).where(
        SocialConnection.org_id == entry.org_id, SocialConnection.platform == SocialPlatform.linkedin))).scalars().first()
    if conn is None:
        raise RuntimeError("LinkedIn is not connected.")
    creds = json.loads(decrypt_value(conn.encrypted_token))
    token, urn = creds.get("access_token"), creds.get("urn")
    if not token or not urn:
        raise RuntimeError("LinkedIn credentials are incomplete — reconnect.")
    text = post.content
    if post.hashtags:
        text += "\n\n" + " ".join(h if h.startswith("#") else f"#{h}" for h in post.hashtags)
    body = {
        "author": urn, "lifecycleState": "PUBLISHED",
        "specificContent": {"com.linkedin.ugc.ShareContent": {
            "shareCommentary": {"text": text[:2900]}, "shareMediaCategory": "NONE"}},
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post("https://api.linkedin.com/v2/ugcPosts",
            headers={"Authorization": f"Bearer {token}", "X-Restli-Protocol-Version": "2.0.0"}, json=body)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"LinkedIn rejected the post ({resp.status_code}): {resp.text[:180]}")
    post.status = SocialPostStatus.published
    return {"ok": True, "url": None}


_DISPATCH = {"article": "_publish_article", "banner": "_publish_banner", "social": "_publish_social"}


async def publish_entry(entry: CalendarEntry, db: AsyncSession) -> CalendarEntry:
    """Publish a single calendar entry. No-op unless it is armed (scheduled or failed-retry)."""
    if entry.state not in ("scheduled", "failed"):
        return entry
    entry.state = "publishing"
    await db.commit()
    try:
        handler = globals()[_DISPATCH[entry.content_type]]
        result = await handler(entry, db)
        entry.state = "published"
        entry.published_at = datetime.now(timezone.utc).isoformat()
        entry.published_url = result.get("url")
        entry.error = None
    except Exception as exc:  # noqa: BLE001 — record any publish failure on the entry
        entry.state = "failed"
        entry.error = str(exc)[:2000]
    await db.commit()
    await db.refresh(entry)
    return entry
