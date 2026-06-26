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
  type Article,
  type ArticleStatus,
  type SEOScoreBreakdown,
} from "@/lib/api";

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

const STATUS_STYLES: Record<ArticleStatus, string> = {
  draft: "bg-gray-50 text-gray-600",
  generating: "bg-blue-50 text-blue-600",
  ready: "bg-emerald-50 text-emerald-600",
  published: "bg-indigo-50 text-indigo-600",
};

function StatusBadge({ status }: { status: ArticleStatus }) {
  return (
    <span className={`badge capitalize ${STATUS_STYLES[status]}`}>{status}</span>
  );
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
                className="w-full px-4 py-2.5 text-sm text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
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

// ─── Article Editor ────────────────────────────────────────────────────────

function ArticleEditor({
  articleId,
  onBack,
}: {
  articleId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: article, isLoading } = useQuery<Article>({
    queryKey: ["article", articleId],
    queryFn: () => getArticle(articleId),
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
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Populate local state once article loads (guard against re-seeding on background refetch)
  useEffect(() => {
    if (article && !initialized.current) {
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
  });

  const generateMutation = useMutation({
    mutationFn: () => generateArticle(articleId),
    onSuccess: (updated) => {
      queryClient.setQueryData(["article", articleId], updated);
      setBody(updated.body_markdown ?? "");
      queryClient.invalidateQueries({ queryKey: ["article-seo", articleId] });
    },
  });

  const revisionMutation = useMutation({
    mutationFn: () => saveRevision(articleId),
    onSuccess: () => {
      setRevisionMsg("Revision saved");
      setTimeout(() => setRevisionMsg(null), 2500);
    },
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
    <div className="flex flex-col gap-0 animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center gap-3 pb-4 border-b border-border">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Articles
        </button>
        <ChevronRight className="h-4 w-4 text-border" />
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
      </div>

      {/* Editor body */}
      <div className="flex gap-0 h-[calc(100vh-180px)] mt-4">
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
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function ArticlesPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { setCurrentProject } = useProjectStore();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteArticle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
    },
  });

  const generateMutation = useMutation({
    mutationFn: generateArticle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
    },
  });

  function handleCreated(article: Article) {
    setShowModal(false);
    queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
    setSelectedId(article.id);
  }

  if (selectedId) {
    return (
      <ArticleEditor
        articleId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Articles</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            AI-generated, SEO-optimized content
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          New Article
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size={28} />
        </div>
      ) : articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <FennecMascot />
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">Create your first article</p>
            <p className="mt-1 text-sm text-muted-foreground">
              AI will generate a full draft optimized for your target keyword.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2 px-5 py-2 text-sm mt-2"
          >
            <Plus className="h-4 w-4" />
            New Article
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onEdit={() => setSelectedId(article.id)}
              onRegenerate={() => generateMutation.mutate(article.id)}
              onDelete={() => {
                if (confirm(`Delete "${article.title}"?`)) {
                  deleteMutation.mutate(article.id);
                }
              }}
            />
          ))}
        </div>
      )}

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
