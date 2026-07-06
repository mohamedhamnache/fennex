"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
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
  PencilLine,
  Image as ImageIcon,
  Search,
  X,
  Folder as FolderIcon,
  ChevronLeft,
  Globe,
  Crop,
  Layers,
  Check,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useProjectStore } from "@/lib/store";
import {
  listImages,
  listImageFolders,
  searchImages,
  deleteImage,
  moveImageToFolder,
  attachImage,
  listArticles,
  listSocialPosts,
  type GeneratedImage,
  type ImageFolder,
  type ImageStyle,
  type ImageUsage,
  type Article,
  type SocialPost,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { FolderSidebar } from "@/components/studio/FolderSidebar";
import { PublishModal } from "@/components/studio/PublishModal";
import { ResizeModal } from "@/components/studio/ResizeModal";
import { StudioQuickStart } from "@/components/studio/StudioQuickStart";
import { CollectionsStrip } from "@/components/studio/CollectionsStrip";
import {
  InstagramIcon,
  YoutubeIcon,
  LinkedInIcon,
  FacebookIcon,
  TikTokIcon,
  PinterestIcon,
} from "@/components/studio/SocialIcons";

// ─── Social platform metadata ───────────────────────────────────────────────

type SocialIconComponent = React.ComponentType<{ className?: string }>;

const SOCIAL_PLATFORMS: Record<string, { label: string; Icon: SocialIconComponent }> = {
  instagram_post:    { label: "Post",      Icon: InstagramIcon },
  instagram_story:   { label: "Story",     Icon: InstagramIcon },
  instagram_reel:    { label: "Reel",      Icon: InstagramIcon },
  youtube_thumbnail: { label: "Thumbnail", Icon: YoutubeIcon },
  linkedin_banner:   { label: "Banner",    Icon: LinkedInIcon },
  linkedin_post:     { label: "Post",      Icon: LinkedInIcon },
  facebook_ad:       { label: "Ad",        Icon: FacebookIcon },
  tiktok_cover:      { label: "Cover",     Icon: TikTokIcon },
  pinterest_pin:     { label: "Pin",       Icon: PinterestIcon },
};

function SocialPlatformBadge({ platform }: { platform: string }) {
  const meta = SOCIAL_PLATFORMS[platform];
  if (!meta) return null;
  const { Icon, label } = meta;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] text-foreground font-medium">
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

// ─── Constants ─────────────────────────────────────────────────────────────

const STYLE_LABELS: Record<ImageStyle, string> = {
  photorealistic: "Photorealistic",
  illustration: "Illustration",
  minimalist: "Minimalist",
  abstract: "Abstract",
  professional: "Professional",
  "3d_render": "3D Render",
  anime: "Anime",
  cinematic: "Cinematic",
  luxury_product: "Luxury Product",
};

const STYLES: ImageStyle[] = ["professional", "photorealistic", "illustration", "minimalist", "abstract", "3d_render", "anime", "cinematic", "luxury_product"];

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
  folders,
  onAttach,
  onMoved,
  selected = false,
  anySelected = false,
  onToggleSelect,
}: {
  image: GeneratedImage;
  projectId: string;
  articles: Article[];
  folders: ImageFolder[];
  onAttach: (image: GeneratedImage) => void;
  onMoved: () => void;
  selected?: boolean;
  anySelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [resizeOpen, setResizeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const aspectClass = "aspect-[4/3]";

  const currentFolder = image.folder_id ? folders.find((f) => f.id === image.folder_id) : null;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowFolderPicker(false);
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

  const moveMutation = useMutation({
    mutationFn: (folderId: string | null) => moveImageToFolder(image.id, folderId),
    onSuccess: () => {
      onMoved();
      setMenuOpen(false);
      setShowFolderPicker(false);
    },
  });

  const attachedArticle = image.article_id
    ? articles.find((a) => a.id === image.article_id)
    : null;

  return (
    <div className={cn(
      "group rounded-xl overflow-hidden border bg-card shadow-sm hover:shadow-md transition-shadow",
      selected ? "border-primary ring-2 ring-primary/30" : "border-border",
    )}>
      {/* Image preview — whole thumbnail toggles selection while selecting */}
      <div
        className={cn(`relative ${aspectClass} bg-black/8 dark:bg-white/8`, anySelected && "cursor-pointer")}
        onClick={anySelected && onToggleSelect ? onToggleSelect : undefined}
      >
        {/* Dim non-selected cards while a selection is active */}
        {anySelected && !selected && (
          <div className="absolute inset-0 z-[5] bg-black/25 pointer-events-none transition-opacity" />
        )}
        {/* Selection checkbox — image-safe colours that read in light AND dark mode */}
        {onToggleSelect && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            title={selected ? "Deselect" : "Select"}
            className={cn(
              "absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-md transition-all",
              selected
                ? "bg-primary border-primary text-white scale-100"
                : "bg-black/45 border-white/90 text-transparent hover:text-white/90 backdrop-blur-sm",
              selected || anySelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </button>
        )}
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
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}

        {/* Folder badge overlaid on image */}
        {currentFolder && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 text-white rounded px-1.5 py-0.5 text-[10px] backdrop-blur-sm">
            <FolderIcon className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate max-w-[80px]">{currentFolder.name}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); moveMutation.mutate(null); }}
              className="ml-0.5 hover:text-red-300 transition-colors"
              aria-label="Remove from folder"
            >
              <X className="h-2.5 w-2.5" />
            </button>
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
          {image.social_platform ? (
            <SocialPlatformBadge platform={image.social_platform} />
          ) : (
            <StyleBadge style={image.style} />
          )}
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

          {image.status === "ready" && (
            <Link
              href={`/${projectId}/images/edit/${image.id}`}
              className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors flex items-center gap-1"
            >
              <PencilLine className="h-3 w-3" />
              Edit
            </Link>
          )}

          {/* Kebab menu */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => { setMenuOpen((v) => !v); setShowFolderPicker(false); }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 bottom-8 z-20 w-44 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                {!showFolderPicker ? (
                  <>
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
                    {image.status === "ready" && (
                      <button
                        onClick={() => { setMenuOpen(false); setPublishOpen(true); }}
                        className="w-full px-4 py-2.5 text-sm text-left text-foreground hover:bg-accent transition-colors flex items-center gap-2"
                      >
                        <Globe className="h-3.5 w-3.5" />
                        Publish
                      </button>
                    )}
                    {image.status === "ready" && (
                      <button
                        onClick={() => { setMenuOpen(false); setResizeOpen(true); }}
                        className="w-full px-4 py-2.5 text-sm text-left text-foreground hover:bg-accent transition-colors flex items-center gap-2"
                      >
                        <Crop className="h-3.5 w-3.5" />
                        Resize for platforms
                      </button>
                    )}
                    {folders.length > 0 && (
                      <button
                        onClick={() => setShowFolderPicker(true)}
                        className="w-full px-4 py-2.5 text-sm text-left text-foreground hover:bg-accent transition-colors flex items-center gap-2"
                      >
                        <FolderIcon className="h-3.5 w-3.5" />
                        Move to folder
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
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
                      <button
                        onClick={() => setShowFolderPicker(false)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-xs font-medium text-foreground">Move to folder</span>
                    </div>
                    {image.folder_id && (
                      <button
                        onClick={() => moveMutation.mutate(null)}
                        disabled={moveMutation.isPending}
                        className="w-full px-4 py-2.5 text-sm text-left text-muted-foreground hover:bg-accent transition-colors flex items-center gap-2"
                      >
                        <X className="h-3.5 w-3.5" />
                        Remove from folder
                      </button>
                    )}
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => moveMutation.mutate(f.id)}
                        disabled={moveMutation.isPending}
                        className={`w-full px-4 py-2.5 text-sm text-left hover:bg-accent transition-colors flex items-center gap-2 ${
                          image.folder_id === f.id ? "text-primary font-medium" : "text-foreground"
                        }`}
                      >
                        <FolderIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{f.name}</span>
                        {image.folder_id === f.id && <span className="ml-auto text-[10px] text-primary">current</span>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {publishOpen && (
        <PublishModal imageId={image.id} onClose={() => setPublishOpen(false)} />
      )}

      {resizeOpen && (
        <ResizeModal
          imageId={image.id}
          imageUrl={image.image_url}
          onClose={() => setResizeOpen(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["images", projectId] })}
        />
      )}
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
              <option value="article">{t("content.types.article")}</option>
              <option value="social_post">{t("content.types.socialPost")}</option>
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
  const [attachingImage, setAttachingImage] = useState<GeneratedImage | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Reset selection when the visible set changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [usageFilter, activeFolderId, searchQuery]);

  // Escape clears the selection
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedIds(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const isSearching = searchQuery.trim().length > 0;

  const { data: images = [], isLoading } = useQuery<GeneratedImage[]>({
    queryKey: ["images", projectId, usageFilter, activeFolderId, searchQuery],
    queryFn: () => {
      if (isSearching) {
        return searchImages(projectId, searchQuery.trim(), activeFolderId ?? undefined);
      }
      return listImages(projectId, usageFilter === "all" ? undefined : usageFilter, activeFolderId);
    },
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
  });

  const { data: socialPosts = [] } = useQuery<SocialPost[]>({
    queryKey: ["social-posts", projectId],
    queryFn: () => listSocialPosts(projectId),
  });

  const { data: folders = [] } = useQuery<ImageFolder[]>({
    queryKey: ["image-folders"],
    queryFn: listImageFolders,
  });

  const filteredImages =
    styleFilter === "all"
      ? images
      : images.filter((img) => img.style === styleFilter);

  function handleAttached() {
    setAttachingImage(null);
    queryClient.invalidateQueries({ queryKey: ["images", projectId] });
  }

  function handleMoved() {
    queryClient.invalidateQueries({ queryKey: ["images", projectId] });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    if (bulkBusy || selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} image${selectedIds.size === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    try {
      await Promise.allSettled([...selectedIds].map((id) => deleteImage(id)));
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkMove(folderId: string | null) {
    if (bulkBusy || selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      await Promise.allSettled([...selectedIds].map((id) => moveImageToFolder(id, folderId)));
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["images", projectId] });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full -m-6 animate-fade-in">
      {/* Page header */}
      <div className="px-6 pt-6 shrink-0">
        <PageHeader
          title={t("images.title")}
          icon={ImageIcon}
          breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: t("images.title") }]}
          description={t("images.subtitle")}
          actions={
            <>
              {!isSearching && (
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
              )}
              <Link
                href={`/${projectId}/images/collections`}
                className="flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                <Layers className="h-3.5 w-3.5" />
                Collections
              </Link>
              <Link
                href={`/${projectId}/images/studio`}
                className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("images.generate")}
              </Link>
            </>
          }
        />
      </div>

      {/* Body: folder sidebar on the left, scrollable content on the right */}
      <div className="flex flex-1 overflow-hidden border-t border-border mt-6">
        <FolderSidebar activeFolderId={activeFolderId} onFolderSelect={setActiveFolderId} />

        <div className="flex-1 flex flex-col gap-4 px-6 py-4 min-w-0 overflow-y-auto">
          {/* Quick start + collections — hidden while searching or inside a folder */}
          {!isSearching && activeFolderId === null && (
            <>
              <StudioQuickStart projectId={projectId} />
              <CollectionsStrip projectId={projectId} />
            </>
          )}

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by prompt, alt text, or caption..."
              className="w-full rounded-lg border border-border bg-input pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Usage tabs — hidden during search */}
          {!isSearching && <UsageTabs active={usageFilter} onChange={setUsageFilter} />}

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
                <p className="text-sm font-semibold text-foreground">
                  {isSearching ? "No images matched your search" : t("images.noImages")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isSearching ? "Try different keywords or clear the search." : t("images.noImagesHint")}
                </p>
              </div>
              {!isSearching && (
                <Link
                  href={`/${projectId}/images/studio`}
                  className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <Plus className="h-4 w-4" />
                  {t("images.generate")}
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {filteredImages.map((image) => (
                <ImageCard
                  key={image.id}
                  image={image}
                  projectId={projectId}
                  articles={articles}
                  folders={folders}
                  onAttach={setAttachingImage}
                  onMoved={handleMoved}
                  selected={selectedIds.has(image.id)}
                  anySelected={selectedIds.size > 0}
                  onToggleSelect={() => toggleSelect(image.id)}
                />
              ))}
            </div>
          )}

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="sticky bottom-3 z-20 self-center flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 shadow-xl animate-fade-in">
              <span className="px-1 text-xs font-semibold text-foreground whitespace-nowrap tabular-nums">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    selectedIds.size === filteredImages.length
                      ? new Set()
                      : new Set(filteredImages.map((i) => i.id)),
                  )
                }
                className="text-xs text-primary hover:underline whitespace-nowrap"
              >
                {selectedIds.size === filteredImages.length ? "Deselect all" : `Select all (${filteredImages.length})`}
              </button>
              <div className="h-4 w-px bg-border" />
              <select
                disabled={bulkBusy || folders.length === 0}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) bulkMove(v === "__none__" ? null : v);
                }}
                className="rounded-lg border border-border bg-input px-2 py-1 text-xs text-foreground focus:outline-none disabled:opacity-50"
              >
                <option value="" disabled>Move to…</option>
                <option value="__none__">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={bulkDelete}
                className="flex items-center gap-1 rounded-lg border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                title="Clear selection"
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

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
