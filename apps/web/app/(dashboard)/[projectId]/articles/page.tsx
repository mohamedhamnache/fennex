"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  CheckCircle2,
  Plus,
  Send,
  ExternalLink,
  Zap,
  Image as ImageIcon,
  PanelLeft,
  PanelRight,
} from "lucide-react";
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
  type SEOScoreBreakdown,
  type PublishingConnection,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { FENNEX_AGENTS } from "@/lib/agents";
import { DocumentsRail } from "@/components/articles/studio/DocumentsRail";
import { StatsBar } from "@/components/articles/studio/StatsBar";
import { DuneDock } from "@/components/articles/studio/DuneDock";
import { SelectionBar } from "@/components/articles/studio/SelectionBar";
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

const TONES = [
  "professional",
  "conversational",
  "authoritative",
  "friendly",
  "technical",
  "inspirational",
] as const;

const WORD_COUNTS = [800, 1200, 1500, 2000, 2500] as const;

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

// ─── New Article Modal ─────────────────────────────────────────────────────

function NewArticleModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (article: Article) => void;
}) {
  const { t } = useTranslation();
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
  dockMobileOpen,
  onCloseDockMobile,
}: {
  articleId: string;
  projectId: string;
  onShowDocuments: () => void;
  onShowAssistantPanel: () => void;
  dockMobileOpen: boolean;
  onCloseDockMobile: () => void;
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

  const [tab, setTab] = useState<"edit" | "preview">("edit");
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
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [cursorPosition, setCursorPosition] = useState<number | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);
  const prevStatusRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    };
  }, []);

  useEffect(() => {
    if (!article) return;
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
    onError: () => { setSaveState("idle"); error(t("articles.toast.saveError")); },
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
      success(t("articles.toast.regenerated"));
    },
    onError: () => error(t("articles.toast.regenerateError")),
  });

  const revisionMutation = useMutation({
    mutationFn: () => saveRevision(articleId),
    onSuccess: () => {
      setRevisionMsg(t("articles.toast.revisionSaved"));
      setTimeout(() => setRevisionMsg(null), 2500);
    },
    onError: () => error(t("articles.toast.revisionError")),
  });

  function handleBodyChange(val: string) {
    setBody(val);
    setSaveState("saving");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updateMutation.mutate({ body_markdown: val });
    }, 2000);
  }

  function handleSelectionChange() {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    setSelection(
      selectionStart !== selectionEnd ? { start: selectionStart, end: selectionEnd } : null,
    );
    setCursorPosition(selectionEnd);
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
      <div className="flex flex-1 items-center justify-center h-64">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <>
    <div className="flex h-full flex-1 min-w-0 flex-col overflow-hidden">
      {/* Title row */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
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
          className="flex-1 bg-transparent text-base font-semibold text-foreground focus:outline-none min-w-0"
          placeholder={t("articles.editor.articleTitle")}
        />
        <button
          onClick={onShowAssistantPanel}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors lg:hidden"
          aria-label={t("articleStudio.showAssistantPanel")}
          title={t("articleStudio.showAssistantPanel")}
        >
          <PanelRight className="h-4 w-4" />
        </button>
        <button
          onClick={handleSaveNow}
          disabled={updateMutation.isPending}
          className="btn-primary px-3 py-1.5 text-xs shrink-0 disabled:opacity-60"
        >
          {t("articles.editor.save")}
        </button>
      </div>

      {/* Stats + relocated actions */}
      <StatsBar
        wordCount={wordCount}
        seoScore={seoScore}
        onRefetchSeo={() => refetchSeo()}
        saveState={saveState}
        canPublish={article.status === "ready" || article.status === "published"}
        onSaveRevision={() => revisionMutation.mutate()}
        isSavingRevision={revisionMutation.isPending}
        onPublish={() => setShowPublishModal(true)}
      />
      {revisionMsg && (
        <p className="px-5 pt-2 text-xs text-emerald-500">{revisionMsg}</p>
      )}

      {/* Canvas toolbar: Edit/Preview tabs + regenerate/model picker + image suggestions trigger */}
      <div className="flex items-center gap-3 px-5 pt-4">
        <div className="flex gap-0 border-b border-border flex-1">
          {(["edit", "preview"] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === tabKey
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tabKey === "edit" ? t("articles.editor.edit") : t("articles.editor.preview")}
            </button>
          ))}
        </div>

        {connectedProviders.length > 0 && (
          <div className="flex gap-1.5 shrink-0">
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
          </div>
        )}

        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-60 shrink-0"
        >
          {generateMutation.isPending ? (
            <>
              <Spinner size={12} /> {t("articles.editor.regenerating")}
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" /> {t("articles.editor.regenerate")}
            </>
          )}
        </button>

        <button
          onClick={() => setShowImageSuggestions((v) => !v)}
          className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors shrink-0 ${
            showImageSuggestions
              ? "border-primary/40 text-primary bg-primary/10"
              : "border-border text-foreground hover:bg-accent"
          }`}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          {t("articles.editor.imageSuggestions")}
        </button>
      </div>

      {tab === "edit" && (
        <SelectionBar
          articleId={articleId}
          selection={selection}
          body={body}
          onBodyChange={handleBodyChange}
          onRestoreFocus={() => textareaRef.current?.focus()}
        />
      )}

      {/* Editor body */}
      <div className="flex min-h-0 flex-1 flex-col gap-0 px-5 py-4">
        {showImageSuggestions && (
          <div className="mb-4 rounded-xl border border-border p-3">
            <ImageSuggestionsPanel articleId={articleId} projectId={projectId} />
          </div>
        )}

        {tab === "edit" ? (
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => handleBodyChange(e.target.value)}
            onSelect={handleSelectionChange}
            onKeyUp={handleSelectionChange}
            onMouseUp={handleSelectionChange}
            className="w-full flex-1 resize-none bg-transparent text-sm font-mono leading-relaxed focus:outline-none text-foreground"
            placeholder={t("articles.editor.bodyPlaceholder")}
            style={{ lineHeight: 1.7 }}
          />
        ) : (
          <div
            className="flex-1 overflow-y-auto text-sm leading-relaxed space-y-3 text-foreground [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:text-muted-foreground [&_strong]:text-foreground [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:font-mono [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded"
            dangerouslySetInnerHTML={{ __html: article.body_html ?? "<p class='text-muted-foreground text-sm'>No preview available yet.</p>" }}
          />
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

    <DuneDock
      projectId={projectId}
      articleId={articleId}
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
      cursorPosition={cursorPosition}
      mobileOpen={dockMobileOpen}
      onCloseMobile={onCloseDockMobile}
    />
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

  function handleCreated(article: Article) {
    setShowModal(false);
    queryClient.invalidateQueries({ queryKey: ["articles", projectId] });
    setSelectedId(article.id);
  }

  const selectedArticle = articles.find((a) => a.id === selectedId) ?? null;

  const dune = FENNEX_AGENTS.dune;

  return (
    <div className="flex h-[calc(100vh-108px)] flex-col gap-4 animate-fade-in">
      <PageHeader
        className="mb-0"
        title={t("articles.title")}
        icon={Zap}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: t("articles.title") }]}
        description={t("articles.subtitle")}
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("articles.newArticle")}
          </button>
        }
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <DocumentsRail
          articles={articles}
          isLoading={isLoading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNewArticle={() => setShowModal(true)}
          onRegenerate={(id) => generateMutation.mutate(id)}
          onDelete={(id) => {
            deleteMutation.mutate(id);
            if (id === selectedId) setSelectedId(null);
          }}
          mobileOpen={railMobileOpen}
          onCloseMobile={() => setRailMobileOpen(false)}
        />

        {selectedArticle ? (
          <ArticleEditor
            key={selectedArticle.id}
            articleId={selectedArticle.id}
            projectId={projectId}
            onShowDocuments={() => setRailMobileOpen(true)}
            onShowAssistantPanel={() => setDockMobileOpen(true)}
            dockMobileOpen={dockMobileOpen}
            onCloseDockMobile={() => setDockMobileOpen(false)}
          />
        ) : (
          <section className="glass flex min-w-0 flex-1 flex-col items-center justify-center gap-4 overflow-hidden px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand glow-primary">
              <dune.Icon className="h-6 w-6 text-white" strokeWidth={1.9} />
            </div>
            <div>
              <p className="text-base font-semibold">{t("articleStudio.emptyTitle")}</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                {t("articleStudio.emptyBody")}
              </p>
            </div>
            <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 px-4 py-2 text-xs">
              <Plus className="h-3.5 w-3.5" /> {t("articles.newArticle")}
            </button>
          </section>
        )}
      </div>

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
