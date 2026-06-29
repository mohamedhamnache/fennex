"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  MoreHorizontal,
  RefreshCw,
  BookOpen,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Send,
  ExternalLink,
  Zap,
} from "lucide-react";
import { FennecMascot } from "@fennex/ui";
import { useProjectStore } from "@/lib/store";
import {
  listArticles,
  getArticle,
  createArticle,
  updateArticle,
  deleteArticle,
  generateArticle,
  saveRevision,
  getArticleSeoScore,
  listPublishingConnections,
  publishArticle,
  listApiKeys,
  type Article,
  type ArticleStatus,
  type SEOScoreBreakdown,
  type PublishingConnection,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

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

// ─── Status badge ──────────────────────────────────────────────────────────

const STATUS_TONE: Record<ArticleStatus, BadgeTone> = {
  draft: "neutral",
  generating: "warning",
  ready: "info",
  published: "success",
  failed: "danger",
};

function StatusBadge({ status }: { status: ArticleStatus }) {
  return <Badge tone={STATUS_TONE[status]} className="capitalize">{status}</Badge>;
}

// ─── SEO score chip ────────────────────────────────────────────────────────

function seoColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

// ─── ArticleCard ───────────────────────────────────────────────────────────

function ArticleCard({
  article,
  onEdit,
  onRegenerate,
  onDelete,
}: {
  article: Article;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <div className="card-base p-5 flex items-start justify-between gap-4 hover:border-primary/30 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground truncate">{article.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {[
            article.target_keyword,
            article.tone,
            article.word_count > 0 ? `${article.word_count.toLocaleString()} words` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <StatusBadge status={article.status} />
          {article.seo_score !== null && (
            <span className={`text-xs font-semibold tabular-nums ${seoColor(article.seo_score)}`}>
              SEO {article.seo_score}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onEdit}
          className="btn-primary px-3 py-1.5 text-xs"
        >
          Edit
        </button>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-40 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
              <button
                onClick={() => { setMenuOpen(false); onRegenerate(); }}
                className="w-full px-4 py-2.5 text-sm text-left text-foreground hover:bg-accent transition-colors flex items-center gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate
              </button>
              <button
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="w-full px-4 py-2.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-2"
              >
                <XCircle className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── New Article Modal ─────────────────────────────────────────────────────

const TONES = [
  "professional",
  "conversational",
  "authoritative",
  "friendly",
  "technical",
  "inspirational",
] as const;

const WORD_COUNTS = [800, 1200, 1500, 2000, 2500] as const;

function NewArticleModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (article: Article) => void;
}) {
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState<string>("professional");
  const [wordCount, setWordCount] = useState<number>(1200);
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
      const generated = await generateArticle(article.id);
      onCreated(generated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("form");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">New Article</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AI will generate a full draft after creation.
          </p>
        </div>

        {phase === "generating" ? (
          <div className="p-10 flex flex-col items-center gap-4">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Spinner size={28} />
            </div>
            <p className="text-sm font-medium text-foreground">Generating your article…</p>
            <p className="text-xs text-muted-foreground text-center">
              This may take up to a minute. Hang tight.
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
                Title <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 10 Best SEO Practices for 2025"
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Target keyword
              </label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. on-page SEO"
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Word count target
              </label>
              <select
                value={wordCount}
                onChange={(e) => setWordCount(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {WORD_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()} words
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
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim()}
                className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create &amp; Generate
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
  const queryClient = useQueryClient();
  const [connectionId, setConnectionId] = useState("");
  const [publishStatus, setPublishStatus] = useState<"draft" | "publish">("publish");
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: connections = [], isLoading: connectionsLoading } = useQuery<PublishingConnection[]>({
    queryKey: ["publishing-connections", projectId],
    queryFn: () => listPublishingConnections(projectId),
  });

  // Default to first connection once loaded
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
      if (job.published_url) {
        setResult({ url: job.published_url });
      } else {
        setResult({ url: "" });
      }
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : "Publishing failed");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Publish Article</h2>
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
                <p className="text-sm font-semibold text-foreground">Published successfully</p>
                {result.url && (
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    View published post
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <button
                onClick={onClose}
                className="btn-primary px-6 py-2 text-sm"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Choose connection
                </label>
                {connectionsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading connections…</p>
                ) : connections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No connections available. Add one in the Publishing page.
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
                  Publish as
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
                  Cancel
                </button>
                <button
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending || !connectionId || connections.length === 0}
                  className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {publishMutation.isPending ? (
                    <>
                      <Spinner size={14} /> Publishing…
                    </>
                  ) : (
                    "Publish Now"
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
  onBack,
}: {
  articleId: string;
  projectId: string;
  onBack: () => void;
}) {
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

  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [body, setBody] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [metaTitle, setMetaTitle] = useState<string>("");
  const [metaDesc, setMetaDesc] = useState<string>("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [revisionMsg, setRevisionMsg] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);
  const prevStatusRef = useRef<string | null>(null);

  const { data: apiKeys = [] } = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
  });

  const connectedProviders = [...new Set(apiKeys.map((k) => k.provider))].filter(
    (p) => p in PROVIDER_MODELS,
  );

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Populate local state once article loads (guard against re-seeding on background refetch)
  useEffect(() => {
    if (!article) return;
    // Re-seed editor when article leaves the generating state
    if (prevStatusRef.current === "generating" && article.status !== "generating") {
      initialized.current = false;
    }
    prevStatusRef.current = article.status;
    if (!initialized.current) {
      initialized.current = true;
      setBody(article.body_markdown ?? "");
      setTitle(article.title);
      setMetaTitle(article.meta_title ?? "");
      setMetaDesc(article.meta_description ?? "");
    }
  }, [article]);

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateArticle>[1]) =>
      updateArticle(articleId, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(["article", articleId], updated);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    },
    onError: () => { setSaveState("idle"); error("Couldn't save changes"); },
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      generateArticle(
        articleId,
        selectedProvider && selectedModel
          ? { provider: selectedProvider, model: selectedModel }
          : undefined,
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(["article", articleId], updated);
      setBody(updated.body_markdown ?? "");
      queryClient.invalidateQueries({ queryKey: ["article-seo", articleId] });
      success("Article regenerated");
    },
    onError: () => error("Couldn't regenerate article"),
  });

  const revisionMutation = useMutation({
    mutationFn: () => saveRevision(articleId),
    onSuccess: () => {
      setRevisionMsg("Revision saved");
      setTimeout(() => setRevisionMsg(null), 2500);
    },
    onError: () => error("Couldn't save revision"),
  });

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

  const seoScore = seoData?.score ?? article?.seo_score ?? null;
  const breakdown = seoData?.breakdown ?? {};

  if (isLoading || !article) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          List
        </button>
        <ChevronRight className="hidden h-4 w-4 text-border lg:block" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          className="flex-1 bg-transparent text-base font-semibold text-foreground focus:outline-none min-w-0"
          placeholder="Article title"
        />
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {wordCount.toLocaleString()} words
        </span>
        {saveState === "saving" && (
          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
            <Spinner size={12} /> Saving…
          </span>
        )}
        {saveState === "saved" && (
          <span className="text-xs text-emerald-500 flex items-center gap-1 shrink-0">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        <button
          onClick={handleSaveNow}
          disabled={updateMutation.isPending}
          className="btn-primary px-3 py-1.5 text-xs shrink-0 disabled:opacity-60"
        >
          Save
        </button>
        {(article.status === "ready" || article.status === "published") && (
          <button
            onClick={() => setShowPublishModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            Publish
          </button>
        )}
      </div>

      {/* Editor body */}
      <div className="flex min-h-0 flex-1 gap-0 px-5 py-4">
        {/* Left: editor / preview */}
        <div className="flex-1 flex flex-col min-w-0 pr-6">
          {/* Tab bar */}
          <div className="flex gap-0 border-b border-border mb-4">
            {(["edit", "preview"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "edit" ? "Edit" : "Preview"}
              </button>
            ))}
          </div>

          {tab === "edit" ? (
            <textarea
              value={body}
              onChange={(e) => handleBodyChange(e.target.value)}
              className="w-full flex-1 resize-none bg-transparent text-sm font-mono leading-relaxed focus:outline-none text-foreground"
              placeholder="Start writing in Markdown…"
              style={{ lineHeight: 1.7 }}
            />
          ) : (
            <div
              className="flex-1 overflow-y-auto text-sm leading-relaxed space-y-3 text-foreground [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:text-muted-foreground [&_strong]:text-foreground [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:font-mono [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded"
              dangerouslySetInnerHTML={{ __html: article.body_html ?? "<p class='text-muted-foreground text-sm'>No preview available yet.</p>" }}
            />
          )}
        </div>

        {/* Right: SEO sidebar */}
        <div className="w-72 shrink-0 border-l border-border pl-5 overflow-y-auto">
          {/* Score */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                SEO Score
              </p>
              <button
                onClick={() => refetchSeo()}
                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                title="Refresh score"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className={`text-4xl font-bold tabular-nums ${seoColor(seoScore)}`}>
              {seoScore !== null ? seoScore : "—"}
            </div>
          </div>

          {/* Breakdown */}
          {Object.keys(breakdown).length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Breakdown
              </p>
              <div className="flex flex-col gap-1.5">
                {Object.entries(breakdown).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-foreground capitalize">
                      {val > 0 ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-400" />
                      )}
                      {key.replace(/_/g, " ")}
                    </span>
                    <span className={`tabular-nums font-medium ${val > 0 ? "text-emerald-500" : "text-red-400"}`}>
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border pt-4 mb-4">
            {/* Meta title */}
            <div className="mb-3">
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                Meta title
              </label>
              <input
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
                onBlur={handleMetaTitleBlur}
                placeholder="SEO title…"
                className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {/* Meta description */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                Meta description
                <span
                  className={`ml-2 font-normal tabular-nums ${
                    metaDesc.length >= 150 && metaDesc.length <= 160
                      ? "text-emerald-500"
                      : metaDesc.length > 160
                      ? "text-red-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {metaDesc.length} / 160
                </span>
              </label>
              <textarea
                value={metaDesc}
                onChange={(e) => setMetaDesc(e.target.value)}
                onBlur={handleMetaDescBlur}
                placeholder="Brief page description…"
                rows={3}
                className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
              />
            </div>
          </div>

          <div className="border-t border-border pt-4 flex flex-col gap-2">
            {/* Model picker */}
            {connectedProviders.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Model
                </label>
                <div className="flex gap-1.5">
                  <select
                    value={selectedProvider}
                    onChange={(e) => {
                      setSelectedProvider(e.target.value);
                      setSelectedModel(
                        e.target.value
                          ? (PROVIDER_MODELS[e.target.value]?.models[0]?.id ?? "")
                          : "",
                      );
                    }}
                    className="flex-1 rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
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
                      className="flex-1 rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                    >
                      {(PROVIDER_MODELS[selectedProvider]?.models ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            {/* Regenerate */}
            <button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-60"
            >
              {generateMutation.isPending ? (
                <>
                  <Spinner size={12} /> Regenerating…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                </>
              )}
            </button>

            {/* Save revision */}
            <button
              onClick={() => revisionMutation.mutate()}
              disabled={revisionMutation.isPending}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-60"
            >
              {revisionMutation.isPending ? (
                <>
                  <Spinner size={12} /> Saving…
                </>
              ) : (
                <>
                  <BookOpen className="h-3.5 w-3.5" /> Save Revision
                </>
              )}
            </button>

            {revisionMsg && (
              <p className="text-xs text-emerald-500 text-center">{revisionMsg}</p>
            )}
          </div>
        </div>
      </div>

      {showPublishModal && (
        <PublishModal
          articleId={articleId}
          projectId={projectId}
          onClose={() => setShowPublishModal(false)}
        />
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function ArticlesPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { setCurrentProject } = useProjectStore();
  const queryClient = useQueryClient();
  const { success, error } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

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
      success("Article deleted");
    },
    onError: () => error("Couldn't delete article"),
  });

  const generateMutation = useMutation({
    mutationFn: (id: string) => generateArticle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
      success("Regeneration started", { message: "Your article is being rewritten." });
    },
    onError: () => error("Couldn't regenerate article"),
  });

  function handleCreated(article: Article) {
    setShowModal(false);
    queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
    setSelectedId(article.id);
  }

  const selectedArticle = articles.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100vh-108px)] flex-col gap-4 animate-fade-in">
      <PageHeader
        className="mb-0"
        title="Articles"
        icon={Zap}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Articles" }]}
        description="AI-generated, SEO-optimized content."
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            New Article
          </button>
        }
      />

      <div className="flex min-h-0 flex-1 gap-4">
        {/* ── List pane ── */}
        <aside className={cn(
          "glass flex w-full shrink-0 flex-col overflow-hidden lg:w-[340px]",
          selectedId && "hidden lg:flex",
        )}>
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <p className="text-sm font-semibold">All articles</p>
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-xs text-muted-foreground">{articles.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="space-y-2 p-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-white/[0.04]" />)}
              </div>
            ) : articles.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                <FennecMascot />
                <p className="text-sm font-medium">No articles yet</p>
                <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 px-4 py-2 text-xs">
                  <Plus className="h-3.5 w-3.5" /> New Article
                </button>
              </div>
            ) : (
              articles.map((a) => {
                const isSel = a.id === selectedId;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={cn(
                      "group relative mb-1 flex w-full flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                      isSel ? "bg-primary/12" : "hover:bg-white/[0.04]",
                    )}
                  >
                    {isSel && <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />}
                    <p className={cn("line-clamp-1 text-sm font-medium", isSel ? "text-foreground" : "text-foreground/85")}>{a.title}</p>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.status} />
                      {a.seo_score !== null && (
                        <span className={`text-[11px] font-semibold tabular-nums ${seoColor(a.seo_score)}`}>SEO {a.seo_score}</span>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Editor pane ── */}
        <section className={cn(
          "glass min-w-0 flex-1 overflow-hidden",
          !selectedId && "hidden lg:block",
        )}>
          {selectedArticle ? (
            <ArticleEditor
              key={selectedArticle.id}
              articleId={selectedArticle.id}
              projectId={projectId}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand glow-primary">
                <Zap className="h-6 w-6 text-white" strokeWidth={1.9} />
              </div>
              <div>
                <p className="text-base font-semibold">Select an article to edit</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  Pick one from the list, or generate a new AI-written draft.
                </p>
              </div>
              <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 px-4 py-2 text-xs">
                <Plus className="h-3.5 w-3.5" /> New Article
              </button>
            </div>
          )}
        </section>
      </div>

      {/* New article modal */}
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
