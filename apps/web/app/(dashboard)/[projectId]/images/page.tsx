"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  MoreHorizontal,
  AlertCircle,
  Loader2,
  Link as LinkIcon,
  Trash2,
  Copy,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useProjectStore } from "@/lib/store";
import {
  listImages,
  generateImage,
  deleteImage,
  attachImage,
  listArticles,
  listSocialPosts,
  type GeneratedImage,
  type ImageStyle,
  type ImageUsage,
  type Article,
  type SocialPost,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";

// ─── Constants ─────────────────────────────────────────────────────────────

const STYLE_LABELS: Record<ImageStyle, string> = {
  photorealistic: "Photorealistic",
  illustration: "Illustration",
  minimalist: "Minimalist",
  abstract: "Abstract",
  professional: "Professional",
};

const USAGES: ImageUsage[] = ["article_cover", "social_post", "brand_asset", "custom"];
const STYLES: ImageStyle[] = ["professional", "photorealistic", "illustration", "minimalist", "abstract"];

// Maps snake_case usage keys to i18n camelCase keys
const USAGE_I18N: Record<ImageUsage, string> = {
  article_cover: "images.usageTabs.articleCover",
  social_post: "images.usageTabs.socialPost",
  brand_asset: "images.usageTabs.brandAsset",
  custom: "images.usageTabs.custom",
};

// ─── Spinner ──────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <Loader2
      className="animate-spin"
      style={{ width: size, height: size }}
    />
  );
}

// ─── Cost Chip ─────────────────────────────────────────────────────────────

function CostChip({ cost }: { cost: number | null }) {
  const { t } = useTranslation();
  if (cost === null) return null;
  if (cost === 0) {
    return (
      <span className="bg-muted text-muted-foreground text-xs px-1.5 py-0.5 rounded">
        {t("images.card.free")}
      </span>
    );
  }
  return (
    <span className="bg-success/12 text-success text-xs px-1.5 py-0.5 rounded">
      ${cost.toFixed(2)}
    </span>
  );
}

// ─── Style Badge ────────────────────────────────────────────────────────────

function StyleBadge({ style }: { style: ImageStyle }) {
  return (
    <span className="badge bg-accent text-muted-foreground text-xs capitalize">
      {STYLE_LABELS[style]}
    </span>
  );
}

// ─── Image Card ─────────────────────────────────────────────────────────────

function ImageCard({
  image,
  projectId,
  articles,
  onAttach,
}: {
  image: GeneratedImage;
  projectId: string;
  articles: Article[];
  onAttach: (image: GeneratedImage) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isArticleCover = image.usage === "article_cover";
  const aspectClass = isArticleCover ? "aspect-[16/9]" : "aspect-square";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const deleteMutation = useMutation({
    mutationFn: () => deleteImage(image.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
    },
  });

  const attachedArticle = image.article_id
    ? articles.find((a) => a.id === image.article_id)
    : null;

  return (
    <div className="rounded-xl overflow-hidden border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
      {/* Image preview */}
      <div className={`relative ${aspectClass} bg-muted`}>
        {image.status === "generating" || image.status === "pending" ? (
          <div className="absolute inset-0 animate-pulse bg-muted flex items-center justify-center">
            <Spinner size={24} />
          </div>
        ) : image.status === "failed" ? (
          <div className="absolute inset-0 border-2 border-red-400 flex flex-col items-center justify-center gap-2 bg-red-50 dark:bg-red-900/10">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <span className="text-xs text-red-500 px-2 text-center">
              {image.error ?? "Generation failed"}
            </span>
          </div>
        ) : image.status === "ready" && image.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.image_url}
            alt={image.prompt}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-3 flex flex-col gap-2">
        {/* Prompt preview */}
        <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
          {image.prompt || "—"}
        </p>

        {/* Badges row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <StyleBadge style={image.style} />
          <CostChip cost={image.cost_usd} />
        </div>

        {/* Attached article chip */}
        {attachedArticle && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground bg-accent rounded px-1.5 py-0.5">
            <LinkIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {attachedArticle.title.length > 28
                ? attachedArticle.title.slice(0, 28) + "…"
                : attachedArticle.title}
            </span>
          </div>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-1.5 mt-1">
          <button
            onClick={() => onAttach(image)}
            disabled={image.status !== "ready"}
            className="flex-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            <LinkIcon className="h-3 w-3" />
            {t("images.card.attach")}
          </button>

          {/* Kebab menu */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 bottom-8 z-20 w-36 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                {image.image_url && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(image.image_url!);
                      setMenuOpen(false);
                    }}
                    className="w-full px-4 py-2.5 text-sm text-left text-foreground hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("images.card.copyUrl")}
                  </button>
                )}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    if (confirm("Delete this image?")) {
                      deleteMutation.mutate();
                    }
                  }}
                  className="w-full px-4 py-2.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-2"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("images.card.delete")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Generate Modal ──────────────────────────────────────────────────────────

function GenerateModal({
  projectId,
  onClose,
  onGenerated,
}: {
  projectId: string;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<ImageUsage>("article_cover");
  const [style, setStyle] = useState<ImageStyle>("professional");
  const [quality, setQuality] = useState<"standard" | "hd">("standard");
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [articleId, setArticleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
  });

  const readyArticles = articles.filter(
    (a) => a.status === "ready" || a.status === "published",
  );

  async function handleGenerate() {
    setError(null);
    setIsGenerating(true);
    try {
      const image = await generateImage({
        project_id: projectId,
        usage,
        style,
        quality,
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(articleId ? { article_id: articleId } : {}),
      });
      if (image.status === "failed") {
        setError(image.error ?? "Image generation failed");
        setIsGenerating(false);
        return;
      }
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setIsGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("images.generateModal.title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("images.generateModal.subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isGenerating ? (
          <div className="p-10 flex flex-col items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Spinner size={28} />
            </div>
            <p className="text-sm font-medium text-foreground">{t("images.generateModal.generating")}</p>
            <p className="text-xs text-muted-foreground text-center">
              {t("images.generateModal.generatingHint")}
            </p>
          </div>
        ) : (
          <div className="p-6 flex flex-col gap-4">
            {error && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("images.generateModal.usage")}
              </label>
              <select
                value={usage}
                onChange={(e) => setUsage(e.target.value as ImageUsage)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {USAGES.map((u) => (
                  <option key={u} value={u}>
                    {t(USAGE_I18N[u])}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("images.generateModal.style")}
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as ImageStyle)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {STYLES.map((s) => (
                  <option key={s} value={s}>
                    {STYLE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("images.generateModal.quality")}
              </label>
              <div className="flex gap-2">
                {(["standard", "hd"] as const).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuality(q)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                      quality === q
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <span>{q === "hd" ? t("images.generateModal.hd") : t("images.generateModal.standard")}</span>
                    <span className="block text-[10px] font-normal mt-0.5 opacity-70">
                      {q === "standard" ? t("images.generateModal.priceStandard") : t("images.generateModal.priceHD")}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("images.generateModal.prompt")}{" "}
                <span className="font-normal text-muted-foreground">({t("images.generateModal.optional")})</span>
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={t("images.generateModal.autoGenerate")}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("images.generateModal.imageTitle")}{" "}
                <span className="font-normal text-muted-foreground">(used if prompt empty)</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("images.generateModal.titlePlaceholder")}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("images.generateModal.keyword")}{" "}
                <span className="font-normal text-muted-foreground">(used if prompt empty)</span>
              </label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t("images.generateModal.keywordPlaceholder")}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {readyArticles.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  {t("images.generateModal.linkToArticle")}{" "}
                  <span className="font-normal text-muted-foreground">({t("images.generateModal.optional")})</span>
                </label>
                <select
                  value={articleId}
                  onChange={(e) => setArticleId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">{t("images.generateModal.none")}</option>
                  {readyArticles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                {t("images.generateModal.cancel")}
              </button>
              <button
                onClick={handleGenerate}
                className="flex-1 btn-primary px-4 py-2 text-sm flex items-center justify-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("images.generateModal.generate")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Attach Modal ─────────────────────────────────────────────────────────────

function AttachModal({
  image,
  projectId,
  articles,
  socialPosts,
  onClose,
  onAttached,
}: {
  image: GeneratedImage;
  projectId: string;
  articles: Article[];
  socialPosts: SocialPost[];
  onClose: () => void;
  onAttached: () => void;
}) {
  const { t } = useTranslation();
  const [attachTo, setAttachTo] = useState<"article" | "social_post">("article");
  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [selectedPostId, setSelectedPostId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const attachMutation = useMutation({
    mutationFn: () => {
      const data =
        attachTo === "article"
          ? { article_id: selectedArticleId }
          : { social_post_id: selectedPostId };
      return attachImage(image.id, data);
    },
    onSuccess: () => {
      onAttached();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Attach failed");
    },
  });

  const readyArticles = articles.filter(
    (a) => a.status === "ready" || a.status === "published",
  );

  const canSubmit =
    attachTo === "article" ? !!selectedArticleId : !!selectedPostId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("images.attachModal.title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("images.attachModal.subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {t("images.attachModal.attachTo")}
            </label>
            <select
              value={attachTo}
              onChange={(e) => setAttachTo(e.target.value as "article" | "social_post")}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="article">Article</option>
              <option value="social_post">Social Post</option>
            </select>
          </div>

          {attachTo === "article" ? (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("images.attachModal.selectArticle")}
              </label>
              <select
                value={selectedArticleId}
                onChange={(e) => setSelectedArticleId(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">{t("images.attachModal.choose")}</option>
                {readyArticles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("images.attachModal.selectSocialPost")}
              </label>
              <select
                value={selectedPostId}
                onChange={(e) => setSelectedPostId(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">{t("images.attachModal.choose")}</option>
                {socialPosts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.platform} — {p.content.slice(0, 40)}
                    {p.content.length > 40 ? "…" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              {t("images.generateModal.cancel")}
            </button>
            <button
              onClick={() => attachMutation.mutate()}
              disabled={!canSubmit || attachMutation.isPending}
              className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {attachMutation.isPending ? (
                <><Spinner size={14} /> {t("images.attachModal.attaching")}</>
              ) : (
                t("images.attachModal.attach")
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Usage Tabs ──────────────────────────────────────────────────────────────

type UsageFilter = ImageUsage | "all";

function UsageTabs({
  active,
  onChange,
}: {
  active: UsageFilter;
  onChange: (u: UsageFilter) => void;
}) {
  const { t } = useTranslation();
  const tabs: { value: UsageFilter; label: string }[] = [
    { value: "all", label: t("images.usageTabs.all") },
    { value: "article_cover", label: t("images.usageTabs.articleCover") },
    { value: "social_post", label: t("images.usageTabs.socialPost") },
    { value: "brand_asset", label: t("images.usageTabs.brandAsset") },
    { value: "custom", label: t("images.usageTabs.custom") },
  ];

  return (
    <div className="flex gap-1 border-b border-border pb-0">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === tab.value
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ImagesPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const { setCurrentProject } = useProjectStore();
  const queryClient = useQueryClient();

  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [styleFilter, setStyleFilter] = useState<ImageStyle | "all">("all");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [attachingImage, setAttachingImage] = useState<GeneratedImage | null>(null);

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const { data: images = [], isLoading } = useQuery<GeneratedImage[]>({
    queryKey: ["images", projectId, usageFilter],
    queryFn: () =>
      listImages(projectId, usageFilter === "all" ? undefined : usageFilter),
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
  });

  const { data: socialPosts = [] } = useQuery<SocialPost[]>({
    queryKey: ["social-posts", projectId],
    queryFn: () => listSocialPosts(projectId),
  });

  const filteredImages =
    styleFilter === "all"
      ? images
      : images.filter((img) => img.style === styleFilter);

  function handleGenerated() {
    setShowGenerateModal(false);
    queryClient.invalidateQueries({ queryKey: ["images", projectId] });
  }

  function handleAttached() {
    setAttachingImage(null);
    queryClient.invalidateQueries({ queryKey: ["images", projectId] });
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title={t("images.title")}
        icon={ImageIcon}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: t("images.title") }]}
        description={t("images.subtitle")}
        actions={
          <>
            {/* Style filter */}
            <select
              value={styleFilter}
              onChange={(e) => setStyleFilter(e.target.value as ImageStyle | "all")}
              className="rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">{t("images.allStyles")}</option>
              {STYLES.map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABELS[s]}
                </option>
              ))}
            </select>

            <button
              onClick={() => setShowGenerateModal(true)}
              className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("images.generate")}
            </button>
          </>
        }
      />

      {/* Usage tabs */}
      <UsageTabs active={usageFilter} onChange={setUsageFilter} />

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size={28} />
        </div>
      ) : filteredImages.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 rounded-xl border border-dashed border-border">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">{t("images.noImages")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("images.noImagesHint")}
            </p>
          </div>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
          >
            <Plus className="h-4 w-4" />
            {t("images.generate")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredImages.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              projectId={projectId}
              articles={articles}
              onAttach={setAttachingImage}
            />
          ))}
        </div>
      )}

      {/* Generate modal */}
      {showGenerateModal && (
        <GenerateModal
          projectId={projectId}
          onClose={() => setShowGenerateModal(false)}
          onGenerated={handleGenerated}
        />
      )}

      {/* Attach modal */}
      {attachingImage && (
        <AttachModal
          image={attachingImage}
          projectId={projectId}
          articles={articles}
          socialPosts={socialPosts}
          onClose={() => setAttachingImage(null)}
          onAttached={handleAttached}
        />
      )}
    </div>
  );
}
