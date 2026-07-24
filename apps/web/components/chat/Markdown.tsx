"use client";

import { Fragment } from "react";

/** A focused markdown renderer for employee deliverables.
 *
 *  Reports and plans arrive as markdown with headings, tables, lists and links
 *  — rendering them as raw text is what made a market report unreadable in the
 *  chat. This covers exactly that subset rather than pulling in a full parser
 *  and its dependency tree.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="chat-md">{renderBlocks(text)}</div>;
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

    if (!trimmed) { flushParagraph(); flushList(); continue; }

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
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
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
