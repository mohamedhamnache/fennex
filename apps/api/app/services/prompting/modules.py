"""Pure prompt modules.

Each function here is a module in the sense the design doc uses the word: a
pure function of typed inputs that returns either a prompt fragment (`str`)
or `None` to mean "I have nothing to say." The builder is responsible for
dropping `None`s and joining the rest -- a module must never return an empty
string, since that would leave a doubled separator in the assembled prompt.

Unknown vocabulary tokens raise `KeyError` (via plain dict indexing) rather
than degrading silently, so a typo'd token fails loudly at the boundary
instead of producing a subtly wrong prompt.

This module has no imports outside `vocab` and the standard library -- it
must stay importable and testable with zero application context.
"""

from __future__ import annotations

from typing import Protocol

from . import vocab


class BrandKitLike(Protocol):
    """Structural type for a brand kit.

    This package must not import `app.models.BrandKit` (that would break its
    purity), so it depends only on the shape it actually reads. Any object
    with these attributes -- including the real ORM model -- satisfies it.
    """

    colors: list[str]
    style_rules: str | None
    tone: str | None


def role(role_name: str) -> str | None:
    """A short restatement of the operator's role for this generation.

    The full role definition lives in the pipeline's system prompt; this
    fragment just keeps the instruction body anchored to it.
    """
    text = role_name.strip()
    if not text:
        return None
    return f"You are acting as a {text}"


def objective(text: str) -> str | None:
    """The single-sentence objective of this generation."""
    stripped = text.strip()
    if not stripped:
        return None
    return f"Objective: {stripped}"


def product_preservation(strength: int) -> str:
    """The non-negotiable product-identity clause, scaled by strength (0-100).

    The identity clause itself (geometry, proportions, label, logo, colours)
    is present at every strength -- only the emphasis changes. This never
    returns None: preservation direction is always owed to the model.
    """
    if not 0 <= strength <= 100:
        raise ValueError(f"product_preservation strength must be 0-100, got {strength}")

    core = (
        "Preserve the product exactly as shown in the reference image: identical "
        "geometry, proportions, materials, and surface textures, with every label, "
        "logo, printed text, and brand colours left unchanged"
    )
    if strength >= 80:
        qualifier = (
            "this is non-negotiable -- treat the product as immutable ground truth "
            "and make zero deviations, however small"
        )
    elif strength >= 50:
        qualifier = (
            "preservation takes priority over stylistic liberties; only minor, "
            "incidental variation from lighting and angle is acceptable"
        )
    else:
        qualifier = (
            "preservation is still the baseline requirement, though the "
            "environment and framing may be interpreted more freely"
        )
    return f"{core} -- {qualifier}"


def composition(aspect_ratio: vocab.AspectRatioToken) -> str:
    """Framing fragment for the requested aspect ratio. Raises KeyError for
    an unknown token."""
    return vocab.ASPECT_RATIOS[aspect_ratio]


def lighting(token: vocab.LightingToken) -> str | None:
    """Lighting fragment for a controlled-vocabulary lighting token. Raises
    KeyError for an unknown token."""
    return vocab.LIGHTING[token]


def camera(token: vocab.CameraToken) -> str | None:
    """Camera/lens fragment for a controlled-vocabulary camera token. Raises
    KeyError for an unknown token."""
    return vocab.CAMERA[token]


def materials(product_description: str) -> str | None:
    """Optional free-text description of the product's materials, passed
    through from the caller. Omitted when there is nothing to say."""
    stripped = product_description.strip()
    if not stripped:
        return None
    return f"For reference, the product is {stripped}"


def environment(scene_id: str, description: str = "") -> str | None:
    """Environment fragment derived from a scene id, or a curated description.

    Scene catalogues (labels, categories, full descriptions) live in
    `product_service.PRODUCT_SCENES`, which this pure package must not
    import -- resolving a scene id to its curated text is the caller's job.
    When the caller supplies that resolved `description`, it is used
    verbatim (this is the real environment direction and takes priority).
    When it is blank, this falls back to a generic phrase built from the
    scene id alone, exactly as before.
    """
    stripped_description = description.strip()
    if stripped_description:
        return stripped_description
    stripped_id = scene_id.strip()
    if not stripped_id:
        return None
    return f"Scene: {stripped_id.replace('_', ' ')}"


def rendering_style(creativity: int) -> str:
    """Guidance-strength fragment for the showcase pipeline's creativity
    slider (0-100, low = literal). Never None: creativity is always supplied."""
    if not 0 <= creativity <= 100:
        raise ValueError(f"creativity must be 0-100, got {creativity}")

    if creativity <= 20:
        return "adhere as literally as possible to the brief with minimal creative interpretation"
    if creativity <= 60:
        return "follow the brief closely, with modest creative latitude in styling and props"
    return "use the brief as creative direction, with significant latitude in styling, props, and composition"


def brand_style(brand_kit: BrandKitLike | None) -> str | None:
    """Brand-alignment fragment: palette, style rules, and tone. None when
    there is no brand kit or the kit carries no usable guidance.

    `tone` is read directly off `brand_kit` (part of `BrandKitLike`) rather
    than smuggled in by a caller through `user_prompt` -- this is the single
    place brand tone is expressed as a brand fragment.
    """
    if brand_kit is None:
        return None

    parts: list[str] = []
    if brand_kit.colors:
        parts.append(f"echo the brand palette ({', '.join(brand_kit.colors)}) subtly in the styling and props")
    if brand_kit.style_rules and brand_kit.style_rules.strip():
        parts.append(brand_kit.style_rules.strip())
    if brand_kit.tone and brand_kit.tone.strip():
        parts.append(f"Tone: {brand_kit.tone.strip()}")

    if not parts:
        return None
    return "; ".join(parts)


def quality(token: vocab.QualityToken) -> str:
    """Quality-tier fragment. Raises KeyError for an unknown token. Never
    None: quality is always supplied."""
    return vocab.QUALITY[token]


def texture_resolution(token: vocab.TextureResolutionToken) -> str:
    """Texture-resolution fragment for the 3D pipeline. Raises KeyError for
    an unknown token."""
    return vocab.TEXTURE_RESOLUTION[token]


def user_intent(user_prompt: str) -> str | None:
    """The user's own free-text direction, appended last and verbatim so it
    refines rather than overrides everything that came before it. Blank or
    whitespace-only input has nothing to say."""
    stripped = user_prompt.strip()
    if not stripped:
        return None
    return stripped


def negative_prompt(extra: str | None = None) -> str:
    """The full negative prompt: every required exclusion, plus a
    user-supplied negative appended (never substituted)."""
    base = ", ".join(vocab.NEGATIVE_TERMS)
    if extra and extra.strip():
        return f"{base}, {extra.strip()}"
    return base
