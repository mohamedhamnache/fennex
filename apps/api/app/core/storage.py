"""Async S3-compatible upload utility (Supabase Storage / AWS S3)."""
import asyncio
import uuid
import boto3
from app.core.config import settings

_CONTENT_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "gif": "image/gif",
}


def _s3_client():
    return boto3.client(
        "s3",
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        endpoint_url=settings.S3_ENDPOINT_URL or None,
    )


def _public_url(key: str) -> str:
    if settings.S3_ENDPOINT_URL:
        base = settings.S3_ENDPOINT_URL.removesuffix("/s3")
        return f"{base}/object/public/{settings.S3_BUCKET}/{key}"
    return f"https://{settings.S3_BUCKET}.s3.{settings.S3_REGION}.amazonaws.com/{key}"


async def upload_bytes(content: bytes, key: str, content_type: str = "image/png") -> str:
    """Upload raw bytes to S3. Returns public URL."""
    client = _s3_client()

    def _do():
        client.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=content, ContentType=content_type)

    await asyncio.to_thread(_do)
    return _public_url(key)


async def upload_file(content: bytes, filename: str, folder: str = "uploads") -> str:
    """Upload bytes, generating a unique key from the filename extension."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    key = f"{folder}/{uuid.uuid4().hex}.{ext}"
    content_type = _CONTENT_TYPES.get(ext, "application/octet-stream")
    return await upload_bytes(content, key, content_type)
