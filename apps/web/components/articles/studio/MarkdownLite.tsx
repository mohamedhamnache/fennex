"use client";

import { useMemo } from "react";

/**
 * A compact, dependency-free Markdown renderer for Dune's chat replies. Handles
 * the subset the assistant actually emits — bold, italic, inline code, links,
 * bullet/numbered lists, and paragraphs — so a reply reads as formatted text
 * instead of raw `**` and `-`. Streaming-safe: partial/unclosed tokens simply
 * render as plain text until the closing token arrives. Read-only, never editable.
 */

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
  let rest = text;
  let i = 0;
  while (rest.length) {
    const m = rest.match(pattern);
    if (!m || m.index === undefined) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) nodes.push(<strong key={k} className="font-semibold">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("*")) nodes.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else {
      const label = tok.slice(1, tok.indexOf("]"));
      const url = tok.slice(tok.indexOf("](") + 2, -1);
      nodes.push(
        <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline decoration-primary/40 underline-offset-2">
          {label}
        </a>,
      );
    }
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks = useMemo(() => (text || "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean), [text]);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi} className="flex flex-col gap-1">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
                  <span>{renderInline(l.replace(/^\s*[-*]\s+/, ""), `${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
          return (
            <ol key={bi} className="flex flex-col gap-1">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="shrink-0 font-semibold tabular-nums opacity-70">{li + 1}.</span>
                  <span>{renderInline(l.replace(/^\s*\d+\.\s+/, ""), `${bi}-${li}`)}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (/^#{1,3}\s/.test(lines[0])) {
          return <p key={bi} className="font-semibold text-foreground">{renderInline(lines[0].replace(/^#{1,3}\s+/, ""), `${bi}`)}</p>;
        }
        return <p key={bi}>{renderInline(block.replace(/\n/g, " "), `${bi}`)}</p>;
      })}
    </div>
  );
}
