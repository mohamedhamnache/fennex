"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, ExternalLink, Check, Search } from "lucide-react";
import { findInternalLinks, type InternalLinkSuggestion } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

interface LinksTabProps {
  articleId: string;
  body: string;
  onBodyChange: (val: string) => void;
}

const MD_LINK_RE = /\[[^\]]*\]\([^)]*\)/g;

/** Replace the first occurrence of `phrase` outside existing markdown links. */
function linkify(body: string, phrase: string, url: string): string | null {
  const spans: { s: number; e: number }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MD_LINK_RE.source, "g");
  while ((m = re.exec(body))) spans.push({ s: m.index, e: m.index + m[0].length });
  const lower = body.toLowerCase();
  const needle = phrase.toLowerCase();
  let from = 0;
  for (;;) {
    const i = lower.indexOf(needle, from);
    if (i < 0) return null;
    if (!spans.some(({ s, e }) => s <= i && i < e)) {
      const exact = body.slice(i, i + phrase.length);
      return body.slice(0, i) + `[${exact}](${url})` + body.slice(i + phrase.length);
    }
    from = i + 1;
  }
}

/**
 * Internal linking assistant: deterministic opportunities to link this draft
 * to the project's other PUBLISHED articles (live URLs only). One click wraps
 * the first unlinked occurrence in a markdown link.
 */
export function LinksTab({ articleId, body, onBodyChange }: LinksTabProps) {
  const { t } = useTranslation();
  const { success: toastSuccess, error: toastError } = useToast();

  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<InternalLinkSuggestion[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  async function handleFind() {
    setLoading(true);
    setAdded(new Set());
    try {
      const result = await findInternalLinks(articleId, body);
      setSuggestions(result.suggestions);
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleAdd(s: InternalLinkSuggestion) {
    const next = linkify(body, s.phrase, s.url);
    if (next === null) {
      toastError(t("articleStudio.links.stale"));
      return;
    }
    onBodyChange(next);
    setAdded((prev) => new Set(prev).add(s.article_id));
    toastSuccess(t("articleStudio.links.added"));
  }

  return (
    <div className="flex flex-col gap-3">
      {suggestions === null && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("articleStudio.links.hint")}
        </p>
      )}
      <button
        onClick={handleFind}
        disabled={loading}
        className="btn-primary flex items-center justify-center gap-2 px-3 py-2 text-xs disabled:opacity-60"
      >
        {loading ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
        ) : (
          <Search className="h-3.5 w-3.5" />
        )}
        {t("articleStudio.links.find")}
      </button>

      {suggestions !== null && suggestions.length === 0 && (
        <div className="rounded-xl border border-border bg-card/40 p-3 text-center">
          <p className="text-xs text-muted-foreground">{t("articleStudio.links.empty")}</p>
        </div>
      )}

      {suggestions !== null && suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => {
            const isAdded = added.has(s.article_id);
            return (
              <div key={s.article_id} className="flex flex-col gap-1.5 rounded-xl border border-border bg-card/40 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-xs font-medium text-foreground">
                    <Link2 className="mr-1 inline h-3 w-3 text-primary" />
                    {s.phrase}
                  </p>
                </div>
                <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {"…"}{s.snippet}{"…"}
                </p>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 truncate text-[11px] text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{s.title}</span>
                </a>
                {isAdded ? (
                  <span className="flex items-center gap-1.5 self-start rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
                    <Check className="h-3 w-3" />
                    {t("articleStudio.links.added")}
                  </span>
                ) : (
                  <button
                    onClick={() => handleAdd(s)}
                    className="btn-primary flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px]"
                  >
                    <Link2 className="h-3 w-3" />
                    {t("articleStudio.links.add")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
