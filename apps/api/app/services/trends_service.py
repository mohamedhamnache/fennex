"""Curated catalog of trending visual styles for image generation."""

TRENDS_CATALOG: dict[str, dict] = {
    "neo_brutalism": {
        "label": "Neo Brutalism",
        "category": "design",
        "description": "Raw, bold typography, stark contrasts, unpolished aesthetic",
        "prompt_suffix": "neo-brutalist design, bold black outlines, raw typography, stark color blocks, unfiltered aesthetic",
    },
    "bento_grid": {
        "label": "Bento Grid Layout",
        "category": "design",
        "description": "Modular card-based compositions inspired by Japanese bento boxes",
        "prompt_suffix": "bento grid composition, modular card layout, clean white dividers, modern app UI aesthetic",
    },
    "glassmorphism": {
        "label": "Glassmorphism",
        "category": "design",
        "description": "Frosted glass, blur effects, translucent layers",
        "prompt_suffix": "glassmorphism style, frosted glass effect, blur and transparency, luminous pastel background, subtle shadows",
    },
    "3d_clay": {
        "label": "3D Clay / Claymation",
        "category": "3d",
        "description": "Soft, rounded 3D clay-like characters and objects",
        "prompt_suffix": "3D clay style, smooth rounded surfaces, soft pastel colors, claymation aesthetic, playful and friendly",
    },
    "dark_luxury": {
        "label": "Dark Luxury",
        "category": "aesthetic",
        "description": "Rich dark backgrounds, gold accents, premium sophistication",
        "prompt_suffix": "dark luxury aesthetic, deep black background, gold accents, velvet texture, premium sophisticated mood",
    },
    "dopamine_branding": {
        "label": "Dopamine Branding",
        "category": "aesthetic",
        "description": "Ultra-saturated, playful, joy-inducing colors",
        "prompt_suffix": "dopamine branding, ultra-saturated joyful colors, maximalist, playful energy, positive emotional trigger",
    },
    "retro_futurism": {
        "label": "Retro Futurism",
        "category": "aesthetic",
        "description": "1970s sci-fi meets modern design — chrome, neon, space age",
        "prompt_suffix": "retro futurism, 1970s sci-fi aesthetics, chrome surfaces, neon glow, space age modernism",
    },
    "ai_surrealism": {
        "label": "AI Surrealism",
        "category": "art",
        "description": "Dreamlike, impossible scenes with hyper-realistic textures",
        "prompt_suffix": "AI surrealism, dreamlike impossible scene, hyper-realistic textures, surreal juxtaposition, otherworldly",
    },
    "film_grain": {
        "label": "Film Grain / Analog",
        "category": "photography",
        "description": "Nostalgic film photography aesthetic with visible grain",
        "prompt_suffix": "analog film photography, visible film grain, nostalgic warm tones, vignette, 35mm aesthetic",
    },
    "editorial_minimalism": {
        "label": "Editorial Minimalism",
        "category": "design",
        "description": "High-end magazine white space, single subject, precise composition",
        "prompt_suffix": "editorial minimalism, fashion magazine aesthetic, white negative space, single hero subject, precise composition",
    },
    "y2k_revival": {
        "label": "Y2K Revival",
        "category": "aesthetic",
        "description": "Early 2000s nostalgia — chrome, glossy, holographic",
        "prompt_suffix": "Y2K aesthetic revival, chrome and glossy textures, early 2000s digital art, holographic gradients, futuristic nostalgia",
    },
    "coastal_luxury": {
        "label": "Coastal / Quiet Luxury",
        "category": "aesthetic",
        "description": "Understated elegance, linen textures, muted palette, natural light",
        "prompt_suffix": "quiet luxury aesthetic, coastal style, linen textures, muted natural palette, understated elegance",
    },
    "maximalist_art": {
        "label": "Maximalist Art",
        "category": "art",
        "description": "Bold clashing patterns, excess, eclectic richness",
        "prompt_suffix": "maximalist art, clashing patterns, bold eclecticism, rich excess, vibrant color collage",
    },
    "hyperrealism_cgi": {
        "label": "Hyperrealism CGI",
        "category": "3d",
        "description": "Photo-indistinguishable 3D rendered product shots",
        "prompt_suffix": "hyperrealistic CGI, indistinguishable from photography, perfect studio lighting, subsurface scattering, ultra detail",
    },
    "botanical_organic": {
        "label": "Botanical / Organic",
        "category": "aesthetic",
        "description": "Nature-forward, biophilic design, leaves, natural textures",
        "prompt_suffix": "botanical organic aesthetic, biophilic design, fresh green leaves, natural textures, earthy tones, wellness",
    },
}


def build_trend_prompt(trend_id: str, subject: str, brand_kit=None) -> str:
    trend = TRENDS_CATALOG.get(trend_id)
    if not trend:
        raise ValueError(f"Unknown trend: {trend_id}")
    base = f"{subject}. {trend['prompt_suffix']}."
    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
        if brand_kit.tone:
            parts.append(f"Tone: {brand_kit.tone}")
        if parts:
            base = f"{base} {'. '.join(parts)}."
    return base
