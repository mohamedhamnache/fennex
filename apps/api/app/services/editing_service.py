"""Image editing operations — Pillow (basic), Remove.bg, Replicate (AI/Advanced)."""
import asyncio
import base64
import io
import time
import uuid
from typing import Optional
import httpx
from PIL import Image as PILImage, ImageEnhance, ImageFilter, ImageOps
from app.core.config import settings
from app.core.storage import upload_bytes


# ── Internal helpers ──────────────────────────────────────────────────────────

# Transient network failures worth retrying (e.g. "All connection attempts failed"
# under many parallel requests when generating a whole set at once).
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
        # data URI — decode inline (used when S3 is not configured, or gpt-image-1 b64 output)
        _, encoded = url.split(",", 1)
        return base64.b64decode(encoded)

    async def _do() -> bytes:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content

    return await _retry(_do)


async def _upload_result(img: PILImage.Image, folder: str = "edits") -> str:
    buf = io.BytesIO()
    fmt = "PNG" if img.mode == "RGBA" else "JPEG"
    img.save(buf, format=fmt, quality=95)
    buf.seek(0)
    content_type = "image/png" if fmt == "PNG" else "image/jpeg"
    ext = "png" if fmt == "PNG" else "jpg"
    key = f"{folder}/{uuid.uuid4().hex}.{ext}"
    return await upload_bytes(buf.read(), key, content_type)


def _open(data: bytes) -> PILImage.Image:
    return PILImage.open(io.BytesIO(data)).convert("RGBA")


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
        fill_rgba = _hex_to_rgb(fill_color) + (255,) if fill_color else (0, 0, 0, 0)
        rotated = img.rotate(-angle, expand=True, fillcolor=fill_rgba)
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


async def remove_background(image_url: str) -> dict:
    """Background removal via Remove.bg API."""
    try:
        data = await _download(image_url)
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.remove.bg/v1.0/removebg",
                data={"size": "auto"},
                files={"image_file": ("image.png", data, "image/png")},
                headers={"X-Api-Key": settings.REMOVE_BG_API_KEY},
            )
            resp.raise_for_status()
            result_bytes = resp.content
        img = PILImage.open(io.BytesIO(result_bytes)).convert("RGBA")
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Replicate ─────────────────────────────────────────────────────────────────

_REPLICATE_API = "https://api.replicate.com/v1"
_POLL_INTERVAL = 3
_POLL_TIMEOUT = 300


async def _replicate_run(model: str, input_params: dict, version: Optional[str] = None) -> str:
    """Create a Replicate prediction and poll until succeeded. Returns output URL.

    Without `version`: uses /v1/models/{owner}/{name}/predictions (works for models with
    an active hot deployment, e.g. flux-fill-pro).
    With `version` (SHA256 hash): uses /v1/predictions with {"version": hash, "input": ...}
    which is required for older models that don't have a hot deployment endpoint.
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
        create_resp = await _retry(lambda: client.post(create_url, json=payload, headers=headers))
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
                if isinstance(output, list):
                    return output[0]
                return str(output)
            if status in ("failed", "canceled"):
                raise RuntimeError(f"Replicate prediction {status}: {status_data.get('error')}")

        raise TimeoutError(f"Replicate prediction {pred_id} timed out after {_POLL_TIMEOUT}s")


async def _download_and_upload_url(url: str, resize_to: tuple[int, int] | None = None) -> str:
    """Download a result URL, optionally resize, and re-upload to our own storage."""
    data = await _download(url)
    img = PILImage.open(io.BytesIO(data)).convert("RGBA")
    if resize_to and img.size != resize_to:
        img = img.resize(resize_to, PILImage.LANCZOS)
    return await _upload_result(img)


def _sd_inpaint_size(orig_w: int, orig_h: int) -> tuple[int, int]:
    """Scale to fit within SD 1.5's safe range (max 768), multiples of 8."""
    scale = min(768 / orig_w, 768 / orig_h, 1.0)
    return (int(orig_w * scale // 8 * 8), int(orig_h * scale // 8 * 8))


_MODEL_FLUX_FILL = "black-forest-labs/flux-fill-pro"
# SD inpainting heals from surrounding pixels (no generative hallucination) — used for object removal
# This model requires a pinned version hash (no hot deployment on the model-specific endpoint)
_MODEL_SD_INPAINT = "stability-ai/stable-diffusion-inpainting"
_SD_INPAINT_VERSION = "95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3"
_MODEL_SHADOW = "fal-ai/shadow-generation"
_MODEL_IC_LIGHT = "zsxkib/ic-light"
_MODEL_CODEFORMER = "sczhou/codeformer"
_MODEL_REAL_ESRGAN = "nightmareai/real-esrgan"

_RELIGHT_PROMPTS = {
    "top":    "bright natural light coming from directly above",
    "bottom": "warm ambient light glowing from below",
    "left":   "soft diffused light from the left side",
    "right":  "soft diffused light from the right side",
}


async def replace_background(image_url: str, prompt: str, mask_url: Optional[str] = None) -> dict:
    try:
        output = await _replicate_run(_MODEL_FLUX_FILL, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _analyze_background(image_url: str, openai_key: str) -> str:
    """Ask GPT-4o-mini to describe the background so flux-fill can reproduce it correctly."""
    payload = {
        "model": "gpt-4o-mini",
        "max_tokens": 80,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_url, "detail": "low"}},
                {
                    "type": "text",
                    "text": (
                        "Describe ONLY the background of this image in one short sentence: "
                        "wall color and texture, floor material, room environment. "
                        "Ignore all foreground objects. Be specific about colors and surfaces."
                    ),
                },
            ],
        }],
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return ""


async def remove_object(image_url: str, mask_url: Optional[str] = None, openai_key: Optional[str] = None) -> dict:
    try:
        if openai_key:
            # High-quality path: vision → background description → flux-fill (same size, no artifacts)
            bg_desc = await _analyze_background(image_url, openai_key)
            fill_prompt = bg_desc or "empty background, seamless continuation of surrounding surfaces"
            output = await _replicate_run(
                _MODEL_FLUX_FILL,
                {"image": image_url, "mask": mask_url, "prompt": fill_prompt},
            )
            url = await _download_and_upload_url(output)
        else:
            # Fallback: SD inpainting heals from context without hallucinating replacement objects
            orig_data = await _download(image_url)
            orig_w, orig_h = PILImage.open(io.BytesIO(orig_data)).size
            target_w, target_h = _sd_inpaint_size(orig_w, orig_h)
            output = await _replicate_run(
                _MODEL_SD_INPAINT,
                {"image": image_url, "mask": mask_url, "prompt": "", "num_inference_steps": 50,
                 "width": target_w, "height": target_h},
                version=_SD_INPAINT_VERSION,
            )
            url = await _download_and_upload_url(output, resize_to=(orig_w, orig_h))
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def insert_object(image_url: str, prompt: str, mask_url: Optional[str] = None) -> dict:
    try:
        output = await _replicate_run(_MODEL_FLUX_FILL, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def generative_fill(image_url: str, prompt: str, mask_url: Optional[str] = None) -> dict:
    try:
        output = await _replicate_run(_MODEL_FLUX_FILL, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _pillow_content_fill(image: PILImage.Image, mask: PILImage.Image) -> PILImage.Image:
    """Fill the white-masked area by propagating surrounding background colors inward.

    Initialises the fill area with the scene's dominant colour (extreme blur of whole
    image, so the object's own dark/bright pixels are averaged away).  Then iterative
    Gaussian passes with shrinking radius propagate the actual boundary colours inward.
    """
    from PIL import ImageOps
    rgb = image.convert("RGB")
    inv_mask = ImageOps.invert(mask.convert("L"))  # white = keep, black = fill

    # Dominant scene colour — radius 200 averages ALL pixels; erased object's contribution
    # is tiny compared to walls/floor, so fill area starts at the room's neutral colour
    dominant = rgb.filter(ImageFilter.GaussianBlur(radius=200))
    fill = PILImage.composite(rgb, dominant, inv_mask)  # original outside, dominant inside

    # Phase 1: push actual boundary colours into the centre
    for radius in [40, 20, 10]:
        blurred = fill.filter(ImageFilter.GaussianBlur(radius=radius))
        fill = PILImage.composite(rgb, blurred, inv_mask)

    # Phase 2: refine to match local texture and edge sharpness
    for _ in range(15):
        blurred = fill.filter(ImageFilter.GaussianBlur(radius=3))
        fill = PILImage.composite(rgb, blurred, inv_mask)

    return fill.convert("RGBA")


async def smart_erase(image_url: str, mask_url: Optional[str] = None, openai_key: Optional[str] = None) -> dict:
    # Content-aware fill using Pillow — samples background colors from outside the mask
    # and propagates them inward. No AI model = no hallucination, correct size, instant.
    try:
        orig_data = await _download(image_url)
        orig_img = PILImage.open(io.BytesIO(orig_data))
        orig_w, orig_h = orig_img.size

        if not mask_url:
            return {"ok": False, "error": "No mask provided."}

        mask_data = await _download(mask_url)
        mask_img = PILImage.open(io.BytesIO(mask_data)).convert("L")
        if mask_img.size != (orig_w, orig_h):
            mask_img = mask_img.resize((orig_w, orig_h), PILImage.NEAREST)

        result = _pillow_content_fill(orig_img, mask_img)
        url = await _upload_result(result)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def generate_shadow(image_url: str, direction: str = "bottom") -> dict:
    try:
        output = await _replicate_run(
            _MODEL_SHADOW,
            {"foreground_image": image_url, "shadow_type": "natural_shadow", "shadow_direction": direction},
        )
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def relight_image(image_url: str, direction: str = "top", intensity: float = 1.0) -> dict:
    # ic-light expects a text prompt describing the lighting and a multiplier for intensity
    try:
        light_prompt = _RELIGHT_PROMPTS.get(direction, f"light from {direction}")
        output = await _replicate_run(
            _MODEL_IC_LIGHT,
            {"image": image_url, "prompt": light_prompt, "multiplier": intensity},
        )
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def restore_face(image_url: str, fidelity: float = 0.7) -> dict:
    try:
        output = await _replicate_run(_MODEL_CODEFORMER, {"image": image_url, "codeformer_fidelity": fidelity})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def upscale_image(image_url: str, scale: int = 2) -> dict:
    try:
        output = await _replicate_run(_MODEL_REAL_ESRGAN, {"image": image_url, "scale": scale})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}
