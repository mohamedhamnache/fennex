// apps/web/lib/geo-score.ts
/**
 * Client-side mirror of the backend `compute_geo_core`
 * (apps/api/app/services/geo_service.py). Kept in sync so the editor can
 * recompute the GEO core (answer-engine readiness, 0-70) live as the user
 * types - no server round-trip. The server stays the source of truth for the
 * persisted hybrid score (core + the +30 LLM judgment added on generation).
 */

export interface GeoScore {
  score: number;
  breakdown: Record<string, number>;
}

export function computeGeoCore(
  title: string,
  body: string,
  metaDescription: string | null,
): GeoScore {
  const b = body ?? "";
  const breakdown: Record<string, number> = {};
  let score = 0;

  // 1. answer_up_top (+15): a plain paragraph (25-120 words) before the first H2.
  const beforeH2 = b.split(/(?:^|\n)##\s/)[0];
  let answer = 0;
  for (const para of beforeH2.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p || /^[#\-*>|]/.test(p) || /^\d+\./.test(p)) continue;
    const wc = p.split(/\s+/).filter(Boolean).length;
    if (wc >= 25 && wc <= 120) {
      answer = 15;
      break;
    }
  }
  breakdown.answer_up_top = answer;
  score += answer;

  // 2. qa_structure (+12): a heading line with '?' or an FAQ heading.
  let qa = 0;
  for (const ln of b.split("\n")) {
    const s = ln.trim();
    if (s.startsWith("#") && (s.includes("?") || /\bfaq\b|frequently asked/i.test(s))) {
      qa = 12;
      break;
    }
  }
  breakdown.qa_structure = qa;
  score += qa;

  // 3. extractable_format (+12): a markdown list or table.
  const hasList = /^\s*(?:[-*]\s+|\d+\.\s+)/m.test(b);
  const hasTable = /\S \| \S/.test(b);
  const ef = hasList || hasTable ? 12 : 0;
  breakdown.extractable_format = ef;
  score += ef;

  // 4. statistics (+10 / +5): count digit characters.
  const nums = (b.match(/\d/g) ?? []).length;
  const stat = nums >= 6 ? 10 : nums >= 3 ? 5 : 0;
  breakdown.statistics = stat;
  score += stat;

  // 5. citations (+11): a markdown http link or a citation phrase.
  const cite =
    /\[[^\]]+\]\(https?:\/\//.test(b) || /according to|source:|\bstudy\b|\breport\b/i.test(b) ? 11 : 0;
  breakdown.citations = cite;
  score += cite;

  // 6. concise_paragraphs (+10 / +5): median plain-paragraph sentence count <= 4.
  const paras = b
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^[#\-*|>]/.test(p));
  let conc = 0;
  if (paras.length) {
    const counts = paras
      .map((p) => Math.max(1, (p.match(/[.!?]+/g) ?? []).length))
      .sort((x, y) => x - y);
    const median = counts[Math.floor(counts.length / 2)];
    conc = median <= 4 ? 10 : median <= 6 ? 5 : 0;
  }
  breakdown.concise_paragraphs = conc;
  score += conc;

  return { score: Math.round(score * 10) / 10, breakdown };
}
