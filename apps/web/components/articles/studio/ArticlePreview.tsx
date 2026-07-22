"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Hash } from "lucide-react";

/**
 * Reader's preview: renders the article the way it will land on the page —
 * a clean, centered editorial column with the display serif for the headline
 * and generous measure for the body. A safe, dependency-free Markdown subset
 * renderer (headings, emphasis, links, lists, quotes, inline code) turns the
 * live editor text into React nodes, so what the writer sees here is exactly
 * what ships. This is a read view, not an editor: nothing here is contentEditable.
 */

// ── Inline formatting: **bold**, *italic*, `code`, [text](url) — order matters. ──
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split on the first matching token, recursing on the remainder.
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
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
    if (tok.startsWith("**")) {
      nodes.push(<strong key={k} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(<code key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={k}>{tok.slice(1, -1)}</em>);
    } else {
      const label = tok.slice(1, tok.indexOf("]"));
      const url = tok.slice(tok.indexOf("](") + 2, -1);
      nodes.push(
        <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
          {label}
        </a>,
      );
    }
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

type Block = { type: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "quote"; lines: string[] };

function toBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const paras = md.split(/\n{2,}/);
  for (const raw of paras) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const lines = chunk.split("\n");
    const first = lines[0];
    if (/^#\s/.test(first)) blocks.push({ type: "h1", lines: [first.replace(/^#\s+/, "")] });
    else if (/^##\s/.test(first)) blocks.push({ type: "h2", lines: [first.replace(/^##\s+/, "")] });
    else if (/^###\s/.test(first)) blocks.push({ type: "h3", lines: [first.replace(/^###\s+/, "")] });
    else if (lines.every((l) => /^\s*[-*]\s+/.test(l))) blocks.push({ type: "ul", lines: lines.map((l) => l.replace(/^\s*[-*]\s+/, "")) });
    else if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) blocks.push({ type: "ol", lines: lines.map((l) => l.replace(/^\s*\d+\.\s+/, "")) });
    else if (/^>\s?/.test(first)) blocks.push({ type: "quote", lines: lines.map((l) => l.replace(/^>\s?/, "")) });
    else blocks.push({ type: "p", lines: [chunk.replace(/\n/g, " ")] });
  }
  return blocks;
}

interface ArticlePreviewProps {
  title: string;
  body: string;
  keyword?: string | null;
  metaDescription?: string | null;
}

export function ArticlePreview({ title, body, keyword, metaDescription }: ArticlePreviewProps) {
  const { t } = useTranslation();
  const blocks = useMemo(() => toBlocks(body || ""), [body]);
  const words = useMemo(() => (body || "").split(/\s+/).filter(Boolean).length, [body]);
  const minutes = Math.max(1, Math.ceil(words / 200));
  // The first H1 in the body is the article's own headline — don't repeat it below the header.
  const firstH1 = blocks.findIndex((b) => b.type === "h1");
  const displayTitle = title || (firstH1 >= 0 ? blocks[firstH1].lines[0] : t("articleStudio.preview.untitled"));
  const bodyBlocks = firstH1 >= 0 ? blocks.filter((_, i) => i !== firstH1) : blocks;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background px-5 py-10">
      <article className="mx-auto w-full max-w-[680px]">
        {/* Eyebrow: what this is + the reading cost, honestly stated. */}
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
          <span className="text-primary">{t("articleStudio.preview.eyebrow")}</span>
          <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" />{t("articleStudio.preview.readTime", { min: minutes })}</span>
          {keyword ? <span className="inline-flex items-center gap-1.5"><Hash className="h-3 w-3" />{keyword}</span> : null}
        </div>

        <h1 className="font-display text-[2.6rem] font-semibold leading-[1.1] tracking-tight text-foreground">
          {displayTitle}
        </h1>
        {metaDescription ? (
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{metaDescription}</p>
        ) : null}

        <div className="mt-8 h-px w-full bg-gradient-to-r from-border via-border to-transparent" />

        <div className="mt-8 flex flex-col gap-6">
          {bodyBlocks.length === 0 ? (
            <p className="text-muted-foreground">{t("articleStudio.preview.empty")}</p>
          ) : (
            bodyBlocks.map((b, i) => {
              const key = `b-${i}`;
              switch (b.type) {
                case "h1":
                case "h2":
                  return <h2 key={key} className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-foreground mt-2">{renderInline(b.lines[0], key)}</h2>;
                case "h3":
                  return <h3 key={key} className="font-display text-[1.3rem] font-semibold leading-snug text-foreground mt-1">{renderInline(b.lines[0], key)}</h3>;
                case "ul":
                  return (
                    <ul key={key} className="flex flex-col gap-2 pl-1">
                      {b.lines.map((l, j) => (
                        <li key={j} className="flex gap-3 text-[1.05rem] leading-[1.75] text-foreground/90">
                          <span className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{renderInline(l, `${key}-${j}`)}</span>
                        </li>
                      ))}
                    </ul>
                  );
                case "ol":
                  return (
                    <ol key={key} className="flex flex-col gap-2">
                      {b.lines.map((l, j) => (
                        <li key={j} className="flex gap-3 text-[1.05rem] leading-[1.75] text-foreground/90">
                          <span className="font-display text-sm font-semibold text-primary tabular-nums">{j + 1}.</span>
                          <span>{renderInline(l, `${key}-${j}`)}</span>
                        </li>
                      ))}
                    </ol>
                  );
                case "quote":
                  return (
                    <blockquote key={key} className="border-l-2 border-primary/50 pl-5 font-display text-xl italic leading-relaxed text-foreground/85">
                      {renderInline(b.lines.join(" "), key)}
                    </blockquote>
                  );
                default:
                  return <p key={key} className="text-[1.05rem] leading-[1.85] text-foreground/90">{renderInline(b.lines[0], key)}</p>;
              }
            })
          )}
        </div>
      </article>
    </div>
  );
}
