/**
 * The single product-scene catalog.
 *
 * `ProductStudio` (reached from the Create launcher's Product card) and
 * `ProductTab` (the studio left panel) each carried their own copy of this
 * list, so the 15 premium environments added to one were invisible in the
 * other. One catalog, two consumers.
 *
 * Every `id` here MUST exist as a key in `PRODUCT_SCENES` in
 * `apps/api/app/services/product_service.py` -- the API rejects an unknown
 * `scene_id` with a 400, so a typo is a broken tile rather than a bad image.
 */

export type SceneCategory =
  | "packshot"
  | "lifestyle"
  | "food"
  | "tech"
  | "fashion"
  | "premium";

export type CategoryFilter = "all" | SceneCategory;

export interface ProductScene {
  id: string;
  label: string;
  category: SceneCategory;
}

export const PRODUCT_SCENES: readonly ProductScene[] = [
  // Original catalog -- ids and categories unchanged, so nothing that already
  // referenced them breaks.
  { id: "white_studio", label: "White Studio", category: "packshot" },
  { id: "gradient_studio", label: "Gradient BG", category: "packshot" },
  { id: "floating_shadow", label: "Floating", category: "packshot" },
  { id: "marble_countertop", label: "Marble Counter", category: "lifestyle" },
  { id: "cafe_table", label: "Cafe Table", category: "lifestyle" },
  { id: "home_living_room", label: "Living Room", category: "lifestyle" },
  { id: "outdoor_nature", label: "Nature", category: "lifestyle" },
  { id: "food_table_scene", label: "Food Scene", category: "food" },
  { id: "desk_setup", label: "Desk Setup", category: "tech" },
  { id: "model_studio", label: "Model Studio", category: "fashion" },
  { id: "athlete_action", label: "Athlete", category: "fashion" },

  // Premium environments: commercial-photography direction rather than a
  // generic backdrop. `marble` is deliberately distinct from
  // `marble_countertop`, and `lifestyle` here is a scene id, not the category
  // of the same name.
  { id: "luxury_studio", label: "Luxury Studio", category: "premium" },
  { id: "bathroom", label: "Bathroom", category: "premium" },
  { id: "spa", label: "Spa", category: "premium" },
  { id: "travertine", label: "Travertine", category: "premium" },
  { id: "marble", label: "Marble", category: "premium" },
  { id: "limestone", label: "Limestone", category: "premium" },
  { id: "botanical", label: "Botanical", category: "premium" },
  { id: "mediterranean", label: "Mediterranean", category: "premium" },
  { id: "luxury_hotel", label: "Luxury Hotel", category: "premium" },
  { id: "editorial", label: "Editorial", category: "premium" },
  { id: "lifestyle", label: "Lifestyle", category: "premium" },
  { id: "minimal", label: "Minimal", category: "premium" },
  { id: "scandinavian", label: "Scandinavian", category: "premium" },
  { id: "dark_luxury", label: "Dark Luxury", category: "premium" },
] as const;

export const SCENE_CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "premium", label: "Premium" },
  { id: "packshot", label: "Packshot" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "food", label: "Food" },
  { id: "tech", label: "Tech" },
  { id: "fashion", label: "Fashion" },
];

export const SCENE_LABEL: Record<string, string> = Object.fromEntries(
  PRODUCT_SCENES.map((s) => [s.id, s.label]),
);

export function scenesInCategory(filter: CategoryFilter): readonly ProductScene[] {
  return filter === "all" ? PRODUCT_SCENES : PRODUCT_SCENES.filter((s) => s.category === filter);
}
