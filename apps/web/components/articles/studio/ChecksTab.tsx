"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  CheckCircle2, AlertTriangle, XCircle, Wand2, ShieldCheck, ExternalLink,
  Search, Gauge, FileSearch,
} from "lucide-react";
import {
  runArticleChecks,
  runPlagiarismScan,
  transformText,
  ApiError,
  type SeoCheck,
  type AiPatternReport,
  type PlagiarismReport,
} from "@/lib/api";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { useToast } from "@/components/ui/Toast";

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function StatusIcon({ status }: { status: SeoCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-success shrink-0" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-warning shrink-0" />;
  return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
}

function SectionLabel({ icon: Icon, children }: { icon: typeof Search; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <p className="text-xs font-semibold text-foreground">{children}</p>
    </div>
  );
}

interface HumanizeState {
  sentence: string;
  suggestion: string;
}

interface ChecksTabProps {
  articleId: string;
  body: string;
  onBodyChange: (val: string, highlight?: { start: number; end: number }) => void;
}

/**
 * SEO checklist + AI-pattern score + plagiarism scan. Three independently
 * triggered, clearly-sectioned tools in the Dune dock's Checks tab.
 */
export function ChecksTab({ articleId, body, onBodyChange }: ChecksTabProps) {
  const { t } = useTranslation();
  const { error: toastError } = useToast();

  const [checksLoading, setChecksLoading] = useState(false);
  const [seo, setSeo] = useState<SeoCheck[] | null>(null);
  const [ai, setAi] = useState<AiPatternReport | null>(null);

  const [humanizing, setHumanizing] = useState<string | null>(null);
  const [humanized, setHumanized] = useState<Record<string, HumanizeState>>({});

  const [scanLoading, setScanLoading] = useState(false);
  const [plagiarism, setPlagiarism] = useState<PlagiarismReport | null>(null);
  const [providerGate, setProviderGate] = useState(false);

  async function handleRunChecks() {
    setChecksLoading(true);
    setHumanized({});
    try {
      const result = await runArticleChecks(articleId);
      setSeo(result.seo);
      setAi(result.ai);
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecksLoading(false);
    }
  }

  async function handleScanOriginality() {
    setScanLoading(true);
    setProviderGate(false);
    setPlagiarism(null);
    try {
      const result = await runPlagiarismScan(articleId);
      setPlagiarism(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setProviderGate(true);
      } else {
        toastError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setScanLoading(false);
    }
  }

  async function handleHumanize(sentence: string) {
    setHumanizing(sentence);
    try {
      const result = await transformText(articleId, "humanize", sentence);
      setHumanized((prev) => ({ ...prev, [sentence]: { sentence, suggestion: result.text } }));
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setHumanizing(null);
    }
  }

  function handleReplace(sentence: string) {
    const state = humanized[sentence];
    if (!state) return;
    if (!body.includes(state.sentence)) {
      toastError(t("articleStudio.checks.stale"));
      setHumanized((prev) => {
        const next = { ...prev };
        delete next[sentence];
        return next;
      });
      return;
    }
    const idx = body.indexOf(state.sentence);
    onBodyChange(
      body.replace(state.sentence, state.suggestion),
      idx === -1 ? undefined : { start: idx, end: idx + state.suggestion.length },
    );
    setHumanized((prev) => {
      const next = { ...prev };
      delete next[sentence];
      return next;
    });
  }

  function handleDiscard(sentence: string) {
    setHumanized((prev) => {
      const next = { ...prev };
      delete next[sentence];
      return next;
    });
  }

  const passing = seo ? seo.filter((c) => c.status === "pass").length : 0;
  const scoreTone = ai
    ? ai.score >= 80
      ? "text-success"
      : ai.score >= 55
        ? "text-warning"
        : "text-destructive"
    : "text-foreground";

  return (
    <div className="flex flex-col gap-6">
      {/* ── Run checks ── */}
      <div className="flex flex-col gap-3">
        {!seo && !ai && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("articleStudio.checks.runHint")}
          </p>
        )}
        <button
          onClick={handleRunChecks}
          disabled={checksLoading}
          className="btn-primary flex items-center justify-center gap-2 px-3 py-2 text-xs disabled:opacity-60"
        >
          {checksLoading ? <Spinner size={13} /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {t("articleStudio.checks.run")}
        </button>

        {seo && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-3">
            <div className="flex items-center justify-between">
              <SectionLabel icon={Search}>{t("articleStudio.checks.seoTitle")}</SectionLabel>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {t("articleStudio.checks.passing", { count: passing, total: seo.length })}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {seo.map((row) => (
                <div key={row.id} className="flex items-start gap-2">
                  <StatusIcon status={row.status} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">
                      {t(`articleStudio.checks.rules.${row.id}`)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{row.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {ai && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-3">
            <SectionLabel icon={Gauge}>{t("articleStudio.checks.aiTitle")}</SectionLabel>
            <div className="flex flex-col items-center gap-2 pt-1">
              <ProgressRing value={ai.score} size={104} stroke={8}>
                <span className={`text-xl font-bold tabular-nums ${scoreTone}`}>{Math.round(ai.score)}</span>
                <span className="text-[10px] text-muted-foreground">/ 100</span>
              </ProgressRing>
              <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
                {t("articleStudio.checks.heuristic")}
              </p>
            </div>

            {ai.signals.length > 0 && (
              <div className="flex w-full flex-col gap-1.5 border-t border-border pt-2">
                {ai.signals.map((sig) => (
                  <div key={sig.id} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning mt-0.5" />
                    <span className="text-muted-foreground">{sig.detail}</span>
                  </div>
                ))}
              </div>
            )}

            {ai.flagged.length > 0 && (
              <div className="flex w-full flex-col gap-2 border-t border-border pt-2">
                {ai.flagged.map((flag) => {
                  const state = humanized[flag.sentence];
                  return (
                    <div key={flag.sentence} className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-2.5">
                      <p className="whitespace-pre-wrap text-xs text-foreground">{flag.sentence}</p>
                      <p className="text-[11px] text-muted-foreground">{flag.reason}</p>

                      {state ? (
                        <div className="flex flex-col gap-1.5 rounded-lg border border-primary/40 bg-card p-2">
                          <p className="whitespace-pre-wrap text-xs text-foreground">{state.suggestion}</p>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleDiscard(flag.sentence)}
                              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
                            >
                              {t("articleStudio.checks.discard")}
                            </button>
                            <button
                              onClick={() => handleReplace(flag.sentence)}
                              className="btn-primary px-2.5 py-1 text-[11px]"
                            >
                              {t("articleStudio.checks.replace")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleHumanize(flag.sentence)}
                          disabled={humanizing === flag.sentence}
                          className="flex self-start items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                        >
                          {humanizing === flag.sentence ? <Spinner size={11} /> : <Wand2 className="h-3 w-3" />}
                          {t("articleStudio.checks.humanize")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Originality ── */}
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <SectionLabel icon={FileSearch}>{t("articleStudio.checks.plagiarismTitle")}</SectionLabel>
        <button
          onClick={handleScanOriginality}
          disabled={scanLoading}
          className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
        >
          {scanLoading ? <Spinner size={13} /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {t("articleStudio.checks.scan")}
        </button>

        {providerGate && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-4 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileSearch className="h-4 w-4" />
            </span>
            <p className="text-xs font-semibold text-foreground">{t("articleStudio.checks.gate.title")}</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("articleStudio.checks.gate.body")}
            </p>
            <Link
              href="/settings"
              className="btn-primary mt-1 px-3 py-1.5 text-[11px]"
            >
              {t("articleStudio.checks.gate.cta")}
            </Link>
          </div>
        )}

        {plagiarism && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-muted-foreground">
              {t("articleStudio.checks.checked", { count: plagiarism.checked })}
            </p>
            {plagiarism.matches.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                <p className="text-xs text-foreground">{t("articleStudio.checks.original")}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {plagiarism.matches.map((match, i) => (
                  <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-2.5">
                    <p className="line-clamp-3 text-xs text-foreground">{match.sentence}</p>
                    <div className="flex flex-col gap-0.5">
                      {match.urls.slice(0, 3).map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 truncate text-[11px] text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{url}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
