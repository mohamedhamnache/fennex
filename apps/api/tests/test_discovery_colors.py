"""Accuracy tests for brand-colour extraction."""
from bs4 import BeautifulSoup

from app.services.discovery.colors import extract_brand_colors


def _colors(html: str):
    return extract_brand_colors(html, BeautifulSoup(html, "html.parser"))


def test_brand_signal_beats_neutrals_and_noise():
    html = """
    <html><head>
    <meta name="theme-color" content="#E4572E">
    <style>
    :root{ --color-primary:#E4572E; --brand-accent:#17BEBB; --text:#222222; }
    body{ color:#333333; background:#ffffff; }
    .btn{ background-color:#E4572E; border-color:#dddddd; }
    .tag{ background:#17BEBB; }
    .muted{ color:#999999; }
    .shadow{ box-shadow:0 1px 2px #000000; }
    </style>
    </head><body></body></html>
    """
    colors = _colors(html)
    # The brand primary (theme-color + --color-primary + button background) wins.
    assert colors[0] == "#E4572E"
    # The accent (brand-named var + background usage) is included and ranks
    # above nothing branded below it.
    assert "#17BEBB" in colors
    assert colors.index("#E4572E") < colors.index("#17BEBB")
    # Neutrals (white/black/greys) are excluded.
    for neutral in ("#FFFFFF", "#000000", "#222222", "#333333", "#999999", "#DDDDDD"):
        assert neutral not in colors


def test_near_duplicate_shades_are_merged():
    html = """
    <style>
    :root{ --primary:#E4572E; }
    .a{ background:#E4572E; } .b{ background:#E5582F; } .c{ background:#E3562D; }
    .accent{ background:#17BEBB; }
    </style>
    """
    colors = _colors(html)
    # The three near-identical oranges collapse to a single swatch.
    oranges = [c for c in colors if c in ("#E4572E", "#E5582F", "#E3562D")]
    assert len(oranges) == 1
    assert "#17BEBB" in colors


def test_rgb_and_short_hex_are_normalised():
    html = """
    <style>
    :root{ --brand:#0af; }
    .x{ background: rgb(0, 170, 255); }
    .y{ background: rgba(0,0,0,0); }  /* transparent -> ignored */
    </style>
    """
    colors = _colors(html)
    assert "#00AAFF" in colors  # #0af and rgb(0,170,255) both normalise here
    assert "#000000" not in colors


def test_empty_or_colorless_html_returns_empty():
    assert _colors("") == []
    assert _colors("<html><body><p>No colours here</p></body></html>") == []
