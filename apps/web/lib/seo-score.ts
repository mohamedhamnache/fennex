/**
 * Client-side mirror of the backend `compute_seo_score`
 * (apps/api/app/services/article_service.py). Kept byte-for-byte in sync so
 * the editor can recompute the SEO score + ranking signals live on every
 * change - no server round-trip. The server stays the source of truth for the
 * persisted score (overview cards, generation, auto-repair).
 */

export interface SeoScore {
  score: number;
  breakdown: Record<string, number>;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function computeSeoScore(
  title: string,
  body: string,
  keyword: string | null,
  metaDescription: string | null,
): SeoScore {
  const kw = (keyword ?? "").toLowerCase().trim();
  const titleLower = (title ?? "").toLowerCase();
  const b = body ?? "";
  const breakdown: Record<string, number> = {};
  let score = 0;

  // keyword in title: +20
  breakdown.keyword_in_title = kw && titleLower.includes(kw) ? 20 : 0;
  score += breakdown.keyword_in_title;

  // keyword in first REAL paragraph (skip heading-only blocks): +15
  let firstPara = "";
  for (const block of b.split(/\n{2,}/).filter((p) => p.trim())) {
    const lines = block.split("\n").filter((l) => l.trim());
    const text = lines.filter((l) => !l.trimStart().startsWith("#")).join(" ");
    if (text.trim()) {
      firstPara = text.toLowerCase();
      break;
    }
  }
  breakdown.keyword_in_first_paragraph = kw && firstPara.includes(kw) ? 15 : 0;
  score += breakdown.keyword_in_first_paragraph;

  // keyword density 0.5-2.5% (partial +7); multi-word keyword counts its length
  const words = b.split(/\s+/).filter(Boolean);
  const total = words.length;
  if (kw && total > 0) {
    const kwLen = Math.max(1, kw.split(/\s+/).filter(Boolean).length);
    const occ = (b.toLowerCase().match(new RegExp(escapeRegex(kw), "g")) ?? []).length;
    const density = ((occ * kwLen) / total) * 100;
    breakdown.keyword_density = density >= 0.5 && density <= 2.5 ? 15 : density > 0 ? 7 : 0;
  } else {
    breakdown.keyword_density = 0;
  }
  score += breakdown.keyword_density;

  // word count >= 1500: +20, >= 1000: +15
  breakdown.word_count = total >= 1500 ? 20 : total >= 1000 ? 15 : 0;
  score += breakdown.word_count;

  // has H2 headings: +15
  breakdown.has_h2_headings = b.includes("## ") ? 15 : 0;
  score += breakdown.has_h2_headings;

  // meta description present: +15
  breakdown.meta_description = metaDescription ? 15 : 0;
  score += breakdown.meta_description;

  return { score: Math.round(score * 10) / 10, breakdown };
}
