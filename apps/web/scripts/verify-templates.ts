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
  LAYOUTS, matrixFor, buildTemplate, PLACEHOLDER_COPY, headlinePct,
} from "../components/studio/edit/design/templates";
import { runReports, verifyFieldClaims, estWidthPct } from "../components/studio/edit/design/type";

const defects: string[] = [];
const warned: { key: string; worst: number; line: string }[] = [];
let cells = 0, clean = 0;
for (const l of LAYOUTS) {
  for (const { ground, cw } of matrixFor(l)) {
    cells++;
    const key = `${l.id}/${ground}/${cw.id}`;
    try {
      const t = buildTemplate(l, { cw, ground, copy: PLACEHOLDER_COPY });
      for (const p of verifyFieldClaims(t.layers, t.runs)) defects.push(`${key}: CLAIM ${p}`);
      for (const r of t.runs) if (r.on.kind === "photograph") defects.push(`${key}: BARE "${r.text}"`);
      for (const r of t.runs) if (r.xPct + estWidthPct(r) > 100.5 || r.xPct < -0.5) defects.push(`${key}: OVER "${r.text}" -> ${(r.xPct+estWidthPct(r)).toFixed(1)}`);
      if (headlinePct(t) === null) defects.push(`${key}: no headline run`);
      const reps = runReports(t.runs);
      const bad = reps.filter((r) => r.level === "warn");
      const meas = reps.filter((r) => r.ratio !== null).map((r) => r.ratio as number);
      if (bad.length) warned.push({ key, worst: Math.min(...meas), line: bad.map((b)=>`"${b.text}" ${b.ratio===null?"unbounded":b.ratio.toFixed(2)} on ${b.backdrop}`).join(" | ") });
      else clean++;
    } catch (e) { defects.push(`${key}: THREW ${String(e)}`); }
  }
}
console.log(`cells ${cells}  clean ${clean}  warned ${warned.length}  defects ${defects.length}`);
const uniq = [...new Set(defects.map(d => d.replace(/^[^:]+: /, "").slice(0,90)))];
console.log("\nDEFECT KINDS:"); uniq.slice(0,25).forEach(d=>console.log("  "+d));
console.log("\nDEFECT CELLS (first 30):"); defects.slice(0,30).forEach(d=>console.log("  "+d));
const byPair = new Map<string, number>();
for (const w of warned) { const [,g,c] = w.key.split("/"); const k = `${g}+${c}`; byPair.set(k,(byPair.get(k)??0)+1); }
console.log("\nWARN by ground+colourway (top 30):");
[...byPair.entries()].sort((a,b)=>b[1]-a[1]).slice(0,30).forEach(([k,n])=>console.log(`  ${k} x${n}`));
const byG = new Map<string, number>(); const byC = new Map<string, number>();
for (const w of warned) { const [,g,c] = w.key.split("/"); byG.set(g,(byG.get(g)??0)+1); byC.set(c,(byC.get(c)??0)+1); }
console.log("\nWARN by ground:", [...byG.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}:${n}`).join(" "));
console.log("WARN by colourway:", [...byC.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k}:${n}`).join(" "));
console.log("\nTIGHTEST 20:");
warned.sort((a,b)=>a.worst-b.worst).slice(0,20).forEach(w=>console.log(`  ${w.key} worst ${w.worst.toFixed(2)} :: ${w.line.slice(0,150)}`));
