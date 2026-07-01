"""Image editing operations — Pillow (basic), Remove.bg, Replicate (AI/Advanced)."""
import asyncio
import base64
import io
import time
import uuid
import httpx
from PIL import Image as PILImage, ImageEnhance, ImageFilter, ImageOps
from app.core.config import settings
from app.core.storage import upload_bytes


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _download(url: str) -> bytes:
    if url.startswith("data:"):
        # data URI — decode inline (used when S3 is not configured, or gpt-image-1 b64 output)
        _, encoded = url.split(",", 1)
        return base64.b64decode(encoded)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


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


async def adjust_image(image_url: str, brightness: float = 0, contrast: float = 0) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        if brightness != 0:
            factor = 1.0 + brightness / 100.0
            img = ImageEnhance.Brightness(img).enhance(max(0.0, factor))
        if contrast != 0:
            factor = 1.0 + contrast / 100.0
            img = ImageEnhance.Contrast(img).enhance(max(0.0, factor))
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


async def _replicate_run(model: str, input_params: dict) -> str:
    """Create a Replicate prediction and poll until succeeded. Returns output URL."""
    headers = {"Authorization": f"Token {settings.REPLICATE_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as client:
        create_resp = await client.post(
            f"{_REPLICATE_API}/predictions",
            json={"version": model, "input": input_params},
            headers=headers,
        )
        create_resp.raise_for_status()
        prediction = create_resp.json()
        pred_id = prediction["id"]
        poll_url = prediction.get("urls", {}).get("get") or f"{_REPLICATE_API}/predictions/{pred_id}"

        deadline = time.monotonic() + _POLL_TIMEOUT
        while time.monotonic() < deadline:
            await asyncio.sleep(_POLL_INTERVAL)
            poll_resp = await client.get(poll_url, headers=headers)
            poll_resp.raise_for_status()
            status_data = poll_resp.json()
            status = status_data.get("status")
            if status == "succeeded":
                output = status_data.get("output")
                if isinstance(output, list):
                    return output[0]
                return str(output)
            if status in ("failed", "canceled"):
                raise RuntimeError(f"Replicate prediction {pred_id} {status}: {status_data.get('error')}")

        raise TimeoutError(f"Replicate prediction {pred_id} timed out after {_POLL_TIMEOUT}s")


async def _download_and_upload_url(url: str) -> str:
    """Download a result URL and re-upload to our own storage."""
    data = await _download(url)
    img = PILImage.open(io.BytesIO(data)).convert("RGBA")
    return await _upload_result(img)


_MODEL_FLUX_FILL = "black-forest-labs/flux-fill-pro"
_MODEL_REMOVE_OBJECT = "zylim0702/remove-object"
_MODEL_SD_INPAINT = "stability-ai/stable-diffusion-inpainting"
_MODEL_SHADOW = "fal-ai/shadow-generation"
_MODEL_IC_LIGHT = "zsxkib/ic-light"
_MODEL_CODEFORMER = "sczhou/codeformer"
_MODEL_REAL_ESRGAN = "nightmareai/real-esrgan"


async def replace_background(image_url: str, mask_url: str, prompt: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_FLUX_FILL, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def remove_object(image_url: str, mask_url: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_REMOVE_OBJECT, {"image": image_url, "mask": mask_url})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def insert_object(image_url: str, mask_url: str, prompt: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_SD_INPAINT, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def generative_fill(image_url: str, mask_url: str, prompt: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_FLUX_FILL, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def smart_erase(image_url: str, mask_url: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_REMOVE_OBJECT, {"image": image_url, "mask": mask_url})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def generate_shadow(image_url: str, direction: str = "bottom") -> dict:
    try:
        output = await _replicate_run(_MODEL_SHADOW, {"image": image_url, "shadow_direction": direction})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def relight_image(image_url: str, direction: str = "top", intensity: float = 1.0) -> dict:
    try:
        output = await _replicate_run(_MODEL_IC_LIGHT, {"image": image_url, "light_direction": direction, "light_intensity": intensity})
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
