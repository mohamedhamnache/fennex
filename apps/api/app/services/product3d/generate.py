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
because Trellis is image-conditioned, not text-conditioned. The design spec
nonetheless requires every AI Studio tool to route its instructions through
PromptBuilder rather than inlining ad hoc text, so `PromptBuilder.build_product_3d`
is still called here and its `system_prompt`/`prompt`/`negative_prompt` are
still forwarded on the Replicate call (Cog's generated Input models are
pydantic and ignore unrecognized fields by default, so this is expected to be
a no-op against the real API rather than a validation error -- but this could
not be confirmed against the model's live OpenAPI schema in this environment,
see task-5-report.md). If a real run ever 422s on these keys, drop them here;
`PromptResult` continues to be threaded through for provenance/logging either
way.
"""
import logging

import httpx

from app.services.editing_service import _replicate_run
from app.services.prompting import Product3DSpec, PromptBuilder

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


async def generate_glb(source_image_url: str, quality: str, texture_resolution: str) -> bytes:
    """Run Trellis on `source_image_url` and return the resulting GLB bytes.

    Exactly one Replicate prediction is issued per call -- callers must not
    invoke this once per requested output format; GLB is Trellis's native
    output, OBJ (and any future format) is a local conversion of these same
    bytes, done elsewhere.
    """
    prompt_result = PromptBuilder.build_product_3d(
        Product3DSpec(
            quality=quality,
            texture_resolution=texture_resolution,
            product_description="",
        )
    )

    steps = _SAMPLING_STEPS.get(quality, 12)
    output_url = await _replicate_run(
        TRELLIS_MODEL,
        {
            "image": source_image_url,
            "texture_size": _TEXTURE_SIZE.get(texture_resolution, 1024),
            "ss_sampling_steps": steps,
            "slat_sampling_steps": steps,
            # See module docstring: Trellis's documented schema has no text
            # input, but PromptBuilder's output is forwarded per the design
            # spec's "never inline prompt text" rule regardless.
            "prompt": prompt_result.system_prompt,
            "negative_prompt": prompt_result.negative_prompt,
        },
    )
    return await _download(output_url)
