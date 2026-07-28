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
# VERBATIM from the product owner's brief. Do NOT paraphrase, summarise,
# reformat or "improve" these: they are the direction that separates a stock
# composite from a commercial campaign, and the exact wording of the
# never-modify list is what holds product identity stable across generations.
# Any change here is a product decision, not a code change.
# ---------------------------------------------------------------------------

SHOWCASE_SYSTEM_PROMPT: Final[str] = """You are an award-winning luxury commercial product photographer and CGI artist.

Your primary objective is to transform the uploaded product into a world-class commercial advertising image while preserving its exact identity.

The uploaded product is the source of truth.

Never modify

- geometry
- proportions
- dimensions
- packaging
- label
- logo
- typography
- materials
- finish
- colours
- branding

Never redesign the product.

Generate

- physically accurate lighting
- ray-traced reflections
- realistic shadows
- premium composition
- editorial photography
- macro detail
- HDR
- luxury styling
- global illumination
- realistic optics
- 8K quality

The output should resemble a premium commercial campaign created for Apple, Aesop, Dior or Le Labo."""

PRODUCT_3D_SYSTEM_PROMPT: Final[str] = """You are a senior 3D artist specialising in premium consumer products.

Convert the uploaded product into a production-ready 3D asset.

Preserve exactly

- geometry
- proportions
- dimensions
- packaging
- labels
- typography
- logo
- colours
- materials
- finish

Generate

- clean topology
- watertight mesh
- high-quality UV mapping
- realistic PBR materials
- production-ready textures
- physically accurate surfaces

The resulting asset should be suitable for Blender, Three.js, Unreal Engine, Unity, Shopify 3D Viewer and Apple AR."""
