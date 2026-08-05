/**
 * Verification harness for the template system, run under Node.
 *
 * apps/web has no test framework and the sweep route needs a browser, so this
 * is the mechanical gate that can run anywhere: transpile with the repo's own
 * tsc and execute.
 *
 *   npx tsc -p scripts/tsconfig.verify.json
 *   node .verify-out/scripts/verify-templates.js
 *
 * It cannot rasterise and it cannot tell you whether anything looks good —
 * /dev/template-sweep is still the only thing that renders — but every check
 * here is one that was previously satisfied by reading the file and hoping.
 *
 * THE MATRIX IS THE POINT. The shipped templates are a sample of 443 legal
 * (layout, ground, colourway) cells. Checking only the shipped ones says
 * nothing about the cell the next template will be built in, and every defect
 * this harness has found so far was in a cell nothing shipped: 596 runs
 * claiming a wash a chip had covered, 310 more claiming a field a flare had
 * covered, a cap-line 7% past the right edge, and a script line at 1.98:1 that
 * took `accentInk` onto a ground `accentInk` makes no promise about.
 *
 * Contrast is REPORTED, not enforced. That rule is what forced every
 * composition in the rejected set into a box. A run with no measurable backdrop
 * at all is a different thing and is still a defect.
 */

import {
  TEXT_TEMPLATES, templateFingerprint, brandTemplate, BRAND_KIT_FIXTURES,
  type TextTemplate, type TemplateLayerDef,
} from "../components/studio/edit/text-templates";
import { analyzeText } from "../components/studio/edit/families";
import { MIN_CONTRAST } from "../components/studio/edit/palette";
import {
  LAYOUTS, matrixFor, buildTemplate, PLACEHOLDER_COPY, headlinePct,
} from "../components/studio/edit/design/templates";
import { COLOURWAYS } from "../components/studio/edit/design/colourways";
import { GROUND_KINDS } from "../components/studio/edit/design/ground";
import {
  runReports, verifyFieldClaims, estWidthPct, type RunSpec,
} from "../components/studio/edit/design/type";

let failures = 0;
let warnings = 0;

const pass = (n: string, d: string) => console.log(`  PASS  ${n} — ${d}`);
const fail = (n: string, d: string) => { failures += 1; console.log(`  FAIL  ${n} — ${d}`); };
const warn = (n: string, d: string) => { warnings += 1; console.log(`  WARN  ${n} — ${d}`); };
const check = (ok: boolean, n: string, d: string) => (ok ? pass : fail)(n, d);
const head = (t: string) => console.log(`\n${t}\n${"-".repeat(t.length)}`);
const info = (d: string) => console.log(`  INFO  ${d}`);

/** Every string reachable from a value, recursively — copy, ids, names, colours,
 *  everything — rather than trusting a hand-picked list of "the fields that hold
 *  copy" to stay complete as the shape of a template evolves. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") { out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out); return; }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  }
}

/** Runs whose estimated extent leaves the frame. The estimator is the one the
 *  centring uses and is deliberately generous, so this over-reports rather than
 *  letting a run ship past the edge. */
function overflowing(runs: RunSpec[]): RunSpec[] {
  return runs.filter((r) => r.xPct + estWidthPct(r) > 100.5 || r.xPct < -0.5);
}

interface Report {
  /** A claim false about the geometry, a run on nothing, a run off the frame. */
  defects: string[];
  /** Contrast below AA. Reported, never fatal. */
  warns: string[];
  worst: number | null;
}

function inspect(t: { headline: string; layers: TemplateLayerDef[]; runs: RunSpec[] }): Report {
  const defects: string[] = [];
  const warns: string[] = [];
  for (const p of verifyFieldClaims(t.layers, t.runs)) defects.push(`field claim: ${p}`);
  for (const r of t.runs) {
    if (r.on.kind === "photograph") defects.push(`"${r.text}" sits on the bare photograph`);
  }
  for (const r of overflowing(t.runs)) defects.push(`"${r.text}" runs past the frame`);
  if (!t.runs.some((r) => r.text === t.headline)) defects.push(`headline "${t.headline}" matches no run`);

  const reports = runReports(t.runs);
  for (const r of reports) {
    if (r.level === "warn") {
      warns.push(`"${r.text}" ${r.ratio === null ? "unbounded" : `${r.ratio.toFixed(2)}:1`} on ${r.backdrop}`);
    }
  }
  const measured = reports.filter((r) => r.ratio !== null).map((r) => r.ratio as number);
  return { defects, warns, worst: measured.length ? Math.min(...measured) : null };
}

// ── Mode 1: the whole matrix ──────────────────────────────────────────────────

function runMatrix(): void {
  head("Compatibility matrix — every layout in every legal ground and colourway");
  const defective: string[] = [];
  const warned: { key: string; worst: number; lines: string[] }[] = [];
  let cells = 0;

  for (const l of LAYOUTS) {
    for (const { ground, cw } of matrixFor(l)) {
      cells += 1;
      const key = `${l.id}/${ground}/${cw.id}`;
      let r: Report;
      try {
        r = inspect(buildTemplate(l, { cw, ground, copy: PLACEHOLDER_COPY }));
      } catch (e) {
        defective.push(`${key}: threw ${String(e)}`);
        continue;
      }
      for (const d of r.defects) defective.push(`${key}: ${d}`);
      if (r.warns.length) warned.push({ key, worst: r.worst ?? 0, lines: r.warns });
    }
  }

  check(defective.length === 0, "matrix defects", defective.length
    ? `${defective.length}:\n        ${defective.slice(0, 30).join("\n        ")}`
    : `${cells} cells, none defective`);
  info(`${cells} cells; ${cells - warned.length} clear of AA, ${warned.length} with a contrast warning`);

  const byGround = new Map<string, number>();
  const byCw = new Map<string, number>();
  for (const w of warned) {
    const [, g, c] = w.key.split("/");
    byGround.set(g, (byGround.get(g) ?? 0) + 1);
    byCw.set(c, (byCw.get(c) ?? 0) + 1);
  }
  info(`warnings by ground: ${[...byGround.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(", ") || "none"}`);
  info(`warnings by colourway: ${[...byCw.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(", ") || "none"}`);
  for (const w of warned.sort((a, b) => a.worst - b.worst).slice(0, 8)) {
    info(`tightest: ${w.key} worst ${w.worst.toFixed(2)}:1 — ${w.lines[0]}`);
  }
}

// ── Mode 2: the shipped set ───────────────────────────────────────────────────

/** Renderer vocabulary. `SceneSvg` composites exactly these blends and renders
 *  exactly these clips as authored, degrading anything else to a rounded rect —
 *  so a template asking for more would look right in the source and wrong on
 *  screen, silently. */
const ALLOWED_BLENDS = new Set(["normal", "multiply", "screen", "overlay", "soft-light", "darken", "lighten"]);
const RENDERED_CLIPS = ["roundedPct", "insetPct"];

function capabilitiesOf(l: TemplateLayerDef) {
  return {
    blend: !!l.blend && l.blend !== "normal",
    rotation: !!l.rotation,
    clip: l.kind === "image" && !!l.clip && !("roundedPct" in l.clip),
    cutout: l.kind === "image" && l.source === "subject-cutout",
  };
}

function tally<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const i of items) out.set(key(i), (out.get(key(i)) ?? 0) + 1);
  return out;
}

function show(label: string, t: Map<string, number>): void {
  info(`${label}: ${[...t.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} x${n}`).join(", ")}`);
}

function runSet(): void {
  const templates: TextTemplate[] = TEXT_TEMPLATES;
  head(`The shipped set — ${templates.length} templates`);

  // 1. Distinctness. Copy blanked, everything else hashed: two templates that
  //    differ only in words are one template shipped twice, which is how the
  //    rejected set held seven identical pairs inside 34 entries.
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const t of templates) {
    const fp = templateFingerprint(t);
    const earlier = seen.get(fp);
    if (earlier) collisions.push(`${earlier} and ${t.id} are geometrically identical`);
    else seen.set(fp, t.id);
  }
  check(collisions.length === 0, "distinctness", collisions.length
    ? collisions.join("; ")
    : `${templates.length} templates, ${seen.size} distinct fingerprints`);

  // 2. Brand neutrality. A customer applying a template publishes under their
  //    own name; one that name-drops ours burns their post on our advert.
  const hits: string[] = [];
  for (const t of templates) {
    const strings: string[] = [];
    collectStrings(t, strings);
    for (const s of strings) if (s.toLowerCase().includes("fennex")) hits.push(`${t.id}: "${s}"`);
  }
  check(hits.length === 0, "brand neutrality", hits.length
    ? hits.join("; ")
    : `${templates.length} templates scanned, no "fennex" in any casing in any field`);

  // 3. Capability coverage, in two parts, and both are needed.
  //
  //    SET LEVEL: all four capabilities must be exercised somewhere. This is the
  //    gate the rejected set failed — 34 templates that set zero blends, zero
  //    rotations and clipped with one circle and three rounded rects.
  //
  //    PER LAYOUT: each layout must earn at least one, grouped by the real
  //    shipped output rather than by calling a builder with parameters nothing
  //    ships. A capability sitting behind a branch no template reaches has not
  //    been earned. Requiring all four of every layout would be wrong: Culvert
  //    places the photograph whole because it IS the ground there, and demanding
  //    a cutout of it would be the check designing the template.
  const kinds = ["blend", "rotation", "clip", "cutout"] as const;
  const byLayout = new Map<string, TemplateLayerDef[]>();
  for (const t of templates) byLayout.set(t.layout, [...(byLayout.get(t.layout) ?? []), ...t.layers]);
  const all = templates.flatMap((t) => t.layers).map(capabilitiesOf);
  const missingSet = kinds.filter((k) => !all.some((e) => e[k]));
  check(missingSet.length === 0, "capability coverage (set)", missingSet.length
    ? `no template uses ${missingSet.join(", ")}`
    : `blend, rotation, a non-rounded clip and a cutout are all exercised`);

  const barren: string[] = [];
  const earnedBy: string[] = [];
  for (const [id, layers] of byLayout) {
    const e = layers.map(capabilitiesOf);
    const earned = kinds.filter((k) => e.some((x) => x[k]));
    if (earned.length === 0) barren.push(id);
    earnedBy.push(`${id}: ${earned.join("+")}`);
  }
  check(barren.length === 0, "capability coverage (per layout)", barren.length
    ? `${barren.join(", ")} earn nothing`
    : earnedBy.join("; "));

  // 4. Renderer vocabulary.
  const badBlend: string[] = [];
  const badClip: string[] = [];
  for (const t of templates) {
    for (const l of t.layers) {
      if (l.blend && !ALLOWED_BLENDS.has(l.blend)) badBlend.push(`${t.id}: ${l.blend}`);
      if (l.kind === "image" && l.clip) {
        const c = l.clip as Record<string, unknown>;
        const ok = RENDERED_CLIPS.some((k) => k in c) || c.shape === "circle";
        if (!ok) badClip.push(`${t.id}: ${JSON.stringify(l.clip)}`);
      }
    }
  }
  check(badBlend.length === 0, "blend vocabulary", badBlend.length
    ? badBlend.join("; ") : "every blend is one the renderer composites");
  check(badClip.length === 0, "clip vocabulary", badClip.length
    ? badClip.join("; ") : "every clip is circle, roundedPct or insetPct");

  // 5. Every template places the edited photo, cut out or whole.
  const noSubject = templates.filter(
    (t) => !t.layers.some((l) => l.kind === "image" && typeof l.source === "string"),
  );
  check(noSubject.length === 0, "places the subject", noSubject.length
    ? noSubject.map((t) => t.id).join(", ") : "every template places the edited photo");

  // 6. The hard half of readability: a claim has to be true of the geometry, and
  //    no run may sit on the bare photograph. Contrast itself is below.
  const claims: string[] = [];
  const bare: string[] = [];
  const over: string[] = [];
  for (const t of templates) {
    for (const p of verifyFieldClaims(t.layers, t.runs)) claims.push(`${t.id}: ${p}`);
    for (const r of t.runs) if (r.on.kind === "photograph") bare.push(`${t.id}: "${r.text}"`);
    for (const r of overflowing(t.runs)) over.push(`${t.id}: "${r.text}"`);
  }
  check(claims.length === 0, "field claims", claims.length
    ? claims.join("; ") : "every field and wash claim matches the geometry");
  check(bare.length === 0, "no run on a bare photograph", bare.length
    ? bare.join("; ") : "every run declares a backdrop the template paints");
  check(over.length === 0, "runs in frame", over.length
    ? over.join("; ") : "every run's estimated extent stays inside the frame");

  // 7. Type sizes — the number the first rejection was actually about.
  const heads = templates.map((t) => {
    const r = t.runs.find((x) => x.text === t.headline);
    return { id: t.id, pct: r ? r.sizePct : 0 };
  });
  const lo = Math.min(...heads.map((h) => h.pct));
  const hi = Math.max(...heads.map((h) => h.pct));
  info(`headline sizes ${lo.toFixed(1)}%-${hi.toFixed(1)}% of canvas width ` +
    `(the rejected set put every headline at 10.0% and every display at 14.0%; approved band 6-12%)`);

  // 8. Contrast. WARNING, not a gate — that rule is what forced every
  //    composition into a box. Measured and printed all the same.
  head("Contrast — warnings, not failures");
  const perTemplate = templates.map((t) => ({ t, r: inspect(t) }));
  const worsts = perTemplate.map((p) => p.r.worst).filter((n): n is number => n !== null).sort((a, b) => a - b);
  info(`worst across the set ${worsts[0].toFixed(2)}:1, median ${worsts[Math.floor(worsts.length / 2)].toFixed(2)}:1, AA floor ${MIN_CONTRAST}:1`);
  const warnedT = perTemplate.filter((p) => p.r.warns.length);
  if (warnedT.length === 0) {
    pass("contrast", "every run in every template clears AA against the backdrop it declares");
  } else {
    for (const p of warnedT) warn(`contrast ${p.t.id}`, p.r.warns.join("; "));
    info(`${templates.length - warnedT.length} of ${templates.length} templates clear AA on every run`);
  }

  // 9. Brand kits. `brandTemplate` re-colours fields, and a wash's direction has
  //    to be re-derived with its ink or the monotone floor is lost.
  head("Brand kits");
  const washProblems: string[] = [];
  for (const t of templates) {
    for (const { label, kit } of BRAND_KIT_FIXTURES) {
      for (const b of analyzeText(brandTemplate(t, kit).layers)) {
        if (b.reason?.includes("wash")) washProblems.push(`${t.id} [${label}]: "${b.text}" — ${b.reason}`);
      }
    }
  }
  check(washProblems.length === 0, "wash direction survives a brand kit", washProblems.length
    ? washProblems.slice(0, 8).join("; ")
    : `${templates.length} templates x ${BRAND_KIT_FIXTURES.length} kits, no wash left unbounded`);

  const inert = templates.filter((t) => {
    const before = JSON.stringify(t.layers);
    return BRAND_KIT_FIXTURES.every((k) => JSON.stringify(brandTemplate(t, k.kit).layers) === before);
  });
  check(inert.length === 0, "brand kits recolour", inert.length
    ? inert.map((t) => t.id).join(", ") : "every template changes under every kit");

  // 10. Distribution. A set where one ground carries half the entries is the old
  //     monotony wearing a new coat.
  head("Distribution");
  show("category", tally(templates, (t) => t.category));
  show("layout", tally(templates, (t) => t.layout));
  show("ground", tally(templates, (t) => t.ground));
  show("colourway", tally(templates, (t) => t.colourwayRef.id));
  show("register", tally(templates, (t) => t.colourwayRef.register));

  const grounds = tally(templates, (t) => t.ground);
  const cws = tally(templates, (t) => t.colourwayRef.id);
  const groundCap = Math.ceil(templates.length / 4);
  const cwCap = Math.ceil(templates.length / 6);
  check(grounds.size === GROUND_KINDS.length && Math.max(...grounds.values()) <= groundCap,
    "no ground dominates",
    `${grounds.size}/${GROUND_KINDS.length} grounds used, busiest carries ${Math.max(...grounds.values())} of ${templates.length} (cap ${groundCap})`);
  check(cws.size === COLOURWAYS.length && Math.max(...cws.values()) <= cwCap,
    "no colourway dominates",
    `${cws.size}/${COLOURWAYS.length} colourways used, busiest carries ${Math.max(...cws.values())} of ${templates.length} (cap ${cwCap})`);

  // A category built from one layout is one template with four sets of words,
  // which is what "blog is a product promo with different copy" looks like from
  // here — the exact criticism the rejected set earned.
  const thin: string[] = [];
  const byCat = new Map<string, TextTemplate[]>();
  for (const t of templates) byCat.set(t.category, [...(byCat.get(t.category) ?? []), t]);
  for (const [cat, ts] of byCat) {
    const ls = new Set(ts.map((t) => t.layout));
    const gs = new Set(ts.map((t) => t.ground));
    info(`${cat}: ${ts.length} templates, ${ls.size} layouts (${[...ls].join(", ")}), ${gs.size} grounds`);
    if (ls.size < 2) thin.push(`${cat} uses only ${[...ls].join(", ")}`);
  }
  check(thin.length === 0, "every category has a register of its own", thin.length
    ? thin.join("; ") : "every category spans at least two layouts and several grounds");
}

// ── Entry ─────────────────────────────────────────────────────────────────────

const mode = process.argv.includes("--matrix") ? "matrix" : process.argv.includes("--set") ? "set" : "all";
if (mode !== "set") runMatrix();
if (mode !== "matrix") runSet();
console.log(`\n${failures} failure(s), ${warnings} warning(s).`);
process.exit(failures === 0 ? 0 : 1);
