"""The output contract for every image operation.

The pipeline this replaces downloaded each model result, decoded it, forced it
to RGBA and re-encoded it as PNG -- a full lossy round-trip applied to output
that usually needed no transformation at all. Combined with flux-fill returning
jpg by default, results carried JPEG artifacts at PNG file size.

Rules here, in priority order:
  1. Pass the original bytes through untouched whenever nothing must change.
  2. Never force a colour mode. Alpha belongs only to operations that make it.
  3. Never resize unless the caller explicitly asked.
  4. Never silently return a smaller image than the input.

IMPORT DIRECTION: editing_service imports from here, never the reverse.
_download, _retry and _TRANSIENT_ERRORS live here rather than in
editing_service so that rule can hold -- keeping them there and importing them
from this module would be a circular import that fails at startup.
"""
import asyncio
import base64
import io
import uuid
from enum import Enum
from typing import Optional

import httpx
from PIL import Image as PILImage

from app.core.storage import upload_bytes

# Transient network failures worth retrying (e.g. "All connection attempts
# failed" under many parallel requests when generating a whole set at once).
_TRANSIENT_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadError,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
    httpx.PoolTimeout,
)


async def _retry(coro_factory, attempts: int = 3, base_delay: float = 0.6):
    """Await coro_factory(), retrying on transient connection errors with backoff."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return await coro_factory()
        except _TRANSIENT_ERRORS as e:
            last = e
            if i < attempts - 1:
                await asyncio.sleep(base_delay * (2 ** i))
    raise last  # type: ignore[misc]


async def _download(url: str) -> bytes:
    if url.startswith("data:"):
        # data URI -- decode inline (used when S3 is not configured, or for
        # gpt-image-1 b64 output)
        _, encoded = url.split(",", 1)
        return base64.b64decode(encoded)

    async def _do() -> bytes:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content

    return await _retry(_do)


class ResolutionPolicy(str, Enum):
    """What to do when the model's output size differs from the input's."""
    PRESERVE = "preserve"          # sizes must match; a mismatch is an error
    UPSCALE = "upscale"            # resize back up to the source size
    ALLOW_CHANGE = "allow_change"  # the operation's purpose IS changing size


class ResolutionMismatch(RuntimeError):
    """A model returned a different size than its input under PRESERVE."""


def dimensions(data: bytes) -> tuple[int, int]:
    """(width, height) from the image header.

    PIL.open is lazy -- it parses the header only, so this does not decode
    pixel data and the resolution assertion never forces a full decode.
    """
    return PILImage.open(io.BytesIO(data)).size


_EXT = {
    "JPEG": ("jpg", "image/jpeg"),
    "PNG": ("png", "image/png"),
    "WEBP": ("webp", "image/webp"),
    "GIF": ("gif", "image/gif"),
}


async def finalize(output_url: str, *, source_size: Optional[tuple[int, int]] = None,
                   policy: ResolutionPolicy = ResolutionPolicy.PRESERVE,
                   folder: str = "edits") -> str:
    """Store a model's output, transforming it as little as possible."""
    data = await _download(output_url)
    fmt = (PILImage.open(io.BytesIO(data)).format or "PNG").upper()

    if source_size is not None and policy is not ResolutionPolicy.ALLOW_CHANGE:
        got = dimensions(data)
        if got != source_size:
            if policy is ResolutionPolicy.PRESERVE:
                raise ResolutionMismatch(
                    f"model returned {got[0]}x{got[1]} for a "
                    f"{source_size[0]}x{source_size[1]} input"
                )
            # UPSCALE: the only path that re-encodes, and only because the
            # pixels genuinely changed.
            img = PILImage.open(io.BytesIO(data))
            img = img.resize(source_size, PILImage.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            data, fmt = buf.getvalue(), "PNG"

    ext, content_type = _EXT.get(fmt, ("png", "image/png"))
    return await upload_bytes(data, f"{folder}/{uuid.uuid4().hex}.{ext}", content_type)
