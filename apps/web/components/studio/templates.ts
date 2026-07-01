// apps/web/components/studio/templates.ts

export interface TemplateCategory {
  id: string;
  label: string;
  prompts: string[];
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    id: "ecommerce",
    label: "Ecommerce",
    prompts: [
      "Ultra-realistic luxury product hero shot, studio lighting, soft gradient background, shallow depth of field, 8K sharp details, white backdrop",
      "Lifestyle product mockup, natural light, person using the product in a modern home setting, warm tones, editorial style",
      "Clean packshot on pure white background, professional product photography, crisp shadows, centered composition",
      "E-commerce banner creative, product on the left, bold CTA text space on the right, gradient background, modern design",
    ],
  },
  {
    id: "food",
    label: "Food",
    prompts: [
      "Restaurant dish overhead flat lay, ceramic plate, garnish details, moody dark background, professional food photography",
      "Food styling flat lay, colorful ingredients arranged artfully, bright natural light, top-down view, clean composition",
      "Recipe hero image, finished dish in a rustic setting, steam rising, warm golden hour light, shallow depth of field",
      "Cozy cafe ambiance, latte art, warm bokeh lights, wooden table, magazine editorial style",
    ],
  },
  {
    id: "real_estate",
    label: "Real Estate",
    prompts: [
      "Modern interior wide-angle shot, open-plan living room, natural light flooding in, minimalist Scandinavian design, 4K",
      "Aerial exterior property shot, golden hour, lush garden, swimming pool, luxury residential architecture",
      "Luxury bathroom interior, marble finishes, rainfall shower, warm accent lighting, architectural photography",
      "Open-plan kitchen and living area, high ceilings, floor-to-ceiling windows, contemporary design, bright and airy",
    ],
  },
  {
    id: "fashion",
    label: "Fashion",
    prompts: [
      "High fashion editorial runway shot, dramatic studio lighting, avant-garde outfit, model striking pose, Vogue magazine style",
      "Streetwear lookbook photography, urban background, natural light, candid style, Gen Z aesthetic",
      "Luxury jewellery close-up macro shot, diamond ring, black velvet background, sparkle and reflections, ultra-detailed",
      "Athletic sportswear action shot, athlete in motion, dynamic blur, outdoor stadium, Nike campaign style",
    ],
  },
  {
    id: "social_ads",
    label: "Social Ads",
    prompts: [
      "Instagram story product ad, vertical 9:16 format, bold typography space at top, product centered, vibrant gradient background",
      "Facebook ad banner, product on left, offer text space on right, clean design, high contrast, call-to-action friendly",
      "YouTube thumbnail, bold dramatic lighting, expressive face, large text overlay space, high contrast colors",
      "TikTok cover image, trendy aesthetic, bold color palette, Gen Z style, vertical format, eye-catching composition",
    ],
  },
];
