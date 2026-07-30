"""Image editing operations — Pillow (basic), Remove.bg, Replicate (AI/Advanced)."""
import asyncio
import base64
import io
import logging
import time
import uuid
from typing import Mapping, Optional
import httpx
from PIL import Image as PILImage, ImageEnhance, ImageFilter, ImageOps
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
from app.services.image_output import (  # noqa: E402
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


async def _upload_result(img: PILImage.Image, folder: str = "edits") -> str:
    """Always lossless. The old JPEG-at-quality-95 branch silently degraded every
    non-RGBA result -- which, once _open stopped forcing RGBA, is most of them."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return await upload_bytes(buf.read(), f"{folder}/{uuid.uuid4().hex}.png", "image/png")


def _open(data: bytes) -> PILImage.Image:
    """Preserve the source colour mode.

    Forcing RGBA here turned every RGB photo into a bloated RGBA PNG for no
    quality gain. Operations that genuinely need an alpha channel convert
    explicitly at their own call site.
    """
    return PILImage.open(io.BytesIO(data))


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


# ── Basic ops (Pillow) ────────────────────────────────────────────────────────

async def crop_image(image_url: str, x: int, y: int, w: int, h: int) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        cropped = img.crop((x, y, x + w, y + h))
        url = await _upload_result(cropped)
        return {"ok": True, "image_url": url}
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
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
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
        url = await _upload_result(rotated)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def flip_image(image_url: str, direction: str = "horizontal") -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        img = ImageOps.mirror(img) if direction == "horizontal" else ImageOps.flip(img)
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
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
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
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
        url = await _upload_result(result)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def denoise_image(image_url: str, strength: float = 0.5) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        passes = max(1, round(strength * 5))
        for _ in range(passes):
            img = img.filter(ImageFilter.MedianFilter(size=3))
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def sharpen_image(image_url: str, strength: float = 0.5) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        factor = 1.0 + strength * 3
        img = ImageEnhance.Sharpness(img).enhance(factor)
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Remove.bg ─────────────────────────────────────────────────────────────────


async def _removebg_cutout(image_url: str) -> PILImage.Image:
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
    return PILImage.open(io.BytesIO(resp.content)).convert("RGBA")


async def remove_background(image_url: str) -> dict:
    """Background removal via Remove.bg API."""
    try:
        img = await _removebg_cutout(image_url)
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
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
                            )
                except Exception:  # noqa: BLE001
                    logger.warning("replicate usage metering failed", exc_info=True)

                if isinstance(output, list):
                    return output[0]
                if isinstance(output, Mapping):
                    return output
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


async def _flux_fill(image_url: str, prompt: str, mask_url: Optional[str]) -> dict:
    """Shared body for the three GENERATIVE mask operations.

    These genuinely want new content, so flux-fill and its high default guidance
    are correct here -- unlike removal, which must never be prompted. See
    _MODEL_LAMA.

    output_format is pinned to png: the model defaults to jpg, so every result
    was arriving already lossy before we stored it.
    """
    try:
        src_size = dimensions(await _download(image_url))
        output = await _replicate_run(_MODEL_FLUX_FILL, {
            "image": image_url, "mask": mask_url, "prompt": prompt,
            "output_format": "png",
        })
        return {"ok": True, "image_url": await finalize(output, source_size=src_size)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def replace_background(image_url: str, prompt: str, mask_url: Optional[str] = None) -> dict:
    return await _flux_fill(image_url, prompt, mask_url)


async def _lama_erase(image_url: str, mask_url: Optional[str]) -> dict:
    """Reconstruct whatever the mask covers from surrounding context.

    No prompt is sent because LaMa has no prompt input -- that is precisely why
    it is used here. See _MODEL_LAMA for what this replaced and why.
    """
    if not mask_url:
        return {"ok": False, "error": "No mask provided."}
    try:
        src_size = dimensions(await _download(image_url))
        output = await _replicate_run(
            _MODEL_LAMA,
            {"image": image_url, "mask": mask_url},
            version=_LAMA_VERSION,
        )
        return {"ok": True, "image_url": await finalize(output, source_size=src_size)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def remove_object(image_url: str, mask_url: Optional[str] = None) -> dict:
    return await _lama_erase(image_url, mask_url)


# smart_erase and remove_object are the same intent -- reconstruct what is under
# the mask -- so they share one implementation. Both names are kept because the
# planner vocabulary and the UI reference them.
async def smart_erase(image_url: str, mask_url: Optional[str] = None) -> dict:
    return await _lama_erase(image_url, mask_url)


async def insert_object(image_url: str, prompt: str, mask_url: Optional[str] = None) -> dict:
    return await _flux_fill(image_url, prompt, mask_url)


async def generative_fill(image_url: str, prompt: str, mask_url: Optional[str] = None) -> dict:
    return await _flux_fill(image_url, prompt, mask_url)


async def generate_shadow(image_url: str, direction: str = "bottom") -> dict:
    try:
        src_size = dimensions(await _download(image_url))
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
        return {"ok": True, "image_url": await finalize(output, source_size=src_size)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def relight_image(image_url: str, direction: str = "top", intensity: float = 1.0) -> dict:
    """Relight via ic-light.

    `intensity` is accepted for call-compatibility but NOT sent: ic-light's
    schema has no multiplier/intensity field. The old payload sent one anyway,
    along with `image` instead of the required `subject_image` -- so even once
    the missing version was supplied the call would have 422'd. Field names
    verified against the model's live schema.
    """
    try:
        src_w, src_h = dimensions(await _download(image_url))
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
        return {"ok": True, "image_url": await finalize(
            output, source_size=(src_w, src_h), policy=policy)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def restore_face(image_url: str, fidelity: float = 0.7) -> dict:
    try:
        src_size = dimensions(await _download(image_url))
        output = await _replicate_run(
            _MODEL_CODEFORMER,
            {"image": image_url, "codeformer_fidelity": fidelity},
            version=_CODEFORMER_VERSION,
        )
        return {"ok": True, "image_url": await finalize(output, source_size=src_size)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def upscale_image(image_url: str, scale: int = 2) -> dict:
    """Upscaling exists to CHANGE the size, so parity must not be asserted."""
    try:
        src_size = dimensions(await _download(image_url))
        output = await _replicate_run(_MODEL_REAL_ESRGAN, {"image": image_url, "scale": scale})
        return {"ok": True, "image_url": await finalize(
            output, source_size=src_size, policy=ResolutionPolicy.ALLOW_CHANGE)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
