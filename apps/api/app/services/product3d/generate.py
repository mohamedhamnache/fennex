"""Trellis image-to-3D generation via Replicate.

Reuses `editing_service._replicate_run` as the SOLE Replicate chokepoint --
it already meters every prediction into usage_events / ai_cost_micros /
ai_credits_used, applies the 10-credit Replicate floor, and (via the ambient
`metering_context`) skips billing when there is no attributed org. This
module never talks to Replicate directly and does not implement a second
HTTP client.

Model choice -- verified against replicate.com, not assumed (task-5 brief
instruction): `firtoz/trellis` is a community Replicate deployment of
Microsoft's TRELLIS-image-large (1.2B params, trained on 500K 3D objects).
Confirmed live 2026-07-29 via replicate.com/firtoz/trellis and
replicate.com/firtoz/trellis/readme: takes a single product image, returns a
textured GLB mesh plus preview renders, runs on an A100 in ~25s, listed at
$0.035/run. It has an active hot-deployment endpoint, so `_replicate_run` is
called without a pinned `version` hash (same calling convention as
flux-fill-pro). Alternatives seen in replicate.com/collections/3d-models
(tencent/hunyuan-3d-3.1, fishwowater/trellis2, hyper3d/rodin) were not chosen:
firtoz/trellis is the most established single-image Trellis deployment and is
the one the task brief named as the likely candidate.

Trellis's documented input schema (per its Replicate readme) is: image, seed,
texture_size, mesh_simplify, generate_color, generate_model, generate_normal,
randomize_seed, ss_sampling_steps, slat_sampling_steps, ss_guidance_strength,
slat_guidance_strength -- no `prompt`/`negative_prompt` field is documented,
because Trellis is image-conditioned, not text-conditioned.

Fix-round-1 (Fix 4): a prior version of this module forwarded
`PromptBuilder.build_product_3d(...)`'s `system_prompt`/`negative_prompt` to
Replicate anyway, on the theory that Cog's generated pydantic Input models
silently ignore unrecognized fields. That was never verified against
Trellis's live OpenAPI schema, and Replicate's `predictions` endpoint is not
guaranteed to ignore unknown inputs across every model -- if it validates
strictly, every prediction would 422. Since Trellis genuinely takes no text
input at all, `PromptBuilder.build_product_3d` is no longer called here:
there is no "provenance" value in computing a prompt/negative_prompt pair
that is never sent, logged, or otherwise read by anything, and keeping the
call around invited exactly this bug (undocumented keys silently forwarded).
If Trellis ever grows a text-conditioning input, reintroduce the call at
that point together with the specific field it maps to.

Fix-round-1 (Fix 3): `firtoz/trellis` returns an OBJECT (keys include
`model_file`, `color_video`, `gaussian_ply`), not a bare URL string. Passing
that object through `_replicate_run`'s old str()-only fallback produced a
Python dict-repr string that `_download` could never fetch, so every
Product-to-3D job failed after Replicate had already billed a successful
prediction. `_replicate_run` now returns the mapping as-is instead of
stringifying it (see its docstring); `_extract_glb_url` below resolves the
actual GLB url from either shape.
"""
import logging
from typing import Mapping

import httpx

from app.services.editing_service import _replicate_run

logger = logging.getLogger(__name__)

TRELLIS_MODEL = "firtoz/trellis"

# Texture resolution token (app.services.prompting.vocab.TextureResolutionToken)
# -> Trellis's texture_size pixel dimension.
_TEXTURE_SIZE = {"2K": 1024, "4K": 2048, "8K": 4096}

# Quality token (app.services.prompting.vocab.QualityToken) -> Trellis sampling
# steps. 12/12 is Trellis's own published default (~"high"); draft halves it
# for a faster/cheaper preview, ultra doubles it for maximum fidelity.
_SAMPLING_STEPS = {"draft": 6, "high": 12, "ultra": 24}

_DOWNLOAD_TIMEOUT = 120


async def _download(url: str) -> bytes:
    # data: URI passthrough mirrors editing_service._download -- lets a
    # stubbed _replicate_run in tests return an inline payload with zero
    # network calls, and is a legitimate fallback in prod too (upload_bytes
    # itself falls back to data: URLs when S3 is not configured).
    if url.startswith("data:"):
        import base64
        _, encoded = url.split(",", 1)
        return base64.b64decode(encoded)

    async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


def _extract_glb_url(output: str | Mapping) -> str:
    """Resolve the GLB download url from a Trellis prediction's output.

    `firtoz/trellis` returns an object (`model_file`, `color_video`,
    `gaussian_ply`), not a bare url -- `output["model_file"]` is the GLB.
    `_replicate_run` returns that mapping as-is (see its docstring) rather
    than stringifying it. Falls back to treating `output` as the url
    directly when it is already a string, which is every other model's
    shape and Trellis's own shape prior to this fix, so existing callers
    and tests that stub a plain string keep working unchanged.
    """
    if isinstance(output, Mapping):
        return output["model_file"]
    return output


async def generate_glb(source_image_url: str, quality: str, texture_resolution: str) -> bytes:
    """Run Trellis on `source_image_url` and return the resulting GLB bytes.

    Exactly one Replicate prediction is issued per call -- callers must not
    invoke this once per requested output format; GLB is Trellis's native
    output, OBJ (and any future format) is a local conversion of these same
    bytes, done elsewhere.
    """
    steps = _SAMPLING_STEPS.get(quality, 12)
    output = await _replicate_run(
        TRELLIS_MODEL,
        {
            "image": source_image_url,
            "texture_size": _TEXTURE_SIZE.get(texture_resolution, 1024),
            "ss_sampling_steps": steps,
            "slat_sampling_steps": steps,
            # Fix 4 (fix-round-1): only Trellis's documented inputs are sent
            # -- see the module docstring. No `prompt`/`negative_prompt`:
            # Trellis is image-conditioned and does not accept text.
        },
    )
    return await _download(_extract_glb_url(output))
