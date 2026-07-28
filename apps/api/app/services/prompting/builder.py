"""PromptBuilder: composes pure modules into a PromptResult.

Three pipelines share one builder: Product Showcase (flux-kontext-pro),
Product to 3D (Trellis), and the existing image tools (article covers,
social posts, brand assets). Each pipeline calls its modules in a fixed
order, drops the `None`s, joins what is left with ". ", and records which
modules actually contributed in `PromptResult.modules_used`.

This package is pure: it takes typed inputs and returns strings. It must not
import routers, models, or other services.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import modules, vocab
from .modules import BrandKitLike


@dataclass(frozen=True)
class PromptResult:
    prompt: str
    negative_prompt: str
    system_prompt: str | None
    modules_used: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ShowcaseSpec:
    scene_id: str
    lighting: vocab.LightingToken
    camera: vocab.CameraToken
    aspect_ratio: vocab.AspectRatioToken
    creativity: int
    product_preservation: int
    user_prompt: str
    negative_prompt: str
    seed: int | None
    quality: vocab.QualityToken
    product_description: str


@dataclass(frozen=True)
class Product3DSpec:
    quality: vocab.QualityToken
    texture_resolution: vocab.TextureResolutionToken
    product_description: str
    negative_prompt: str = ""


@dataclass(frozen=True)
class ImageSpec:
    """Spec for the existing image tools (article covers, social posts,
    brand assets) once they delegate to PromptBuilder.build_image."""

    title: str
    usage: str
    style: str
    keyword: str | None = None
    user_prompt: str = ""
    negative_prompt: str = ""


def _assemble(fragments: list[tuple[str, str | None]]) -> tuple[str, tuple[str, ...]]:
    """Drop the Nones, join the rest with '. ', and record provenance."""
    used = [(name, frag) for name, frag in fragments if frag is not None and frag != ""]
    prompt = ". ".join(frag for _, frag in used)
    names = tuple(name for name, _ in used)
    return prompt, names


class PromptBuilder:
    @staticmethod
    def build_negative_prompt(extra: str | None = None) -> str:
        return modules.negative_prompt(extra)

    @staticmethod
    def build_product_showcase(spec: ShowcaseSpec, brand_kit: BrandKitLike | None) -> PromptResult:
        fragments: list[tuple[str, str | None]] = [
            ("role", modules.role("award-winning luxury commercial product photographer")),
            (
                "objective",
                modules.objective(
                    "place the exact product from the reference image into the described scene"
                ),
            ),
            ("product_preservation", modules.product_preservation(spec.product_preservation)),
            ("composition", modules.composition(spec.aspect_ratio)),
            ("lighting", modules.lighting(spec.lighting)),
            ("camera", modules.camera(spec.camera)),
            ("materials", modules.materials(spec.product_description)),
            ("environment", modules.environment(spec.scene_id)),
            ("rendering_style", modules.rendering_style(spec.creativity)),
            ("brand_style", modules.brand_style(brand_kit)),
            ("quality", modules.quality(spec.quality)),
            ("user_intent", modules.user_intent(spec.user_prompt)),
        ]
        prompt, used = _assemble(fragments)
        negative = PromptBuilder.build_negative_prompt(spec.negative_prompt)
        return PromptResult(
            prompt=prompt,
            negative_prompt=negative,
            system_prompt=vocab.SHOWCASE_SYSTEM_PROMPT,
            modules_used=used,
        )

    @staticmethod
    def build_product_3d(spec: Product3DSpec) -> PromptResult:
        fragments: list[tuple[str, str | None]] = [
            ("role", modules.role("senior 3D artist")),
            (
                "objective",
                modules.objective(
                    "reconstruct the exact product from the reference image as a watertight 3D asset"
                ),
            ),
            ("product_preservation", modules.product_preservation(100)),
            ("materials", modules.materials(spec.product_description)),
            ("texture_resolution", modules.texture_resolution(spec.texture_resolution)),
            ("quality", modules.quality(spec.quality)),
        ]
        prompt, used = _assemble(fragments)
        negative = PromptBuilder.build_negative_prompt(spec.negative_prompt)
        return PromptResult(
            prompt=prompt,
            negative_prompt=negative,
            system_prompt=vocab.PRODUCT_3D_SYSTEM_PROMPT,
            modules_used=used,
        )

    @staticmethod
    def build_image(spec: ImageSpec, brand_kit: BrandKitLike | None) -> PromptResult:
        fragments: list[tuple[str, str | None]] = [
            ("role", modules.role("professional commercial image generator")),
            ("objective", modules.objective(f"produce a {spec.usage.replace('_', ' ')} for '{spec.title}'")),
            ("materials", modules.materials(spec.keyword or "")),
            ("rendering_style", modules.objective(f"Style: {spec.style}")),
            ("brand_style", modules.brand_style(brand_kit)),
            ("user_intent", modules.user_intent(spec.user_prompt)),
        ]
        prompt, used = _assemble(fragments)
        negative = PromptBuilder.build_negative_prompt(spec.negative_prompt)
        return PromptResult(
            prompt=prompt,
            negative_prompt=negative,
            system_prompt=None,
            modules_used=used,
        )
