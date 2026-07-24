/** Print a deliverable, so the browser can save it as PDF.
 *
 *  There is no PDF library in the project and adding one for a single export
 *  is not worth the dependency: every browser can already render to PDF from
 *  the print dialog, and doing it this way keeps the rendered formatting --
 *  headings, tables, links -- exactly as shown on screen.
 */
export function printDocument(title: string, html: string): void {
  const frame = document.createElement("iframe");
  // Off-screen rather than hidden: a display:none frame does not paint, and
  // some browsers then print a blank page.
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    document.body.removeChild(frame);
    return;
  }

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font: 11pt/1.55 Georgia, "Times New Roman", serif; color: #1a1a1a; }
  h1 { font-size: 18pt; margin: 0 0 4mm; }
  .meta { font-size: 9pt; color: #666; margin-bottom: 8mm;
          border-bottom: 1px solid #ddd; padding-bottom: 3mm; }
  h2, h3, .md-h { font-family: Georgia, serif; margin: 6mm 0 2mm; }
  h2 { font-size: 13pt; } h3 { font-size: 11.5pt; }
  p, li { font-size: 10.5pt; }
  ul, ol { margin: 0 0 3mm 6mm; padding: 0; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm;
          font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 2mm 2.5mm; text-align: left;
           vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; }
  a { color: #1a1a1a; text-decoration: underline; }
  /* A URL is worthless on paper unless it is written out. */
  a::after { content: " (" attr(href) ")"; font-size: 8.5pt; color: #666; }
  h2, h3 { page-break-after: avoid; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(new Date().toLocaleDateString())} &middot; Fennex</div>
${html}
</body></html>`);
  doc.close();

  const cleanup = () => setTimeout(() => frame.remove(), 500);
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      cleanup();
    }
  };
  // Some browsers fire load before write completes; nudge it either way.
  if (doc.readyState === "complete") frame.onload?.(new Event("load") as never);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
