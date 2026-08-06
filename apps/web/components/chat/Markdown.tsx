"use client";

import { Fragment } from "react";

import { ChatChart, parseChartSpec } from "./ChatChart";

/** A focused markdown renderer for employee deliverables.
 *
 *  Reports and plans arrive as markdown with headings, tables, lists and links
 *  — rendering them as raw text is what made a market report unreadable in the
 *  chat. This covers exactly that subset rather than pulling in a full parser
 *  and its dependency tree.
 */
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  // Formatted from the first token, never raw-then-formatted. Rendering plain
  // text while streaming and swapping to markdown at the end made the reader
  // watch a bad version turn into a good one -- "##" and "**" on screen, then
  // a snap. Only the trailing INCOMPLETE construct is withheld: a half-typed
  // table row or an unterminated ``` fence would otherwise reflow on every
  // token, or swallow the rest of the answer into a code block.
  return <div className="chat-md">{renderBlocks(streaming ? trimPartial(text) : text)}</div>;
}

/** Drop the last block while it is still arriving. */
function trimPartial(text: string): string {
  const lines = (text || "").split("\n");
  // An odd number of ``` fences means one is still open: hide from it onward,
  // so a chart's JSON is never shown as raw text on its way in.
  let open = -1;
  let fences = 0;
  lines.forEach((l, i) => {
    if (l.trim().startsWith("```")) { fences += 1; if (fences % 2 === 1) open = i; }
  });
  if (fences % 2 === 1 && open >= 0) return lines.slice(0, open).join("\n");
  // A table whose separator row has not arrived yet is not a table.
  const last = lines[lines.length - 1]?.trim() ?? "";
  if (last.startsWith("|") && lines.length >= 2) {
    const prev = lines[lines.length - 2].trim();
    if (prev.startsWith("|") && !/^\|[\s:|-]+\|?$/.test(last)) return lines.join("\n");
    return lines.slice(0, -1).join("\n");
  }
  return text;
}

function renderBlocks(text: string) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(
      <p key={`p-${out.length}`} className="mb-2 text-xs leading-relaxed text-foreground">
        {inline(paragraph.join(" "))}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={`l-${out.length}`} className={`mb-2 ml-4 flex flex-col gap-1 text-xs leading-relaxed text-foreground ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((item, i) => <li key={i}>{inline(item)}</li>)}
      </Tag>,
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      // A blank line does NOT end a list when the next content line continues
      // it. Markdown calls that a loose list and models write them constantly;
      // breaking on the blank line started a fresh <ol> per item, so a
      // numbered list rendered as "1." over and over.
      const next = lines.slice(i + 1).find((l) => l.trim());
      const continues = next !== undefined && list !== null
        && (list.ordered ? /^\d+[.)]\s+/ : /^[-*+]\s+/).test(next.trim());
      if (!continues) flushList();
      continue;
    }

    // ```chart — a small JSON spec an agent asked to be drawn. Handled before
    // any other block so its JSON is never mistaken for a table or a list.
    if (trimmed.startsWith("```chart")) {
      flushParagraph(); flushList();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      const spec = parseChartSpec(body.join("\n"));
      // A malformed spec renders as nothing rather than as raw JSON: the
      // reader gains nothing from seeing the agent's failed attempt, and the
      // prose around it still carries the point.
      if (spec) out.push(<ChatChart key={`c-${out.length}`} spec={spec} />);
      continue;
    }

    // > callout — the one line the reader must not miss. Agents mark at most
    // one per answer; the styling is what makes that restraint worth having.
    if (trimmed.startsWith("> ")) {
      flushParagraph(); flushList();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quote.push(lines[i].trim().slice(2));
        i += 1;
      }
      i -= 1;
      out.push(
        <p key={`q-${out.length}`}
           className="mb-3 flex gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs font-medium leading-relaxed text-foreground">
          <span aria-hidden className="mt-0.5 h-4 w-0.5 shrink-0 rounded-full bg-primary" />
          <span>{inline(quote.join(" "))}</span>
        </p>,
      );
      continue;
    }

    // A table needs its separator row to be a table at all.
    if (trimmed.startsWith("|") && /^\|[\s:|-]+\|?$/.test((lines[i + 1] ?? "").trim())) {
      flushParagraph(); flushList();
      const header = cells(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(cells(lines[i].trim()));
        i += 1;
      }
      i -= 1;
      out.push(
        <div key={`t-${out.length}`} className="mb-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-muted/50">
                {header.map((h, hi) => (
                  <th key={hi} className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold text-foreground">
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-t border-border">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2.5 py-1.5 align-top text-muted-foreground">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(); flushList();
      const level = heading[1].length;
      out.push(
        <p
          key={`h-${out.length}`}
          className={
            level <= 2
              ? "mb-1.5 mt-3 font-display text-sm font-bold text-foreground first:mt-0"
              : "mb-1 mt-2.5 text-xs font-bold text-foreground first:mt-0"
          }
        >
          {inline(heading[2])}
        </p>,
      );
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph(); flushList();
      out.push(<hr key={`hr-${out.length}`} className="my-3 border-border" />);
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return out;
}

function cells(row: string): string[] {
  return row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

/** Bold, italic, inline code and links. */
function inline(text: string): React.ReactNode {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  const parts = text.split(pattern).filter(Boolean);

  return parts.map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80"
        >
          {link[1]}
        </a>
      );
    }
    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
      const value = part.slice(2, -2);
      // A figure gets a chip; an emphasised word just gets weight. Highlighting
      // every bold phrase would be the same as highlighting none.
      const isFigure = /[\d]/.test(value) && value.length <= 24;
      return (
        <strong
          key={i}
          className={
            isFigure
              ? "rounded bg-primary/10 px-1 py-0.5 font-semibold tabular-nums text-primary"
              : "font-semibold text-foreground"
          }
        >
          {value}
        </strong>
      );
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** The same markdown, as an HTML string.
 *
 *  The on-screen renderer returns React, which cannot be handed to a print
 *  window. This mirrors the same subset so a printed report matches what was
 *  displayed rather than being a second, drifting implementation.
 */
export function markdownToHtml(text: string): string {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inlineHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    out.push(`<${tag}>${list.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${tag}>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      flushParagraph();
      // A blank line does NOT end a list when the next content line continues
      // it. Markdown calls that a loose list and models write them constantly;
      // breaking on the blank line started a fresh <ol> per item, so a
      // numbered list rendered as "1." over and over.
      const next = lines.slice(i + 1).find((l) => l.trim());
      const continues = next !== undefined && list !== null
        && (list.ordered ? /^\d+[.)]\s+/ : /^[-*+]\s+/).test(next.trim());
      if (!continues) flushList();
      continue;
    }

    if (trimmed.startsWith("|") && /^\|[\s:|-]+\|?$/.test((lines[i + 1] ?? "").trim())) {
      flushParagraph(); flushList();
      const header = splitCells(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitCells(lines[i].trim()));
        i += 1;
      }
      i -= 1;
      out.push(
        `<table><thead><tr>${header.map((h) => `<th>${inlineHtml(h)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(); flushList();
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushParagraph(); flushList();
      out.push("<hr />");
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return out.join("\n");
}

function splitCells(row: string): string[] {
  return row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function inlineHtml(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return html;
}
