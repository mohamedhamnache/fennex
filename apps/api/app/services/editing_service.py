"""Image editing operations — Pillow (basic), Remove.bg, Replicate (AI/Advanced)."""
import asyncio
import base64
import io
import logging
import time
import uuid
from typing import Mapping, Optional
import httpx
from PIL import Image as PILImage, ImageChops, ImageEnhance, ImageFilter, ImageOps
from app.core.config import settings
from app.core.storage import upload_bytes

logger = logging.getLogger(__name__)


# ── Internal helpers ──────────────────────────────────────────────────────────

# _TRANSIENT_ERRORS, _retry and _download now live in image_output so the import
# graph runs one way only (editing_service -> image_output). They are re-exported
# here because several callers still import them from this module
# (app/api/v1/routers/seo.py, app/services/mask_service.py). Behaviour is
# unchanged; only their home moved.
#
# NOTE for test authors: image_output.finalize calls image_output's own
# _download, so patching editing_service._download does NOT affect it. Patch
# app.services.image_output._download instead.
from app.services.image_output import (
    StoredImage,  # noqa: E402
    ResolutionMismatch,
    ResolutionPolicy,
    _TRANSIENT_ERRORS,
    _download,
    _retry,
    dimensions,
    finalize,
)


def _replicate_retry_after(resp: httpx.Response, default: float = 5.0) -> float:
    """Seconds to wait before retrying a Replicate 429, per its own guidance.

    Replicate reports this as a `retry_after` field in the JSON body (its
    `Retry-After` header, when present, is redundant with the same value)."""
    try:
        return float(resp.json().get("retry_after", default))
    except Exception:  # noqa: BLE001
        return default


async def _create_prediction(client: httpx.AsyncClient, url: str, payload: dict, headers: dict,
                               attempts: int = 4) -> httpx.Response:
    """POST a Replicate prediction, retrying on 429.

    Below $5 of Replicate account credit, prediction creation is throttled to
    6/min with a burst of just 1 -- routine, low, concurrency (e.g. a "batch"
    generation feature firing a few scenes at once) reliably exceeds that
    burst and gets 429'd. Replicate tells us exactly how long to wait
    (`retry_after`), so honor it instead of failing the whole generation.
    """
    resp = await _retry(lambda: client.post(url, json=payload, headers=headers))
    for i in range(attempts - 1):
        if resp.status_code != 429:
            return resp
        await asyncio.sleep(_replicate_retry_after(resp))
        resp = await _retry(lambda: client.post(url, json=payload, headers=headers))
    return resp


async def _upload_result(img: PILImage.Image, folder: str = "edits") -> StoredImage:
    """Always lossless. The old JPEG-at-quality-95 branch silently degraded every
    non-RGBA result -- which, once _open stopped forcing RGBA, is most of them.

    Reports the stored size as well: crop and resize genuinely change it, so a
    caller that assumed the source's dimensions would record a lie.
    """
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    url = await upload_bytes(buf.read(), f"{folder}/{uuid.uuid4().hex}.png", "image/png")
    return StoredImage(url, img.width, img.height)


# Modes PNG cannot store, or that Pillow's filters and enhancers reject. A CMYK
# JPEG cannot be written as PNG at all; palette (P) and grayscale (L/LA) images
# raise in denoise/sharpen/adjust. Everything else keeps its source mode.
_SAFE_MODES = frozenset({"RGB", "RGBA"})


def _open(data: bytes) -> PILImage.Image:
    """Open, normalising ONLY the modes downstream cannot handle.

    Forcing RGBA on everything turned every RGB photo into a bloated RGBA PNG
    for no quality gain. Dropping normalisation entirely, though, broke CMYK
    JPEGs, palette PNGs and GIFs, and grayscale sources -- so exotic modes are
    promoted to the nearest safe one, preserving alpha where it exists, and
    RGB/RGBA pass through untouched.
    """
    img = PILImage.open(io.BytesIO(data))
    if img.mode in _SAFE_MODES:
        return img
    has_alpha = img.mode in {"LA", "PA"} or "transparency" in img.info
    return img.convert("RGBA" if has_alpha else "RGB")


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


# ── Basic ops (Pillow) ────────────────────────────────────────────────────────

async def crop_image(image_url: str, x: int, y: int, w: int, h: int) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        cropped = img.crop((x, y, x + w, y + h))
        stored = await _upload_result(cropped)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def resize_image(image_url: str, width: int, height: int, keep_aspect: bool = True) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        if keep_aspect:
            img.thumbnail((width, height), PILImage.LANCZOS)
        else:
            img = img.resize((width, height), PILImage.LANCZOS)
        stored = await _upload_result(img)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def rotate_image(image_url: str, angle: float, fill_color: str | None = None) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        if fill_color:
            # A solid fill works in the source's own mode, so an RGB photo stays
            # RGB rather than being promoted for no reason.
            fill = _hex_to_rgb(fill_color)
            if img.mode == "RGBA":
                fill = fill + (255,)
        else:
            # A TRANSPARENT fill is impossible without an alpha channel: expand=True
            # creates new corners that must be see-through, so this is one of the
            # few places that genuinely needs the promotion _open no longer does.
            if img.mode != "RGBA":
                img = img.convert("RGBA")
            fill = (0, 0, 0, 0)
        rotated = img.rotate(-angle, expand=True, fillcolor=fill)
        stored = await _upload_result(rotated)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def flip_image(image_url: str, direction: str = "horizontal") -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        img = ImageOps.mirror(img) if direction == "horizontal" else ImageOps.flip(img)
        stored = await _upload_result(img)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def adjust_image(image_url: str, brightness: float = 0, contrast: float = 0, saturation: float = 0) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        if brightness != 0:
            factor = 1.0 + brightness / 100.0
            img = ImageEnhance.Brightness(img).enhance(max(0.0, factor))
        if contrast != 0:
            factor = 1.0 + contrast / 100.0
            img = ImageEnhance.Contrast(img).enhance(max(0.0, factor))
        if saturation != 0:
            factor = 1.0 + saturation / 100.0
            img = ImageEnhance.Color(img).enhance(max(0.0, factor))
        stored = await _upload_result(img)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _color_shift(img: PILImage.Image, r: int = 0, g: int = 0, b: int = 0) -> PILImage.Image:
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    r_ch, g_ch, b_ch, a_ch = img.split()
    r_ch = r_ch.point(lambda x: min(255, max(0, x + r)))
    g_ch = g_ch.point(lambda x: min(255, max(0, x + g)))
    b_ch = b_ch.point(lambda x: min(255, max(0, x + b)))
    return PILImage.merge("RGBA", (r_ch, g_ch, b_ch, a_ch))


def _sepia_fn(img: PILImage.Image) -> PILImage.Image:
    grayscale = img.convert("L").convert("RGB")
    sepia = grayscale.convert("RGBA")
    sepia = _color_shift(sepia, r=+30, g=+10, b=-20)
    return sepia


_FILTER_MAP = {
    "grayscale": lambda img: ImageOps.grayscale(img.convert("RGB")).convert("RGBA"),
    "sepia": _sepia_fn,
    "warm": lambda img: _color_shift(img, r=+20, g=+5, b=-10),
    "cool": lambda img: _color_shift(img, r=-10, g=+5, b=+20),
    "vivid": lambda img: ImageEnhance.Color(img).enhance(1.8),
}


async def apply_filter(image_url: str, filter_name: str) -> dict:
    if filter_name not in _FILTER_MAP:
        return {"ok": False, "error": f"Unknown filter: {filter_name}"}
    try:
        data = await _download(image_url)
        img = _open(data)
        result = _FILTER_MAP[filter_name](img)
        stored = await _upload_result(result)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def denoise_image(image_url: str, strength: float = 0.5) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        passes = max(1, round(strength * 5))
        for _ in range(passes):
            img = img.filter(ImageFilter.MedianFilter(size=3))
        stored = await _upload_result(img)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def sharpen_image(image_url: str, strength: float = 0.5) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        factor = 1.0 + strength * 3
        img = ImageEnhance.Sharpness(img).enhance(factor)
        stored = await _upload_result(img)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Remove.bg ─────────────────────────────────────────────────────────────────


async def _removebg_cutout(image_url: str, *, feature: str = "background_removal") -> PILImage.Image:
    """Fetch the Remove.bg cutout as an RGBA image.

    The alpha channel IS a foreground segmentation, which is what
    app.services.mask_service derives the product-tier mask from. Kept separate
    from remove_background() so that caller does not have to re-download its own
    uploaded result to recover the alpha. Raises rather than returning an error
    dict -- callers that want the dict contract wrap it.
    """
    data = await _download(image_url)
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.remove.bg/v1.0/removebg",
            data={"size": "auto"},
            files={"image_file": ("image.png", data, "image/png")},
            headers={"X-Api-Key": settings.REMOVE_BG_API_KEY},
        )
        resp.raise_for_status()

    # Metered HERE, at the single point the supplier is actually called, for the
    # same reason _replicate_run meters Replicate: every caller is covered and
    # none can be counted twice. Metering at the call sites instead left the
    # user-facing "remove background" button charging NOTHING while the
    # identical call made by auto-masking was charged -- a paid supplier call
    # billed to no one.
    #
    # Best-effort, attributed to the ambient org set at the auth boundary, and
    # never allowed to break the edit itself.
    try:
        from app.core.metering_context import get_metering_org
        _org = get_metering_org()
        if _org is not None:
            from app.core.database import async_session_factory
            from app.services.metering import meter as _meter
            async with async_session_factory() as _db:
                await _meter.record_removebg(_db, org_id=_org, project_id=None,
                                             feature=feature)
    except Exception:  # noqa: BLE001
        logger.warning("remove.bg usage metering failed", exc_info=True)

    return PILImage.open(io.BytesIO(resp.content)).convert("RGBA")


# ── BiRefNet (the quality cutout path) ────────────────────────────────────────
#
# Verified live against the Replicate API on 2026-08-04: 6,990,037 runs, input
# schema {image, resolution}, output a single URL. Community model, so it bills
# per GPU-second (A100 80GB, $0.001400/s) and a run lands on
# MIN_REPLICATE_CREDITS. Do not "correct" this version from memory -- a
# nonexistent model has reached production in this codebase before by being
# recalled rather than resolved.
_MODEL_BIREFNET = "men1scus/birefnet"
_BIREFNET_VERSION = "f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7"


async def _birefnet_run(image_url: str) -> tuple[str, tuple[int, int]]:
    """Run BiRefNet at the SOURCE image's own frame.

    Returns (output_url, source_size). The size is measured from the source
    bytes, never taken from a caller or a database row: two of the four
    production rows measured while diagnosing the Remove BG defect record a
    width/height that does not match their own stored file (a row saying
    1792x1024 whose file is 2080x1664), so a row-derived figure would assert
    against a frame that never existed.

    `resolution` is passed explicitly rather than left to the model's default
    for the same reason remove.bg's `size: "auto"` was the bug: a supplier-side
    default is free to resolve to a preview tier, and did.
    """
    src = dimensions(await _download(image_url))
    out = await _replicate_run(
        _MODEL_BIREFNET,
        {"image": image_url, "resolution": f"{src[0]}x{src[1]}"},
        version=_BIREFNET_VERSION,
    )
    return out, src


async def birefnet_cutout(image_url: str) -> PILImage.Image:
    """The BiRefNet cutout as an RGBA image, at the source frame.

    The alpha channel IS a foreground segmentation, which is what the canvas
    decomposition splits into object layers. Raises rather than returning an
    error dict -- callers wanting the dict contract wrap it.
    """
    out, src = await _birefnet_run(image_url)
    img = PILImage.open(io.BytesIO(await _download(out))).convert("RGBA")
    if img.size != src:
        raise ResolutionMismatch(
            f"{_MODEL_BIREFNET} returned {img.width}x{img.height} for a "
            f"{src[0]}x{src[1]} input"
        )
    return img


async def remove_background(image_url: str) -> dict:
    """Background removal via BiRefNet.

    WAS Remove.bg with `size: "auto"`. Measured against production on
    2026-08-03, every result came back at exactly 0.25 megapixels -- the
    preview tier -- while the customer was charged 191 AI credits ($0.20 flat)
    for it:

        2160x2160 -> 500x500      1024x1024 -> 500x500
        1080x1920 -> 408x612      1792x1024 -> 559x447

    Nothing noticed because this function uploaded its result directly, with
    no finalize() and no ResolutionPolicy. BiRefNet is more accurate on fine
    edges, returns the frame it is asked for, and bills per GPU-second, so a
    run lands on MIN_REPLICATE_CREDITS (10) instead of 191.

    PRESERVE, and a ResolutionMismatch is deliberately NOT swallowed into an
    ok:False dict: a silent resolution change is exactly what hid this defect
    for weeks, so it must surface as a failure with nothing stored rather than
    a soft error the caller can shrug off.

    Everything else -- a Replicate failure, a slow CDN, an S3 5xx during
    finalize's download-then-upload -- keeps the ordinary {"ok": False} dict.
    Only the mismatch is loud; an upload timeout is not a resolution defect and
    must not 500 the /edit route.

    Takes no `source_size` parameter on purpose -- the /edit router hands one
    to any operation that declares it, read off the database row, and that row
    can disagree with its own file (see _birefnet_run).

    Metering fires inside _replicate_run's success branch, BEFORE the PRESERVE
    check, so a mismatch bills ~10 credits for a request that stores nothing.
    That is inherent to metering at the supplier chokepoint and is the right
    trade -- the supplier spend genuinely happened -- but it is now a path
    reachable by design rather than by accident, so it is recorded here.

    `_removebg_cutout` is untouched: mask_service still derives product-tier
    masks from Remove.bg's alpha, and that path is not what this fixes.
    """
    try:
        out, src = await _birefnet_run(image_url)
        stored = await finalize(out, source_size=src, policy=ResolutionPolicy.PRESERVE)
    except ResolutionMismatch:
        raise
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
    return {"ok": True, "image_url": stored.url,
            "width": stored.width, "height": stored.height}


_MODEL_REMBG = "851-labs/background-remover"
_REMBG_VERSION = "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"


async def remove_background_cheap(image_url: str) -> dict:
    """Cutout via Replicate rather than Remove.bg.

    Remove.bg bills $0.20 per image, which meters to 191 AI credits. This
    community model runs a few GPU-seconds and lands on MIN_REPLICATE_CREDITS
    (10) -- 19x cheaper for the customer's allowance and for our margin.
    Output carries alpha, so the policy must be ALLOW_CHANGE: the model
    returns the subject's bounding box, not the source frame -- asserting
    PRESERVE would fail every call, the same defect that broke
    generate_shadow until a real prediction caught it.

    Separate from remove_background(), which is untouched: this adds a
    cheaper path, it does not replace the existing Remove.bg tool.
    """
    try:
        out = await _replicate_run(
            _MODEL_REMBG,
            {"image": image_url, "format": "png", "background_type": "rgba"},
            version=_REMBG_VERSION,
        )
        stored = await finalize(out, policy=ResolutionPolicy.ALLOW_CHANGE)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── Replicate ─────────────────────────────────────────────────────────────────

_REPLICATE_API = "https://api.replicate.com/v1"
_POLL_INTERVAL = 3
_POLL_TIMEOUT = 300


async def _replicate_run(model: str, input_params: dict, version: Optional[str] = None) -> str | dict:
    """Create a Replicate prediction and poll until succeeded. Returns output URL.

    Without `version`: uses /v1/models/{owner}/{name}/predictions (works for models with
    an active hot deployment, e.g. flux-fill-pro).
    With `version` (SHA256 hash): uses /v1/predictions with {"version": hash, "input": ...}
    which is required for older models that don't have a hot deployment endpoint.

    Generic contract, unchanged for every existing caller: a list output
    returns its first element (a URL string); anything else is coerced with
    `str(output)`, which is a no-op for a plain URL string. The ONLY caller
    whose model output is a mapping (`firtoz/trellis`, called from
    `app.services.product3d.generate`) needs the mapping itself, not a
    Python dict-repr string (`str({...})`) that no downloader can use --
    every other model this function is called with (flux-fill-pro,
    flux-kontext-pro, real-esrgan, codeformer, ...) returns a bare URL or a
    list of URLs and is never affected by this branch.
    """
    headers = {"Authorization": f"Token {settings.REPLICATE_API_KEY}", "Content-Type": "application/json"}

    if version:
        create_url = f"{_REPLICATE_API}/predictions"
        payload = {"version": version, "input": input_params}
    else:
        owner, name = model.split("/", 1)
        create_url = f"{_REPLICATE_API}/models/{owner}/{name}/predictions"
        payload = {"input": input_params}

    async with httpx.AsyncClient(timeout=60) as client:
        create_resp = await _create_prediction(client, create_url, payload, headers)
        if not create_resp.is_success:
            raise RuntimeError(f"Replicate create failed {create_resp.status_code}: {create_resp.text}")
        prediction = create_resp.json()
        pred_id = prediction["id"]
        poll_url = prediction.get("urls", {}).get("get") or f"{_REPLICATE_API}/predictions/{pred_id}"

        deadline = time.monotonic() + _POLL_TIMEOUT
        while time.monotonic() < deadline:
            await asyncio.sleep(_POLL_INTERVAL)
            poll_resp = await _retry(lambda: client.get(poll_url, headers=headers))
            poll_resp.raise_for_status()
            status_data = poll_resp.json()
            status = status_data.get("status")
            if status == "succeeded":
                output = status_data.get("output")

                # Best-effort metering: attribute to the ambient org (set at the auth
                # boundary). Never break image editing.
                try:
                    from app.core.metering_context import get_metering_org
                    _org = get_metering_org()
                    if _org is not None:
                        from app.core.database import async_session_factory
                        from app.services.metering import meter as _meter
                        async with async_session_factory() as _db:
                            await _meter.record_replicate(
                                _db,
                                org_id=_org,
                                project_id=None,
                                model=model,
                                feature="image_edit",
                                # Replicate bills by GPU-second and reports the
                                # real duration, so cost tracks the actual run
                                # rather than a flat per-run guess.
                                predict_seconds=(status_data.get("metrics") or {}).get("predict_time"),
                                # Official image models bill per output image and
                                # report this; community models omit it.
                                image_count=(status_data.get("metrics") or {}).get("image_output_count"),
                            )
                except Exception:  # noqa: BLE001
                    logger.warning("replicate usage metering failed", exc_info=True)

                # A prediction can succeed with no usable output (a null, or an
                # empty list). str(None) would hand the literal string "None"
                # to the downloader, which fails deep in httpx with an opaque
                # "Request URL is missing an 'http://' or 'https://' protocol"
                # far from the real cause. Fail here, where the cause is known.
                if isinstance(output, list):
                    if not output:
                        raise RuntimeError(
                            f"Replicate model {model} succeeded but returned an empty output list"
                        )
                    return output[0]
                if isinstance(output, Mapping):
                    return output
                if output is None or not str(output).strip():
                    raise RuntimeError(
                        f"Replicate model {model} succeeded but returned no output"
                    )
                return str(output)
            if status in ("failed", "canceled"):
                raise RuntimeError(f"Replicate prediction {status}: {status_data.get('error')}")

        raise TimeoutError(f"Replicate prediction {pred_id} timed out after {_POLL_TIMEOUT}s")


_MODEL_FLUX_FILL = "black-forest-labs/flux-fill-pro"

# Removal is RECONSTRUCTIVE, never generative. LaMa takes an image and a mask and
# nothing else -- there is no prompt channel, so inventing a replacement object is
# structurally impossible rather than something to tune against.
#
# What this replaced: remove_object described the background with GPT-4o-mini and
# fed that description to flux-fill as a text prompt, at flux-fill's default
# guidance of 60 (strong adherence to the prompt over the image). Asking a
# strongly-guided generative model to paint "a wooden table surface" into a hole
# is exactly how a removal request produced a brand new object. The fallback path
# was no better: it downscaled to 768px, inpainted, then upscaled back, which is
# irreversible blur.
#
# LaMa is resolution-robust, so no downscale round-trip is needed. It has no hot
# deployment, so version= is required. Verified against the live API 2026-07-30.
_MODEL_LAMA = "allenhooo/lama"
_LAMA_VERSION = "cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72"
# Was fal-ai/shadow-generation, which DOES NOT EXIST on Replicate (its metadata
# endpoint 404s), so this operation could never succeed. Replaced with a real,
# purpose-built model: "Add consistent, customizable shadows to product cutouts".
#
# Every field the old code sent was wrong independently of that: it passed
# `foreground_image` (the field is `image`), `shadow_type: "natural_shadow"` (the
# enum is regular|float), and `shadow_direction` (no such field -- direction is
# expressed as an offset pair). Schema verified against the live API 2026-07-30.
#
# Version pinned despite an active deployment: the direction mapping depends on
# this exact schema, and a silent model update renaming a field would break the
# operation quietly.
_MODEL_SHADOW = "bria/product-shadow"
_SHADOW_VERSION = "ffed8143e81736c5fb32ed63ba7362935d8228687fa3b5173eab2fbf86f54ee6"

# The model has no direction input. Direction is where the shadow FALLS, so it
# maps onto the offset pair; magnitudes stay near the model's own defaults
# (offset_y 15) rather than being invented.
_SHADOW_OFFSETS = {
    "top":          (0, -15),
    "bottom":       (0, 15),
    "bottom-right": (15, 15),
    "bottom-left":  (-15, 15),
    "right":        (15, 0),
    "left":         (-15, 0),
}

# Like _MODEL_SD_INPAINT above, these two have NO hot deployment: calling
# /v1/models/{owner}/{name}/predictions returns a bare
# {"detail":"The requested resource could not be found.","status":404}. They
# must go through /v1/predictions with a pinned version instead. Verified
# against Replicate's live API on 2026-07-30 -- do not drop the version.
# (nightmareai/real-esrgan DOES have a deployment and is deliberately left
# unpinned; its hot endpoint answers 422 on an empty input, not 404.)
_MODEL_IC_LIGHT = "zsxkib/ic-light"
_IC_LIGHT_VERSION = "d41bcb10d8c159868f4cfbd7c6a2ca01484f7d39e4613419d5952c61562f1ba7"
_MODEL_CODEFORMER = "sczhou/codeformer"
_CODEFORMER_VERSION = "cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2"
_MODEL_REAL_ESRGAN = "nightmareai/real-esrgan"

_RELIGHT_PROMPTS = {
    "top":    "bright natural light coming from directly above",
    "bottom": "warm ambient light glowing from below",
    "left":   "soft diffused light from the left side",
    "right":  "soft diffused light from the right side",
}

# ic-light's `light_source` is an enum -- a free-form direction string is
# silently ignored by the model, so anything we cannot map becomes "None"
# (the model's own no-directional-preference value) rather than a value it
# will discard.
# ic-light's width/height are ENUMS: a value outside the list is silently
# ignored and the model falls back to its 512x640 default -- which is how a
# 4000px photo came back tiny. Verified against the live schema 2026-07-30.
_IC_LIGHT_DIMS = (256, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024)


def _clamp_to_ic_light_dims(width: int, height: int) -> tuple[int, int]:
    """Largest allowed dimension not exceeding each input side.

    The model caps at 1024, so a larger input cannot reach parity here; the
    caller compensates with an upscale pass. Returns the enum's smallest value
    when the input is below its floor.
    """
    def _pick(v: int) -> int:
        allowed = [d for d in _IC_LIGHT_DIMS if d <= v]
        return allowed[-1] if allowed else _IC_LIGHT_DIMS[0]
    return _pick(width), _pick(height)


_IC_LIGHT_SOURCES = {
    "top":    "Top Light",
    "bottom": "Bottom Light",
    "left":   "Left Light",
    "right":  "Right Light",
}


async def _flux_fill(image_url: str, prompt: str, mask_url: Optional[str],
                     source_size: Optional[tuple[int, int]] = None) -> dict:
    """Shared body for the three GENERATIVE mask operations.

    These genuinely want new content, so flux-fill and its high default guidance
    are correct here -- unlike removal, which must never be prompted. See
    _MODEL_LAMA.

    output_format is pinned to png: the model defaults to jpg, so every result
    was arriving already lossy before we stored it.
    """
    try:
        # trust_hint=False when a mask is involved: it is about to be resized to
        # this, and a stale database size makes that a silent total failure.
        src_size = await _source_dimensions(image_url, source_size, trust_hint=not mask_url)
        mask_url = await _fit_mask_to_image(mask_url, src_size)
        output = await _replicate_run(_MODEL_FLUX_FILL, {
            "image": image_url, "mask": mask_url, "prompt": prompt,
            "output_format": "png",
        })
        stored = await finalize(output, source_size=src_size)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def replace_background(image_url: str, prompt: str, mask_url: Optional[str] = None,
                                  source_size: Optional[tuple[int, int]] = None) -> dict:
    return await _flux_fill(image_url, prompt, mask_url, source_size)


# ── Instruction-based editing ────────────────────────────────────────────────
#
# Natural-language edits do NOT go through the mask pipeline. Masks need three
# things to go right -- understand the target, produce a pixel-accurate mask of
# it, inpaint it -- and step two is the hard one. Asked to "supprime la menthe",
# the mask path masked the main subject and erased the bottle instead.
#
# An instruction model does it in one step with no mask at all, which is how
# ChatGPT-class editors work. Masks remain the right tool for the MANUAL editor,
# where the user paints a region deliberately and wants surgical control.
#
# Deployment exists (probe returns 422), but the version is pinned anyway: the
# input shape below is exact, and a silent model update renaming a field would
# break every natural-language edit quietly.
_MODEL_NANO_BANANA = "google/nano-banana"
_NANO_BANANA_VERSION = "5bdc2c7cd642ae33611d8c33f79615f98ff02509ab8db9d8ec1cc6c36d378fba"

# Appended to every instruction. These models will happily re-render the whole
# frame unless told not to, which is the difference between "remove the mint"
# and "here is a new picture that also has no mint".
_PRESERVE_CLAUSE = (
    " Keep everything else in the image exactly as it is: do not move, restyle, "
    "recolour or regenerate any other object, and preserve the original framing, "
    "lighting and background."
)


def build_instruction(operation: str, params: dict,
                     user_command: Optional[str] = None) -> Optional[str]:
    """The instruction to send for one planned step.

    On the chat surface this is the USER'S OWN SENTENCE, untouched. The planner
    decides only WHETHER a request is an instruction edit; it does not get to
    rewrite what was asked.

    That distinction is not academic. The planner reduces a request to
    {target, prompt}, which is lossy by design, and the loss is exactly the part
    that makes a precise edit work. Asked to paint a flag "exclusively to the
    visible upper teeth", with "do not modify the lips, gums, skin, lighting"
    and "do not add any paint outside the teeth", the extracted fields kept the
    flag and dropped every constraint -- and the model painted the whole face.

    The extraction exists for the MASK pipeline, which genuinely needs a target
    to segment. Nothing on this path uses a mask, so nothing here needs a target.

    A synthesized phrasing remains only for MULTI-step chains, where one sentence
    covers several operations and cannot be handed whole to each of them.

    Returns None for operations that are not instruction edits (crop, upscale
    and friends stay on their deterministic paths -- an instruction model is a
    worse, costlier way to rotate an image).
    """
    if operation not in _INSTRUCTION_OPS:
        return None

    command = (user_command or "").strip()
    if command:
        return command

    # Multi-step fallback only. `target` here is the planner's extraction, used
    # because the user's one sentence describes several steps at once.
    target = (params.get("target") or "").strip()
    prompt = (params.get("prompt") or "").strip()

    if operation in ("remove_object", "smart_erase"):
        what = target or prompt
        return (f"Remove {what} from the image completely, filling the area so it "
                "looks natural.") if what else None
    if operation == "replace_background":
        return f"Replace the background with {prompt}." if prompt else None
    if operation == "insert_object":
        if not prompt:
            return None
        where = f" at {target}" if target else ""
        return f"Add {prompt}{where} so it looks naturally part of the scene."
    if operation == "generative_fill":
        if not prompt:
            return None
        what = target or "the selected area"
        return f"Replace {what} with {prompt}."
    return None


# Operations whose intent is LOCAL: the user named one thing to change and
# expects the rest of the frame untouched. replace_background is deliberately
# absent -- it is supposed to change most of the picture.
# Operations an instruction model handles. Deterministic ones (crop, rotate,
# upscale...) stay on their own paths.
_INSTRUCTION_OPS = frozenset({
    "remove_object", "smart_erase", "replace_background",
    "insert_object", "generative_fill",
})

_LOCAL_INSTRUCTION_OPS = frozenset({
    "remove_object", "smart_erase", "insert_object", "generative_fill",
})

# Per-channel difference below which a pixel counts as "unchanged". Instruction
# models re-render the whole frame, so a local edit still shifts exposure and
# colour grading a little everywhere. That drift lands well under this; a real
# edit lands far above it.
_EDIT_DIFF_THRESHOLD = 24

# Grows the detected region past the model's soft edges, then feathers the seam
# so the composite does not show a hard outline.
_EDIT_MASK_GROW = 9
_EDIT_MASK_FEATHER = 6


def _composite_local_edit(original: bytes, edited: bytes) -> bytes:
    """Keep the original pixels everywhere the edit did not actually change.

    An instruction model regenerates the entire image, so asking it to remove one
    object also nudges the lighting and colour of everything else -- reported as
    "it just changed the image light a bit". The instruction cannot prevent this;
    only the pixels can.

    So: diff the two frames, threshold away the global drift, keep just the
    region that genuinely changed, and paste ONLY that back over the original.
    The user gets the model's semantic understanding with byte-identical pixels
    everywhere it did not edit.
    """
    src = PILImage.open(io.BytesIO(original)).convert("RGB")
    out = PILImage.open(io.BytesIO(edited)).convert("RGB")
    if out.size != src.size:
        out = out.resize(src.size, PILImage.LANCZOS)

    # Where did the frame genuinely change?
    diff = ImageChops.difference(src, out).convert("L")
    changed = diff.point(lambda v: 255 if v >= _EDIT_DIFF_THRESHOLD else 0, mode="L")

    # Nothing survived the threshold: the model only re-graded the image, so the
    # original IS the correct answer and the "edit" was drift alone.
    if not changed.getbbox():
        return original

    changed = changed.filter(ImageFilter.MaxFilter(_EDIT_MASK_GROW))
    changed = changed.filter(ImageFilter.GaussianBlur(_EDIT_MASK_FEATHER))

    merged = PILImage.composite(out, src, changed)
    buf = io.BytesIO()
    merged.save(buf, format="PNG")
    return buf.getvalue()


async def instruction_edit(image_url: str, instruction: str,
                           operation: Optional[str] = None) -> dict:
    """Edit an image from a plain-language instruction. No mask involved.

    For LOCAL operations the model's output is composited back over the original
    so only the genuinely-changed region survives -- see _composite_local_edit.
    """
    if not instruction or not instruction.strip():
        return {"ok": False, "error": "No instruction provided."}
    try:
        source = await _download(image_url)
        src_size = dimensions(source)
        output = await _replicate_run(
            _MODEL_NANO_BANANA,
            {
                "prompt": instruction.strip() + _PRESERVE_CLAUSE,
                # An ARRAY, not a string -- a bare string is silently ignored.
                "image_input": [image_url],
                "aspect_ratio": "match_input_image",
                # Defaults to jpg, so the result would arrive already lossy.
                "output_format": "png",
            },
            version=_NANO_BANANA_VERSION,
        )
        if operation in _LOCAL_INSTRUCTION_OPS:
            merged = _composite_local_edit(source, await _download(output))
            url = await upload_bytes(merged, f"edits/{uuid.uuid4().hex}.png", "image/png")
            w, h = dimensions(merged)
            return {"ok": True, "image_url": url, "width": w, "height": h}

        # Global edits (replace_background) keep the model's whole frame. It
        # matches the input ASPECT but not its exact pixels, so parity is
        # restored on our side rather than asserted.
        stored = await finalize(output, source_size=src_size,
                                policy=ResolutionPolicy.UPSCALE)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def _source_dimensions(image_url: str,
                             source_size: Optional[tuple[int, int]],
                             *, trust_hint: bool = True) -> tuple[int, int]:
    """The source's size, without refetching it when the caller already knows.

    The edit route holds image.width/height from the database, so downloading
    the whole file again just to read a header cost several megabytes per edit.

    But the database can be WRONG. GeneratedImage.width/height default to
    1792x1024, and rows created before sizes were recorded properly still carry
    that default -- one such row claimed 1792x1024 for a file that is actually
    1600x1600.

    Where that matters, it matters absolutely: a mask is resized to this value,
    so a wrong one hands the model a mask that does not match its image, and
    LaMa answers `succeeded` with a NULL output and no explanation. Callers that
    are about to fit a mask therefore pass trust_hint=False and pay for the
    measurement. For a resolution policy alone, a stale hint is harmless.
    """
    if trust_hint and source_size and source_size[0] and source_size[1]:
        return int(source_size[0]), int(source_size[1])
    return dimensions(await _download(image_url))


async def _fit_mask_to_image(mask_url: Optional[str], source_size: tuple[int, int]) -> Optional[str]:
    """Make a mask match its image, re-uploading only if it did not already.

    A mask whose dimensions differ from the image is a SILENT total failure:
    LaMa reports `succeeded` and returns a NULL output, with no error of its own
    (verified against the live model). flux-fill misplaces the edit for the same
    reason.

    Every mask path can produce a mismatch, which is why this sits here at the
    point of use rather than at any one source:
      - a PAINTED mask is sized from the canvas, i.e. the image's DISPLAYED size
        in CSS pixels (EditCanvas sets canvas.width from getBoundingClientRect),
        so a 1024px photo shown at 620px yields a 620px mask;
      - a CONFIRMED mask is whatever the client sent back;
      - a DERIVED mask comes from a supplier that may have resized it.

    NEAREST, not LANCZOS: interpolation would introduce grey values, and these
    models expect a binary mask.
    """
    if not mask_url:
        return mask_url
    data = await _download(mask_url)
    if dimensions(data) == source_size:
        return mask_url
    mask = PILImage.open(io.BytesIO(data)).convert("L").resize(source_size, PILImage.NEAREST)
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    buf.seek(0)
    return await upload_bytes(buf.read(), f"masks/{uuid.uuid4().hex}.png", "image/png")


async def _lama_erase(image_url: str, mask_url: Optional[str],
                      source_size: Optional[tuple[int, int]] = None) -> dict:
    """Reconstruct whatever the mask covers from surrounding context.

    No prompt is sent because LaMa has no prompt input -- that is precisely why
    it is used here. See _MODEL_LAMA for what this replaced and why.
    """
    if not mask_url:
        return {"ok": False, "error": "No mask provided."}
    try:
        # trust_hint=False when a mask is involved: it is about to be resized to
        # this, and a stale database size makes that a silent total failure.
        src_size = await _source_dimensions(image_url, source_size, trust_hint=not mask_url)
        mask_url = await _fit_mask_to_image(mask_url, src_size)
        try:
            output = await _replicate_run(
                _MODEL_LAMA,
                {"image": image_url, "mask": mask_url},
                version=_LAMA_VERSION,
            )
        except RuntimeError as e:
            # LaMa reports `succeeded` with a NULL output for inputs it cannot
            # use, and says nothing about why. Size mismatch is the known cause
            # and is fixed above, so a recurrence means something else -- report
            # what it was actually given rather than leaving it to guesswork.
            if "no output" not in str(e):
                raise
            mask_desc = "none"
            if mask_url:
                try:
                    mask_bytes = await _download(mask_url)
                    m = PILImage.open(io.BytesIO(mask_bytes))
                    white = sum(1 for p in m.convert("L").getdata() if p > 127)
                    mask_desc = (f"{m.size[0]}x{m.size[1]} {m.mode}, "
                                 f"{white} white px, {len(mask_bytes)} bytes")
                except Exception:  # noqa: BLE001
                    mask_desc = "unreadable"
            raise RuntimeError(
                f"{e} [image {src_size[0]}x{src_size[1]}, mask {mask_desc}]"
            ) from e
        stored = await finalize(output, source_size=src_size)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def remove_object(image_url: str, mask_url: Optional[str] = None,
                        source_size: Optional[tuple[int, int]] = None) -> dict:
    return await _lama_erase(image_url, mask_url, source_size)


# smart_erase and remove_object are the same intent -- reconstruct what is under
# the mask -- so they share one implementation. Both names are kept because the
# planner vocabulary and the UI reference them.
async def smart_erase(image_url: str, mask_url: Optional[str] = None,
                      source_size: Optional[tuple[int, int]] = None) -> dict:
    return await _lama_erase(image_url, mask_url, source_size)


async def insert_object(image_url: str, prompt: str, mask_url: Optional[str] = None,
                             source_size: Optional[tuple[int, int]] = None) -> dict:
    return await _flux_fill(image_url, prompt, mask_url, source_size)


async def generative_fill(image_url: str, prompt: str, mask_url: Optional[str] = None,
                               source_size: Optional[tuple[int, int]] = None) -> dict:
    return await _flux_fill(image_url, prompt, mask_url, source_size)


async def generate_shadow(image_url: str, direction: str = "bottom",
                          source_size: Optional[tuple[int, int]] = None) -> dict:
    try:
        src_size = await _source_dimensions(image_url, source_size)
        offset_x, offset_y = _SHADOW_OFFSETS.get(direction, _SHADOW_OFFSETS["bottom"])
        output = await _replicate_run(
            _MODEL_SHADOW,
            {
                "image": image_url,
                "shadow_type": "regular",
                "shadow_offset_x": offset_x,
                "shadow_offset_y": offset_y,
                # Keep transparency on a cutout instead of flattening it onto the
                # model's default white background.
                "preserve_alpha": True,
            },
            version=_SHADOW_VERSION,
        )
        # VERIFIED with a real prediction: this model EXTENDS the canvas to make
        # room for the shadow (512x384 in -> 592x494 out), so parity is wrong
        # here by design. Asserting PRESERVE failed every call.
        stored = await finalize(output, source_size=src_size,
                                policy=ResolutionPolicy.ALLOW_CHANGE)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def relight_image(image_url: str, direction: str = "top", intensity: float = 1.0,
                        source_size: Optional[tuple[int, int]] = None) -> dict:
    """Relight via ic-light.

    `intensity` is accepted for call-compatibility but NOT sent: ic-light's
    schema has no multiplier/intensity field. The old payload sent one anyway,
    along with `image` instead of the required `subject_image` -- so even once
    the missing version was supplied the call would have 422'd. Field names
    verified against the model's live schema.
    """
    try:
        src_w, src_h = await _source_dimensions(image_url, source_size)
        w, h = _clamp_to_ic_light_dims(src_w, src_h)
        light_prompt = _RELIGHT_PROMPTS.get(direction, f"light from {direction}")
        output = await _replicate_run(
            _MODEL_IC_LIGHT,
            {
                "subject_image": image_url,
                "prompt": light_prompt,
                "light_source": _IC_LIGHT_SOURCES.get(direction, "None"),
                "width": w,
                "height": h,
            },
            version=_IC_LIGHT_VERSION,
        )
        policy = (ResolutionPolicy.PRESERVE if (w, h) == (src_w, src_h)
                  else ResolutionPolicy.UPSCALE)
        stored = await finalize(output, source_size=(src_w, src_h), policy=policy)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def restore_face(image_url: str, fidelity: float = 0.7,
                       source_size: Optional[tuple[int, int]] = None) -> dict:
    try:
        src_size = await _source_dimensions(image_url, source_size)
        output = await _replicate_run(
            _MODEL_CODEFORMER,
            {
                "image": image_url,
                "codeformer_fidelity": fidelity,
                # codeformer's `upscale` DEFAULTS TO 2, so leaving it unset
                # returned a 2x image and the PRESERVE assertion rejected every
                # call. This operation restores a face; it does not resize.
                # Enlarging is what `upscale` is for.
                "upscale": 1,
            },
            version=_CODEFORMER_VERSION,
        )
        stored = await finalize(output, source_size=src_size)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def upscale_image(image_url: str, scale: int = 2,
                        source_size: Optional[tuple[int, int]] = None) -> dict:
    """Upscaling exists to CHANGE the size, so parity must not be asserted."""
    try:
        src_size = await _source_dimensions(image_url, source_size)
        output = await _replicate_run(_MODEL_REAL_ESRGAN, {"image": image_url, "scale": scale})
        stored = await finalize(output, source_size=src_size,
                                policy=ResolutionPolicy.ALLOW_CHANGE)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
