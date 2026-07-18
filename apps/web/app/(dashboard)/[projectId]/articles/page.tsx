"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  PanelLeft,
  PanelRight,
  ArrowLeft,
  Send,
  BookOpen,
  PenLine,
  Eye,
  List,
  Maximize2,
  Minimize2,
  Download,
  Copy,
} from "lucide-react";
import { useProjectStore } from "@/lib/store";
import {
  listArticles,
  getArticle,
  createArticle,
  updateArticle,
  deleteArticle,
  generateArticle,
  generateArticleStream,
  saveRevision,
  getArticleSeoScore,
  listPublishingConnections,
  publishArticle,
  listApiKeys,
  type Article,
  type SEOScoreBreakdown,
  type PublishingConnection,
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { RevisionsRail } from "@/components/articles/studio/RevisionsRail";
import { StatsBar } from "@/components/articles/studio/StatsBar";
import { DuneDock } from "@/components/articles/studio/DuneDock";
import { ArticlesOverview } from "@/components/articles/studio/ArticlesOverview";
import { RichEditor, type RichEditorHandle } from "@/components/articles/studio/RichEditor";
import { ImageSuggestionsPanel } from "@/components/articles/ImageSuggestionsPanel";

// ─── Provider/Model options ────────────────────────────────────────────────

const PROVIDER_MODELS: Record<string, { label: string; models: { id: string; label: string }[] }> = {
  anthropic: {
    label: "Anthropic",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
  },
  google: {
    label: "Google",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
};

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  generating: "warning",
  ready: "info",
  published: "success",
  failed: "danger",
};

const TONES = [
  "professional",
  "conversational",
  "authoritative",
  "friendly",
  "technical",
  "inspirational",
] as const;

const WORD_COUNTS = [800, 1200, 1500, 2000, 2500] as const;

/** Content-template ids shared with the backend's TEMPLATE_BRIEFS. */
const TEMPLATES = ["howto", "listicle", "comparison", "roundup", "casestudy"] as const;
type TemplateId = (typeof TEMPLATES)[number];

// ─── Spinner ───────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
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

// ─── Export helpers ────────────────────────────────────────────────────────

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "article"
  );
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── New Article Modal ─────────────────────────────────────────────────────

function NewArticleModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (article: Article, template: TemplateId | null) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState<string>("professional");
  const [wordCount, setWordCount] = useState<number>(1200);
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [phase, setPhase] = useState<"form" | "generating">("form");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setPhase("generating");

    try {
      const article = await createArticle({
        project_id: projectId,
        title: title.trim(),
        ...(keyword.trim() ? { target_keyword: keyword.trim() } : {}),
        tone,
        word_count_target: wordCount,
      });
      // Open the editor immediately - Dune streams the article in live there.
      onCreated(article, template);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("form");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{t("articles.newArticleModal.title")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("articles.newArticleModal.hint")}
          </p>
        </div>

        {phase === "generating" ? (
          <div className="p-10 flex flex-col items-center gap-4">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Spinner size={28} />
            </div>
            <p className="text-sm font-medium text-foreground">Dune is writing your article…</p>
            <p className="text-xs text-muted-foreground text-center">
              {t("articles.newArticleModal.generatingHint")}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
            {error && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("articles.newArticleModal.titleLabel")} <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("articles.newArticleModal.titlePlaceholder")}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("articles.newArticleModal.keyword")}
              </label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t("articles.newArticleModal.keywordPlaceholder")}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t("articles.newArticleModal.tone")}</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {TONES.map((toneOpt) => (
                  <option key={toneOpt} value={toneOpt}>
                    {toneOpt.charAt(0).toUpperCase() + toneOpt.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("articleStudio.templates.label")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTemplate(null)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    template === null
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {t("articleStudio.templates.none")}
                </button>
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setTemplate(tpl)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      template === tpl
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    {t(`articleStudio.templates.${tpl}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("articles.newArticleModal.wordCount")}
              </label>
              <select
                value={wordCount}
                onChange={(e) => setWordCount(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {WORD_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()} {t("articles.editor.words")}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                {t("articles.newArticleModal.cancel")}
              </button>
              <button
                type="submit"
                disabled={!title.trim()}
                className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("articles.newArticleModal.create")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Publish Modal ─────────────────────────────────────────────────────────

function PublishModal({
  articleId,
  projectId,
  onClose,
}: {
  articleId: string;
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [connectionId, setConnectionId] = useState("");
  const [publishStatus, setPublishStatus] = useState<"draft" | "publish">("publish");
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: connections = [], isLoading: connectionsLoading } = useQuery<PublishingConnection[]>({
    queryKey: ["publishing-connections", projectId],
    queryFn: () => listPublishingConnections(projectId),
  });

  useEffect(() => {
    if (connections.length > 0 && !connectionId) {
      setConnectionId(connections[0].id);
    }
  }, [connections, connectionId]);

  const publishMutation = useMutation({
    mutationFn: () =>
      publishArticle({ article_id: articleId, connection_id: connectionId, publish_status: publishStatus }),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["article", articleId] });
      queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
      queryClient.invalidateQueries({ queryKey: ["publish-jobs", projectId] });
      setResult({ url: job.published_url ?? "" });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Publishing failed");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">{t("articles.publishModal.title")}</h2>
        </div>

        <div className="p-6 flex flex-col gap-4">
          {errorMsg && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {errorMsg}
            </p>
          )}

          {result !== null ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">{t("articles.publishModal.publishedSuccess")}</p>
                {result.url && (
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    {t("articles.publishModal.viewPost")}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <button onClick={onClose} className="btn-primary px-6 py-2 text-sm">
                {t("articles.publishModal.done")}
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  {t("articles.publishModal.chooseConnection")}
                </label>
                {connectionsLoading ? (
                  <p className="text-sm text-muted-foreground">{t("articles.publishModal.loadingConnections")}</p>
                ) : connections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("articles.publishModal.noConnections")}
                  </p>
                ) : (
                  <select
                    value={connectionId}
                    onChange={(e) => setConnectionId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.platform})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("articles.publishModal.publishAs")}
                </label>
                <div className="flex gap-4">
                  {(["draft", "publish"] as const).map((opt) => (
                    <label key={opt} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="publish_status"
                        value={opt}
                        checked={publishStatus === opt}
                        onChange={() => setPublishStatus(opt)}
                        className="accent-primary"
                      />
                      <span className="text-sm text-foreground capitalize">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending || !connectionId || connections.length === 0}
                  className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {publishMutation.isPending ? (
                    <>
                      <Spinner size={14} /> {t("common.publishing")}
                    </>
                  ) : (
                    t("articles.publishModal.publishNow")
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Article Editor ────────────────────────────────────────────────────────

function ArticleEditor({
  articleId,
  projectId,
  onShowDocuments,
  onShowAssistantPanel,
  onBackToOverview,
  onNewArticle,
  dockMobileOpen,
  onCloseDockMobile,
  railMobileOpen,
  onCloseRailMobile,
  streamOnLoad = false,
  streamTemplate = null,
  onStreamStarted,
}: {
  articleId: string;
  projectId: string;
  onShowDocuments: () => void;
  onShowAssistantPanel: () => void;
  onBackToOverview: () => void;
  onNewArticle: () => void;
  dockMobileOpen: boolean;
  onCloseDockMobile: () => void;
  railMobileOpen: boolean;
  onCloseRailMobile: () => void;
  streamOnLoad?: boolean;
  streamTemplate?: TemplateId | null;
  onStreamStarted?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { success, error } = useToast();

  const { data: article, isLoading } = useQuery<Article>({
    queryKey: ["article", articleId],
    queryFn: () => getArticle(articleId),
    refetchInterval: (query) => query.state.data?.status === "generating" ? 3000 : false,
  });

  const { data: seoData, refetch: refetchSeo } = useQuery<SEOScoreBreakdown>({
    queryKey: ["article-seo", articleId],
    queryFn: () => getArticleSeoScore(articleId),
    enabled: !!articleId && (article?.status === "ready" || article?.status === "published"),
  });

  const [body, setBody] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [metaTitle, setMetaTitle] = useState<string>("");
  const [metaDesc, setMetaDesc] = useState<string>("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [revisionMsg, setRevisionMsg] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showImageSuggestions, setShowImageSuggestions] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [typing, setTyping] = useState(false);
  const [preEditBody, setPreEditBody] = useState<string | null>(null);
  const [showingChanges, setShowingChanges] = useState(false);
  const [changedCount, setChangedCount] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typewriterRef = useRef<HTMLDivElement | null>(null);
  const initialized = useRef(false);
  const prevStatusRef = useRef<string | null>(null);
  const richRef = useRef<RichEditorHandle | null>(null);

  const { data: apiKeys = [] } = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  });

  const connectedProviders = [...new Set(apiKeys.map((k) => k.provider))].filter(
    (p) => p in PROVIDER_MODELS,
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    };
  }, []);

  // Reveal text word-by-word (Gemini-style: each word fades + de-blurs in) when
  // Dune finishes generating. Plays in a plain overlay; the rich editor takes
  // over with the final content once the reveal lands.
  function playTypewriter(text: string) {
    if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    initialized.current = true;
    setTyping(true);
    setBody("");
    const tokens = text.match(/\S+\s*/g) ?? [];
    const total = tokens.length;
    const perTick = Math.max(1, Math.ceil(total / 90)); // ~90 steps -> ~2.7s
    let i = 0;
    typingTimerRef.current = setInterval(() => {
      i += perTick;
      if (i >= total) {
        setBody(text);
        setTyping(false);
        if (typingTimerRef.current) clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
        return;
      }
      setBody(tokens.slice(0, i).join(""));
      const el = typewriterRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 30);
  }

  // TRUE token streaming: Dune writes the article live into the overlay, then
  // the final parsed result (persisted server-side) lands in the rich editor.
  async function runStreamingGeneration(template?: TemplateId | null) {
    if (generating) return;
    setGenerating(true);
    setPolishing(false);
    initialized.current = true;
    if (typingTimerRef.current) clearInterval(typingTimerRef.current);
    setTyping(false);
    setBody("");
    try {
      const result = await generateArticleStream(
        articleId,
        {
          ...(selectedProvider && selectedModel
            ? { provider: selectedProvider, model: selectedModel }
            : {}),
          ...(template ? { template } : {}),
        },
        (chunk) => {
          setBody((prev) => prev + chunk);
          const el = typewriterRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        },
        (status) => {
          if (status === "polishing") setPolishing(true);
        },
      );
      setBody(result.body_markdown);
      setMetaTitle(result.meta_title ?? "");
      setMetaDesc(result.meta_description ?? "");
      queryClient.invalidateQueries({ queryKey: ["article", articleId] });
      queryClient.invalidateQueries({ queryKey: ["article-seo", articleId] });
      queryClient.invalidateQueries({ queryKey: ["article-revisions", articleId] });
      queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
      success(t("articles.toast.regenerated"));
    } catch (e) {
      error(e instanceof Error ? e.message : String(e));
      queryClient.invalidateQueries({ queryKey: ["article", articleId] });
    } finally {
      setGenerating(false);
      setPolishing(false);
    }
  }

  // A freshly created article streams in as soon as the editor opens.
  useEffect(() => {
    if (streamOnLoad) {
      onStreamStarted?.();
      runStreamingGeneration(streamTemplate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!article) return;
    const justFinishedGenerating =
      prevStatusRef.current === "generating" && article.status !== "generating";
    prevStatusRef.current = article.status;

    if (!initialized.current || justFinishedGenerating) {
      initialized.current = true;
      setTitle(article.title);
      setMetaTitle(article.meta_title ?? "");
      setMetaDesc(article.meta_description ?? "");
      const text = article.body_markdown ?? "";
      if (justFinishedGenerating && text.length > 0) {
        // Worker-generated (campaigns / overview regenerate): replay the reveal.
        playTypewriter(text);
      } else {
        setBody(text);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article]);

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateArticle>[1]) =>
      updateArticle(articleId, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(["article", articleId], updated);
      // Every edit shifts the SEO score: recompute it (editor chip + Meta tab)
      // and refresh the overview cards so they match.
      queryClient.invalidateQueries({ queryKey: ["article-seo", articleId] });
      queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    },
    onError: () => { setSaveState("idle"); error(t("articles.toast.saveError")); },
  });

  const revisionMutation = useMutation({
    mutationFn: () => saveRevision(articleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["article-revisions", articleId] });
      setRevisionMsg(t("articles.toast.revisionSaved"));
      setTimeout(() => setRevisionMsg(null), 2500);
    },
    onError: () => error(t("articles.toast.revisionError")),
  });

  function handleRestore(revisionBody: string) {
    // setMarkdown emits an update -> onChange -> handleBodyChange -> autosave.
    richRef.current?.setMarkdown(revisionBody);
    success(t("articleStudio.restored"));
  }

  function handleCompareRevision(revisionBody: string) {
    // Highlight everything in the current draft that differs from that
    // revision; the revision becomes the diff base for the Show changes toggle.
    const n = richRef.current?.highlightChanges(revisionBody) ?? 0;
    if (n > 0) {
      setPreEditBody(revisionBody);
      setChangedCount(n);
      setShowingChanges(true);
    } else {
      error(t("articleStudio.noChanges"));
    }
  }

  function handleApplyRevision(markdown: string) {
    // Guard against a fragment replacing the whole article: if Dune returned
    // something far shorter than the current draft, confirm before applying.
    const oldWords = body.trim().split(/\s+/).filter(Boolean).length;
    const newWords = markdown.trim().split(/\s+/).filter(Boolean).length;
    if (oldWords > 150 && newWords < oldWords * 0.5) {
      if (!window.confirm(t("articleStudio.assistant.shrinkWarn"))) return;
    }
    // Safety net: snapshot the pre-apply state as an automatic revision so the
    // edit is always one Restore away.
    saveRevision(articleId, "auto:dune-apply")
      .then(() => queryClient.invalidateQueries({ queryKey: ["article-revisions", articleId] }))
      .catch(() => undefined);
    // Remember the pre-edit body (so the change can be reviewed later), apply
    // it, and flash the changed blocks; setContent autosaves + recomputes SEO.
    setPreEditBody(body);
    setShowingChanges(false);
    richRef.current?.applyWithDiff(markdown, body);
  }

  function handleApplyMeta(title: string | null, desc: string | null) {
    // Dune's SET METADATA skill: apply and persist immediately (save success
    // recomputes the SEO score).
    const patch: { meta_title?: string; meta_description?: string } = {};
    if (title) {
      setMetaTitle(title);
      patch.meta_title = title;
    }
    if (desc) {
      setMetaDesc(desc);
      patch.meta_description = desc;
    }
    if (Object.keys(patch).length > 0) {
      setSaveState("saving");
      updateMutation.mutate(patch);
    }
  }

  function toggleChanges() {
    if (showingChanges) {
      richRef.current?.clearChanges();
      setShowingChanges(false);
    } else if (preEditBody !== null) {
      const n = richRef.current?.highlightChanges(preEditBody) ?? 0;
      if (n > 0) {
        setChangedCount(n);
        setShowingChanges(true);
      } else {
        error(t("articleStudio.noChanges"));
      }
    }
  }

  function handleBodyChange(val: string) {
    setBody(val);
    setSaveState("saving");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updateMutation.mutate({ body_markdown: val });
    }, 2000);
  }

  function handleSaveNow() {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    updateMutation.mutate({ body_markdown: body });
    setSaveState("saving");
  }

  function handleTitleBlur() {
    if (title !== article?.title) {
      updateMutation.mutate({ title });
    }
  }

  function handleMetaTitleBlur() {
    if (metaTitle !== article?.meta_title) {
      updateMutation.mutate({ meta_title: metaTitle });
    }
  }

  function handleMetaDescBlur() {
    if (metaDesc !== article?.meta_description) {
      updateMutation.mutate({ meta_description: metaDesc });
    }
  }

  const wordCount = body
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  // Document outline parsed from the markdown headings (level + text), used
  // by the outline navigator to scroll the rich editor.
  const outline = useMemo(() => {
    const items: { level: number; text: string }[] = [];
    for (const line of body.split("\n")) {
      const m = /^(#{1,3})\s+(.+)/.exec(line.trim());
      if (m) items.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, "").trim() });
    }
    return items;
  }, [body]);

  const seoScore = seoData?.score ?? article?.seo_score ?? null;
  const breakdown = seoData?.breakdown ?? {};

  if (isLoading || !article) {
    return (
      <div className="flex flex-1 items-center justify-center h-64">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <>
    {!focusMode && (
      <RevisionsRail
        articleId={articleId}
        currentWordCount={wordCount}
        onBackToOverview={onBackToOverview}
        onNewArticle={onNewArticle}
        onSaveRevision={() => revisionMutation.mutate()}
        isSavingRevision={revisionMutation.isPending}
        onRestore={handleRestore}
        onCompare={handleCompareRevision}
        mobileOpen={railMobileOpen}
        onCloseMobile={onCloseRailMobile}
      />
    )}
    <div className="glass flex h-full flex-1 min-w-0 flex-col overflow-hidden">
      {/* Title row */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <button
          onClick={onBackToOverview}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("articleStudio.overview.backToOverview")}
          title={t("articleStudio.overview.backToOverview")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          onClick={onShowDocuments}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors lg:hidden"
          aria-label={t("articleStudio.showDocuments")}
          title={t("articleStudio.showDocuments")}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-tight text-foreground focus:outline-none"
          placeholder={t("articles.editor.articleTitle")}
        />
        <Badge tone={STATUS_TONE[article.status] ?? "neutral"} dot className="hidden capitalize sm:inline-flex">
          {article.status}
        </Badge>
        {article.target_keyword && (
          <span className="hidden max-w-[160px] truncate rounded-full bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground xl:inline-block">
            {article.target_keyword}
          </span>
        )}
        <button
          onClick={() => setShowOutline((v) => !v)}
          className={`hidden shrink-0 rounded-lg p-1.5 transition-colors lg:block ${
            showOutline ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          aria-label={t("articleStudio.outline")}
          title={t("articleStudio.outline")}
        >
          <List className="h-4 w-4" />
        </button>
        <button
          onClick={() => setFocusMode((v) => !v)}
          className={`hidden shrink-0 rounded-lg p-1.5 transition-colors lg:block ${
            focusMode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          aria-label={focusMode ? t("articleStudio.exitFocus") : t("articleStudio.focus")}
          title={focusMode ? t("articleStudio.exitFocus") : t("articleStudio.focus")}
        >
          {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          onClick={onShowAssistantPanel}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors lg:hidden"
          aria-label={t("articleStudio.showAssistantPanel")}
          title={t("articleStudio.showAssistantPanel")}
        >
          <PanelRight className="h-4 w-4" />
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <button
              onClick={() => setShowExport((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showExport
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-foreground hover:bg-accent"
              }`}
              title={t("articleStudio.export.title")}
              aria-label={t("articleStudio.export.title")}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            {showExport && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExport(false)} />
                <div className="popover absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-xl p-1 animate-scale-in">
                  {(
                    [
                      {
                        id: "copyMd",
                        Icon: Copy,
                        run: async () => {
                          await navigator.clipboard.writeText(body);
                          success(t("articleStudio.export.copied"));
                        },
                      },
                      {
                        id: "copyHtml",
                        Icon: Copy,
                        run: async () => {
                          await navigator.clipboard.writeText(richRef.current?.getHTML() ?? "");
                          success(t("articleStudio.export.copied"));
                        },
                      },
                      {
                        id: "downloadMd",
                        Icon: Download,
                        run: () => downloadFile(`${slugify(title)}.md`, body, "text/markdown"),
                      },
                      {
                        id: "downloadHtml",
                        Icon: Download,
                        run: () =>
                          downloadFile(
                            `${slugify(title)}.html`,
                            richRef.current?.getHTML() ?? "",
                            "text/html",
                          ),
                      },
                    ] as const
                  ).map(({ id, Icon, run }) => (
                    <button
                      key={id}
                      onClick={async () => {
                        setShowExport(false);
                        try {
                          await run();
                        } catch {
                          error(t("articles.toast.saveError"));
                        }
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {t(`articleStudio.export.${id}`)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => revisionMutation.mutate()}
            disabled={revisionMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
            title={t("articles.editor.saveRevision")}
          >
            {revisionMutation.isPending ? <Spinner size={12} /> : <BookOpen className="h-3.5 w-3.5" />}
            <span className="hidden lg:inline">{t("articles.editor.saveRevision")}</span>
          </button>
          {(article.status === "ready" || article.status === "published") && (
            <button
              onClick={() => setShowPublishModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              title={t("articles.editor.publish")}
            >
              <Send className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">{t("articles.editor.publish")}</span>
            </button>
          )}
          <button
            onClick={handleSaveNow}
            disabled={updateMutation.isPending}
            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {t("articles.editor.save")}
          </button>
        </div>
      </div>

      {/* Toolbar: live stats + model / regenerate / images */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-5 py-2.5">
        <StatsBar
          wordCount={wordCount}
          wordTarget={article.word_count_target}
          seoScore={seoScore}
          onRefetchSeo={() => refetchSeo()}
          saveState={saveState}
        />

        {revisionMsg && <span className="text-xs text-emerald-500">{revisionMsg}</span>}

        <div className="ml-auto flex items-center gap-1.5">
          {preEditBody !== null && (
            <button
              onClick={toggleChanges}
              className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showingChanges
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-foreground hover:bg-accent"
              }`}
              title={showingChanges ? t("articleStudio.hideChanges") : t("articleStudio.showChanges")}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">
                {showingChanges ? t("articleStudio.hideChanges") : t("articleStudio.showChanges")}
              </span>
            </button>
          )}
          {connectedProviders.length > 0 && (
            <>
              <select
                value={selectedProvider}
                onChange={(e) => {
                  setSelectedProvider(e.target.value);
                  setSelectedModel(
                    e.target.value ? (PROVIDER_MODELS[e.target.value]?.models[0]?.id ?? "") : "",
                  );
                }}
                className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">Auto</option>
                {connectedProviders.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_MODELS[p]?.label ?? p}
                  </option>
                ))}
              </select>
              {selectedProvider && (
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {(PROVIDER_MODELS[selectedProvider]?.models ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          <button
            onClick={() => runStreamingGeneration()}
            disabled={generating}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
            title={t("articles.editor.regenerate")}
          >
            {generating ? <Spinner size={12} /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="hidden xl:inline">
              {generating ? t("articles.editor.regenerating") : t("articles.editor.regenerate")}
            </span>
          </button>

          <button
            onClick={() => setShowImageSuggestions((v) => !v)}
            className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              showImageSuggestions
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-foreground hover:bg-accent"
            }`}
            title={t("articles.editor.imageSuggestions")}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t("articles.editor.imageSuggestions")}</span>
          </button>
        </div>
      </div>

      {/* Image suggestions (toggle) */}
      {showImageSuggestions && (
        <div className="border-b border-border px-5 py-3">
          <div className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-card/40 p-3">
            <ImageSuggestionsPanel articleId={articleId} projectId={projectId} />
          </div>
        </div>
      )}

      {/* Reviewing-changes banner */}
      {showingChanges && (
        <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/[0.06] px-5 py-2 animate-fade-in">
          <Eye className="h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="flex-1 text-xs font-medium text-primary">
            {t("articleStudio.reviewingChanges", { count: changedCount })}
          </p>
          <button
            onClick={toggleChanges}
            className="rounded-lg border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
          >
            {t("articleStudio.hideChanges")}
          </button>
        </div>
      )}

      {/* Editor body */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {typing || generating || article.status === "generating" ? (
          /* Live writing surface: real streamed tokens (or the replay reveal) */
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6" ref={typewriterRef}>
            <div className="mx-auto w-full max-w-3xl whitespace-pre-wrap text-[15px] leading-[1.8] text-foreground">
              {(body.match(/\S+\s*/g) ?? []).map((tok, i) => (
                <span key={i} className="word-in">{tok}</span>
              ))}
              <span className="ml-0.5 inline-block h-4 w-[2px] -translate-y-0.5 animate-pulse-dot bg-primary align-middle" />
            </div>
            <div className="pointer-events-none absolute right-4 top-3 flex items-center gap-1.5 rounded-full border border-primary/30 bg-card/90 px-2.5 py-1 text-[11px] font-medium text-primary shadow-sm backdrop-blur animate-fade-in">
              <PenLine className="h-3 w-3 animate-pulse-dot" />
              {polishing ? t("articleStudio.polishing") : t("articleStudio.writing")}
            </div>
            {(generating || article.status === "generating") && !body && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand glow-primary animate-pulse-dot">
                  <PenLine className="h-6 w-6 text-white" strokeWidth={1.9} />
                </span>
                <p className="text-sm font-medium text-foreground">{t("articleStudio.writing")}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Outline navigator */}
            {showOutline && (
              <nav className="hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border px-3 py-4 animate-fade-in lg:flex">
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {t("articleStudio.outline")}
                </p>
                {outline.length === 0 ? (
                  <p className="px-2 text-[11px] text-muted-foreground">{t("articleStudio.outlineEmpty")}</p>
                ) : (
                  outline.map((h, i) => (
                    <button
                      key={`${i}-${h.text}`}
                      onClick={() => richRef.current?.scrollToHeading(i)}
                      className="truncate rounded-lg px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      style={{ paddingLeft: `${8 + (h.level - 1) * 10}px` }}
                      title={h.text}
                    >
                      {h.text}
                    </button>
                  ))
                )}
              </nav>
            )}
            <RichEditor
              ref={richRef}
              articleId={articleId}
              value={body}
              editable
              onChange={handleBodyChange}
            />
          </div>
        )}
      </div>

      {showPublishModal && (
        <PublishModal
          articleId={articleId}
          projectId={projectId}
          onClose={() => setShowPublishModal(false)}
        />
      )}
    </div>

    {!focusMode && (
      <DuneDock
        projectId={projectId}
        articleId={articleId}
        articleTitle={title}
        targetKeyword={article.target_keyword}
        metaTitle={metaTitle}
        metaDesc={metaDesc}
        onMetaTitleChange={setMetaTitle}
        onMetaTitleBlur={handleMetaTitleBlur}
        onMetaDescChange={setMetaDesc}
        onMetaDescBlur={handleMetaDescBlur}
        breakdown={breakdown}
        body={body}
        onBodyChange={handleBodyChange}
        onInsert={(text) => richRef.current?.insertAtCursor(text)}
        onApplyRevision={handleApplyRevision}
        onApplyMeta={handleApplyMeta}
        mobileOpen={dockMobileOpen}
        onCloseMobile={onCloseDockMobile}
      />
    )}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function ArticlesPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const { setCurrentProject } = useProjectStore();
  const queryClient = useQueryClient();
  const { success, error } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streamTemplate, setStreamTemplate] = useState<TemplateId | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [railMobileOpen, setRailMobileOpen] = useState(false);
  const [dockMobileOpen, setDockMobileOpen] = useState(false);

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      return data.some((a) => a.status === "generating") ? 3000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteArticle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
      success(t("articles.toast.deleted"));
    },
    onError: () => error(t("articles.toast.deleteError")),
  });

  const generateMutation = useMutation({
    mutationFn: (id: string) => generateArticle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
      success(t("articles.toast.regenStarted"), { message: t("articles.toast.regenStartedMsg") });
    },
    onError: () => error(t("articles.toast.regenerateError")),
  });

  function handleCreated(article: Article, template: TemplateId | null) {
    setShowModal(false);
    queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
    setStreamTemplate(template);
    setStreamId(article.id);
    setSelectedId(article.id);
  }

  const selectedArticle = articles.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100vh-88px)] flex-col animate-fade-in">
      {selectedArticle ? (
        <div className="flex min-h-0 flex-1 gap-4">
          <ArticleEditor
            key={selectedArticle.id}
            articleId={selectedArticle.id}
            projectId={projectId}
            onShowDocuments={() => setRailMobileOpen(true)}
            onShowAssistantPanel={() => setDockMobileOpen(true)}
            onBackToOverview={() => setSelectedId(null)}
            onNewArticle={() => setShowModal(true)}
            dockMobileOpen={dockMobileOpen}
            onCloseDockMobile={() => setDockMobileOpen(false)}
            railMobileOpen={railMobileOpen}
            onCloseRailMobile={() => setRailMobileOpen(false)}
            streamOnLoad={streamId === selectedArticle.id}
            streamTemplate={streamTemplate}
            onStreamStarted={() => setStreamId(null)}
          />
        </div>
      ) : (
        <ArticlesOverview
          articles={articles}
          isLoading={isLoading}
          onOpen={setSelectedId}
          onNewArticle={() => setShowModal(true)}
          onRegenerate={(id) => generateMutation.mutate(id)}
          onDelete={(id) => {
            deleteMutation.mutate(id);
            if (id === selectedId) setSelectedId(null);
          }}
        />
      )}

      {showModal && (
        <NewArticleModal
          projectId={projectId}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
