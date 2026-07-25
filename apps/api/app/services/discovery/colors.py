"""High-accuracy brand-colour extraction from a page's HTML/CSS.

The naive approach (grab every ``#rrggbb`` in source order) returns borders,
shadows, text greys and third-party widget colours -- not the brand palette.
This scores candidates by where they appear (theme-color meta and brand-named
CSS custom properties are strong signals; background usage and raw frequency
are weaker), drops neutrals, favours saturated hues, and merges near-duplicate
shades, so the real brand colours rise to the top."""
import colorsys
import re

_HEX = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b")
_RGB = re.compile(r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)")
_DECL = re.compile(r"(--[a-z0-9-]+|[a-z-]+)\s*:\s*([^;{}]+)", re.I)
_BRAND_HINT = re.compile(r"primary|brand|accent|secondary|main|cta|theme|highlight", re.I)

# Per-CSS-property weight when a colour is used there. Backgrounds and fills are
# where brand colour lives; text/borders are usually neutral chrome.
_PROP_WEIGHT = {
    "background": 1.6, "background-color": 1.6, "fill": 1.2,
    "stroke": 0.7, "border-color": 0.5, "color": 0.5, "outline-color": 0.3,
}
_THEME_WEIGHT = 6.0
_BRAND_VAR_WEIGHT = 5.0
_PLAIN_VAR_WEIGHT = 1.8
_FREQ_WEIGHT = 0.15  # every raw occurrence, so a colour reused everywhere ranks up

_DEDUP_DISTANCE = 42  # RGB euclidean distance below which two colours are "the same"

# Exact brand colours of ubiquitous third-party widgets (share buttons, Google
# sign-in, maps, etc.). A site almost never picks the EXACT same hex as its own
# primary, so denying these exact values strips widget noise without touching
# real brand palettes.
_THIRD_PARTY_UI = {
    "#4285F4", "#34A853", "#FBBC05", "#EA4335", "#DB4437",  # Google
    "#1877F2", "#3B5998", "#4267B2",                          # Facebook
    "#1DA1F2",                                                # Twitter
    "#25D366", "#128C7E",                                     # WhatsApp
    "#0A66C2", "#0077B5",                                     # LinkedIn
    "#E60023", "#BD081C",                                     # Pinterest
    "#FF0000", "#CD201F",                                     # YouTube
}


def _hex_norm(raw: str) -> str:
    h = raw.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h.upper()


def _rgb_norm(r: str, g: str, b: str) -> str:
    return "#{:02X}{:02X}{:02X}".format(
        min(255, int(r)), min(255, int(g)), min(255, int(b))
    )


def _colors_in(value: str) -> list[str]:
    out: list[str] = []
    for m in _HEX.finditer(value):
        out.append(_hex_norm(m.group(1)))
    for m in _RGB.finditer(value):
        alpha = m.group(4)
        if alpha is not None and float(alpha) == 0:  # fully transparent -> not a colour
            continue
        out.append(_rgb_norm(m.group(1), m.group(2), m.group(3)))
    return out


def _sat_light(hexc: str) -> tuple[float, float]:
    r = int(hexc[1:3], 16) / 255
    g = int(hexc[3:5], 16) / 255
    b = int(hexc[5:7], 16) / 255
    _, light, sat = colorsys.rgb_to_hls(r, g, b)
    return sat, light


def _is_neutral(hexc: str) -> bool:
    sat, light = _sat_light(hexc)
    return sat < 0.12 or light > 0.93 or light < 0.06


def _distance(a: str, b: str) -> float:
    return (
        (int(a[1:3], 16) - int(b[1:3], 16)) ** 2
        + (int(a[3:5], 16) - int(b[3:5], 16)) ** 2
        + (int(a[5:7], 16) - int(b[5:7], 16)) ** 2
    ) ** 0.5


def extract_brand_colors(html: str, soup, max_colors: int = 5) -> list[str]:
    """Return up to ``max_colors`` brand colours as ``#RRGGBB``, most likely
    first. Empty when the page carries no usable colour signal."""
    if not html:
        return []
    scores: dict[str, float] = {}

    def add(colors: list[str], weight: float) -> None:
        for c in colors:
            scores[c] = scores.get(c, 0.0) + weight

    # 1. theme-color meta -- the browser-chrome colour, almost always the brand.
    for tag in soup.find_all("meta", attrs={"name": "theme-color"}):
        add(_colors_in(tag.get("content", "") or ""), _THEME_WEIGHT)

    # 2. CSS declarations: custom properties and property-weighted usage.
    for m in _DECL.finditer(html):
        prop, val = m.group(1).lower(), m.group(2)
        cols = _colors_in(val)
        if not cols:
            continue
        if prop.startswith("--"):
            add(cols, _BRAND_VAR_WEIGHT if _BRAND_HINT.search(prop) else _PLAIN_VAR_WEIGHT)
        else:
            w = _PROP_WEIGHT.get(prop)
            if w is not None:
                add(cols, w)

    # 3. Raw frequency across the whole document (weak, but reuse == brand).
    add(_colors_in(html), _FREQ_WEIGHT)

    if not scores:
        return []

    # Rank by score, boosted by saturation; drop neutrals unless nothing else.
    def ranked(pool: dict[str, float]) -> list[str]:
        items = []
        for hexc, score in pool.items():
            sat, _ = _sat_light(hexc)
            items.append((hexc, score * (1 + sat)))
        items.sort(key=lambda x: x[1], reverse=True)
        return [h for h, _ in items]

    non_neutral = {
        h: s for h, s in scores.items()
        if not _is_neutral(h) and h not in _THIRD_PARTY_UI
    }
    order = ranked(non_neutral) or ranked(scores)

    # Merge near-duplicate shades so we don't return three tints of one colour.
    chosen: list[str] = []
    for hexc in order:
        if all(_distance(hexc, c) > _DEDUP_DISTANCE for c in chosen):
            chosen.append(hexc)
        if len(chosen) >= max_colors:
            break
    return chosen
