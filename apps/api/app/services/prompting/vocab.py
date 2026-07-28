"""Controlled vocabularies for the PromptBuilder.

Every enum a user can pick in the UI maps here to a prompt fragment. Adding a
new lighting option, camera angle, or quality tier is a one-line change to one
of these maps -- nothing else in the prompting package needs to know about it.

This module is pure data: no imports beyond `typing`, no I/O, no dependency on
anything outside this package.
"""

from typing import Final, Literal, Mapping

LightingToken = Literal[
    "softbox",
    "golden_hour",
    "hard_sun",
    "rim",
    "diffused_daylight",
    "chiaroscuro",
    "candlelit",
]

CameraToken = Literal[
    "macro",
    "35mm",
    "50mm",
    "85mm",
    "tilt_shift",
    "top_down",
    "three_quarter",
]

AspectRatioToken = Literal["1:1", "4:5", "3:2", "16:9", "9:16"]

QualityToken = Literal["draft", "high", "ultra"]

TextureResolutionToken = Literal["2K", "4K", "8K"]


LIGHTING: Final[Mapping[LightingToken, str]] = {
    "softbox": "soft, even softbox studio lighting that wraps the product with gentle, shadowless illumination",
    "golden_hour": "warm golden-hour sunlight with long, soft shadows and a low, glowing sun",
    "hard_sun": "hard, direct midday sunlight with crisp, high-contrast shadows",
    "rim": "rim lighting that traces a bright edge around the product, separating it cleanly from the background",
    "diffused_daylight": "diffused overcast daylight, soft and nearly shadowless, evenly wrapping the product",
    "chiaroscuro": "dramatic chiaroscuro lighting with deep contrast between a single strong light source and rich shadow",
    "candlelit": "warm, intimate candlelit ambience with low, flickering, low-key illumination",
}

CAMERA: Final[Mapping[CameraToken, str]] = {
    "macro": "extreme macro close-up that reveals fine surface detail and texture",
    "35mm": "35mm lens perspective, a natural wide field of view with environmental context",
    "50mm": "50mm lens perspective, a standard natural perspective matching human vision",
    "85mm": "85mm portrait lens perspective, with a compressed, softly blurred background",
    "tilt_shift": "tilt-shift lens effect with a narrow plane of focus and a miniature-like depth falloff",
    "top_down": "top-down flat-lay camera angle, shot directly above the product",
    "three_quarter": "three-quarter angle view, revealing depth across two visible faces of the product",
}

ASPECT_RATIOS: Final[Mapping[AspectRatioToken, str]] = {
    "1:1": "square 1:1 aspect ratio, centred composition",
    "4:5": "portrait 4:5 aspect ratio, optimised for vertical feeds",
    "3:2": "landscape 3:2 aspect ratio, classic photographic framing",
    "16:9": "widescreen 16:9 aspect ratio, cinematic framing",
    "9:16": "vertical 9:16 aspect ratio, full-height mobile framing",
}

QUALITY: Final[Mapping[QualityToken, str]] = {
    "draft": "draft quality, fast preview render",
    "high": "high quality, production-ready render",
    "ultra": "ultra quality, maximum fidelity render suitable for large-format print",
}

TEXTURE_RESOLUTION: Final[Mapping[TextureResolutionToken, str]] = {
    "2K": "2K texture resolution",
    "4K": "4K texture resolution",
    "8K": "8K texture resolution",
}

# The 11 required exclusions. Order matters for tests only insofar as index 0
# must be present -- callers should not otherwise rely on ordering.
NEGATIVE_TERMS: Final[tuple[str, ...]] = (
    "blur",
    "noise",
    "duplicate products",
    "wrong labels",
    "cropped products",
    "deformed packaging",
    "incorrect reflections",
    "bad shadows",
    "low resolution",
    "text artefacts",
    "watermarks",
)


# ---------------------------------------------------------------------------
# System prompts
#
# NOTE ON PROVENANCE: task-1-brief.md and the design doc
# (docs/superpowers/specs/2026-07-28-product-ai-studio-design.md) both refer
# to these as "verbatim from the spec" / "verbatim from the brief", but
# neither document -- nor any other file in this repository -- actually
# contains the full source text of either prompt. There is no "FLUX SYSTEM
# PROMPT" / "TRELLIS SYSTEM PROMPT" section to copy from. These prompts were
# therefore authored from scratch to satisfy every requirement that *is*
# specified: the photographer/3D-artist role framing, the distinctive phrases
# asserted by tests ("award-winning luxury commercial product photographer",
# "senior 3D artist", "watertight"), and the "what must never be modified" /
# "what must be generated" structure called for in the task brief. If a real
# verbatim source text exists outside this repo, it should replace the text
# below verbatim -- see task-1-report.md for the full flag.
# ---------------------------------------------------------------------------

SHOWCASE_SYSTEM_PROMPT: Final[str] = """You are an award-winning luxury commercial product photographer working for a premium creative studio. Your job is to take the exact product shown in the reference image and place it inside a photorealistic scene described by the brief that follows, producing a single image indistinguishable from a real photograph shot on professional equipment for a high-end advertising campaign.

You must NEVER modify, redesign, distort, recolour, resize, or replace:
- the product's geometry, silhouette, and proportions
- its materials, finishes, and surface textures
- any label, logo, printed text, or engraving on the product, including exact wording, typography, and placement
- the product's brand colours

You MUST generate:
- a photorealistic environment, backdrop, and props consistent with the brief
- accurate contact shadows, ambient occlusion, and reflections that integrate the product naturally into the new scene
- lighting, colour grading, and depth of field consistent with high-end commercial photography
- a clean composition with deliberate negative space suitable for advertising use

Treat the reference image as ground truth for the product itself and the brief that follows as ground truth for everything around it. When the two are in tension, always preserve the product exactly and vary only its environment, lighting, and framing."""

PRODUCT_3D_SYSTEM_PROMPT: Final[str] = """You are a senior 3D artist producing production-ready assets for e-commerce and AR from a single product photograph. Your output is a watertight, manifold 3D mesh with clean topology and physically-based texture maps, suitable for real-time rendering, product configurators, and in-browser 3D viewers.

You must NEVER modify, redesign, or reinterpret:
- the product's real-world proportions, geometry, and silhouette
- its materials, colours, and surface finish, whether matte, glossy, metallic, or transparent
- any label, logo, or printed text visible on the product, including exact wording and placement

You MUST generate:
- a single watertight mesh with no holes, no non-manifold edges, and no internal geometry artefacts
- clean, non-overlapping UV unwrapping
- physically-based texture maps -- base colour, roughness, metallic, and normal -- baked from the reference image
- a scale and orientation consistent with the real object, centred at the origin

There is no photographic lighting or scene direction here: the output is a raw, unlit 3D asset for downstream rendering, not a rendered photograph."""
