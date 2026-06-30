"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  MoreHorizontal,
  MessageSquare,
  Linkedin,
  Twitter,
  Instagram,
  Facebook,
  Loader2,
  Calendar,
  RefreshCw,
  X,
  Send,
  Share2,
} from "lucide-react";
import { useProjectStore } from "@/lib/store";
import {
  listSocialPosts,
  createSocialPost,
  updateSocialPost,
  deleteSocialPost,
  generateSocialPost,
  scheduleSocialPost,
  publishSocialPost,
  listArticles,
  type SocialPost,
  type SocialPlatform,
  type SocialPostType,
  type SocialPostStatus,
  type Article,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// ─── Constants ─────────────────────────────────────────────────────────────

const CHAR_LIMITS: Record<SocialPlatform, number> = {
  linkedin: 3000,
  twitter: 280,
  instagram: 2200,
  facebook: 63206,
};

const PLATFORM_BADGE_STYLES: Record<SocialPlatform, string> = {
  linkedin: "bg-[#0A66C2]/10 text-[#0A66C2]",
  twitter: "bg-[#1DA1F2]/10 text-[#1DA1F2]",
  instagram: "bg-[#E1306C]/10 text-[#E1306C]",
  facebook: "bg-[#1877F2]/10 text-[#1877F2]",
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  linkedin: "LinkedIn",
  twitter: "Twitter",
  instagram: "Instagram",
  facebook: "Facebook",
};

// Maps snake_case post type keys to i18n camelCase keys
const POST_TYPE_I18N: Record<SocialPostType, string> = {
  article_share: "social.postTypes.articleShare",
  tip: "social.postTypes.tip",
  question: "social.postTypes.question",
  announcement: "social.postTypes.announcement",
};

const STATUS_TONE: Record<SocialPostStatus, BadgeTone> = {
  draft: "neutral",
  scheduled: "info",
  published: "success",
  failed: "danger",
};

const PLATFORMS: SocialPlatform[] = ["linkedin", "twitter", "instagram", "facebook"];
const POST_TYPES: SocialPostType[] = ["article_share", "tip", "question", "announcement"];

// ─── Spinner ───────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <Loader2
      className="animate-spin"
      style={{ width: size, height: size }}
    />
  );
}

// ─── Platform Icon ─────────────────────────────────────────────────────────

function PlatformIcon({ platform, size = 16 }: { platform: SocialPlatform; size?: number }) {
  const props = { style: { width: size, height: size } };
  switch (platform) {
    case "linkedin":
      return <Linkedin {...props} />;
    case "twitter":
      return <Twitter {...props} />;
    case "instagram":
      return <Instagram {...props} />;
    case "facebook":
      return <Facebook {...props} />;
  }
}

// ─── Platform Badge ─────────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: SocialPlatform }) {
  return (
    <span className={`badge flex items-center gap-1.5 ${PLATFORM_BADGE_STYLES[platform]}`}>
      <PlatformIcon platform={platform} size={12} />
      {PLATFORM_LABELS[platform]}
    </span>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SocialPostStatus }) {
  return <Badge tone={STATUS_TONE[status]} className="capitalize">{status}</Badge>;
}

// ─── Char Count ─────────────────────────────────────────────────────────────

function CharCount({ count, limit }: { count: number; limit: number }) {
  const ratio = count / limit;
  const colorClass =
    count > limit
      ? "text-red-500"
      : ratio >= 0.8
      ? "text-amber-500"
      : "text-emerald-500";
  return (
    <span className={`text-xs tabular-nums font-medium ${colorClass}`}>
      {count} / {limit}
    </span>
  );
}

// ─── Format scheduled date ──────────────────────────────────────────────────

function formatScheduled(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Social Post Card ────────────────────────────────────────────────────────

function SocialPostCard({
  post,
  projectId,
  onEdit,
}: {
  post: SocialPost;
  projectId: string;
  onEdit: (post: SocialPost) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
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

  const generateMutation = useMutation({
    mutationFn: async () => {
      const newPost = await generateSocialPost({
        project_id: post.project_id,
        platform: post.platform,
        post_type: post.post_type,
        ...(post.article_id ? { article_id: post.article_id } : {}),
      });
      // Update the original post in-place with generated content
      await updateSocialPost(post.id, {
        content: newPost.content,
        hashtags: newPost.hashtags ?? undefined,
      });
      // Remove the duplicate post created by generateSocialPost
      await deleteSocialPost(newPost.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-posts", projectId] });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => publishSocialPost(post.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-posts", projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSocialPost(post.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-posts", projectId] });
    },
  });

  const limit = CHAR_LIMITS[post.platform];
  const preview =
    post.content.length > 120
      ? post.content.slice(0, 120) + "..."
      : post.content;

  const isPending =
    generateMutation.isPending || publishMutation.isPending || deleteMutation.isPending;

  return (
    <div className="card-base p-5 hover:border-primary/30 transition-colors">
      <div className="flex items-start gap-3">
        {/* Platform icon */}
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${PLATFORM_BADGE_STYLES[post.platform]}`}>
          <PlatformIcon platform={post.platform} size={16} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Content preview */}
          <p className="text-sm text-foreground leading-relaxed">{preview}</p>

          {/* Meta row */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="badge bg-accent text-muted-foreground text-xs">
              {t(POST_TYPE_I18N[post.post_type])}
            </span>
            <StatusBadge status={post.status} />
            {post.status === "scheduled" && post.scheduled_at && (
              <span className="text-xs text-blue-600">
                scheduled for {formatScheduled(post.scheduled_at)}
              </span>
            )}
          </div>

          {/* Char count + actions row */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <CharCount count={post.char_count} limit={limit} />

            <div className="flex items-center gap-1.5 ml-auto">
              {/* Edit */}
              <button
                onClick={() => onEdit(post)}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                {t("social.card.edit")}
              </button>

              {/* Generate (drafts only) */}
              {post.status === "draft" && (
                <button
                  onClick={() => generateMutation.mutate()}
                  disabled={isPending}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  {generateMutation.isPending ? (
                    <><Spinner size={12} /> {t("social.card.generating")}</>
                  ) : (
                    <><RefreshCw className="h-3 w-3" /> {t("social.card.generate")}</>
                  )}
                </button>
              )}

              {/* Schedule (drafts only) — opens edit drawer on the schedule section */}
              {post.status === "draft" && (
                <button
                  onClick={() => onEdit(post)}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors flex items-center gap-1"
                >
                  <Calendar className="h-3 w-3" /> {t("social.card.schedule")}
                </button>
              )}

              {/* Publish (draft or scheduled) */}
              {(post.status === "draft" || post.status === "scheduled") && (
                <button
                  onClick={() => publishMutation.mutate()}
                  disabled={isPending}
                  className="btn-primary px-2.5 py-1 text-xs flex items-center gap-1 disabled:opacity-50"
                >
                  {publishMutation.isPending ? (
                    <><Spinner size={12} /> {t("social.card.publishing")}</>
                  ) : (
                    <><Send className="h-3 w-3" /> {t("social.card.publish")}</>
                  )}
                </button>
              )}

              {/* Kebab menu */}
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-8 z-20 w-36 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        if (confirm("Delete this post?")) {
                          deleteMutation.mutate();
                        }
                      }}
                      className="w-full px-4 py-2.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      {t("social.card.delete")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── New Post Modal ──────────────────────────────────────────────────────────

function NewPostModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (post: SocialPost) => void;
}) {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<SocialPlatform>("linkedin");
  const [postType, setPostType] = useState<SocialPostType>("tip");
  const [articleId, setArticleId] = useState<string>("");
  const [phase, setPhase] = useState<"form" | "generating" | "composing">("form");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
  });

  const readyArticles = articles.filter(
    (a) => a.status === "ready" || a.status === "published",
  );

  async function handleGenerate() {
    setError(null);
    setPhase("generating");
    try {
      const post = await generateSocialPost({
        project_id: projectId,
        platform,
        post_type: postType,
        ...(articleId ? { article_id: articleId } : {}),
      });
      onCreated(post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setPhase("form");
    }
  }

  async function handleWriteManually() {
    setPhase("composing");
  }

  async function handleSaveManual() {
    if (!content.trim()) return;
    setError(null);
    try {
      const post = await createSocialPost({
        project_id: projectId,
        platform,
        post_type: postType,
        content: content.trim(),
        ...(articleId ? { article_id: articleId } : {}),
      });
      onCreated(post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post");
    }
  }

  const limit = CHAR_LIMITS[platform];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("social.newPostModal.title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("social.newPostModal.subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {phase === "generating" ? (
          <div className="p-10 flex flex-col items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Spinner size={28} />
            </div>
            <p className="text-sm font-medium text-foreground">{t("social.newPostModal.generating")}</p>
            <p className="text-xs text-muted-foreground text-center">
              {t("social.newPostModal.generatingHint", { platform: PLATFORM_LABELS[platform] })}
            </p>
          </div>
        ) : phase === "composing" ? (
          <div className="p-6 flex flex-col gap-4">
            {error && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <PlatformBadge platform={platform} />
              <span className="badge bg-accent text-muted-foreground">
                {t(POST_TYPE_I18N[postType])}
              </span>
            </div>
            <div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={6}
                placeholder="Write your post content…"
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
              <div className="mt-1 flex justify-end">
                <CharCount count={content.length} limit={limit} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPhase("form")}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                {t("social.newPostModal.back")}
              </button>
              <button
                onClick={handleSaveManual}
                disabled={!content.trim()}
                className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("social.newPostModal.createPost")}
              </button>
            </div>
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
                {t("social.newPostModal.platform")}
              </label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {t("social.newPostModal.postType")}
              </label>
              <select
                value={postType}
                onChange={(e) => setPostType(e.target.value as SocialPostType)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {POST_TYPES.map((ptOpt) => (
                  <option key={ptOpt} value={ptOpt}>
                    {t(POST_TYPE_I18N[ptOpt])}
                  </option>
                ))}
              </select>
            </div>

            {readyArticles.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  {t("social.newPostModal.sourceArticle")}{" "}
                  <span className="font-normal text-muted-foreground">({t("social.newPostModal.optional")})</span>
                </label>
                <select
                  value={articleId}
                  onChange={(e) => setArticleId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">{t("social.newPostModal.none")}</option>
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
                {t("social.newPostModal.cancel")}
              </button>
              <button
                onClick={handleGenerate}
                className="flex-1 btn-primary px-4 py-2 text-sm flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("social.newPostModal.generateWithAI")}
              </button>
              <button
                onClick={handleWriteManually}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                {t("social.newPostModal.writeManually")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit Drawer ─────────────────────────────────────────────────────────────

function EditDrawer({
  post,
  projectId,
  onClose,
}: {
  post: SocialPost;
  projectId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState(post.content);
  const [hashtags, setHashtags] = useState<string[]>(post.hashtags ?? []);
  const [hashtagInput, setHashtagInput] = useState("");
  const [scheduledAt, setScheduledAt] = useState(
    post.scheduled_at
      ? new Date(post.scheduled_at).toISOString().slice(0, 16)
      : "",
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limit = CHAR_LIMITS[post.platform];

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateSocialPost>[1]) =>
      updateSocialPost(post.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-posts", projectId] });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: (dateStr: string) => scheduleSocialPost(post.id, new Date(dateStr).toISOString()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-posts", projectId] });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    },
  });

  function handleContentBlur() {
    if (content !== post.content) {
      setSaveState("saving");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateMutation.mutate({ content });
      }, 1000);
    }
  }

  function handleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const patch: Parameters<typeof updateSocialPost>[1] = { content, hashtags };
    updateMutation.mutate(patch);
    if (scheduledAt) {
      scheduleMutation.mutate(scheduledAt);
    }
  }

  function handleAddHashtag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const tag = hashtagInput.trim().replace(/^#/, "");
      if (tag && !hashtags.includes(tag)) {
        setHashtags((prev) => [...prev, tag]);
      }
      setHashtagInput("");
    }
  }

  function handleRemoveHashtag(tag: string) {
    setHashtags((prev) => prev.filter((ht) => ht !== tag));
  }

  const handleContentChange = useCallback((val: string) => {
    setContent(val);
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-96 z-50 border-l border-border bg-card shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformBadge platform={post.platform} />
            <span className="badge bg-accent text-muted-foreground text-xs">
              {t(POST_TYPE_I18N[post.post_type])}
            </span>
            <StatusBadge status={post.status} />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Content textarea */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              {t("social.editDrawer.content")}
            </label>
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onBlur={handleContentBlur}
              rows={8}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              placeholder="Post content…"
            />
            <div className="mt-1 flex justify-end">
              <CharCount count={content.length} limit={limit} />
            </div>
          </div>

          {/* Hashtags */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              {t("social.editDrawer.hashtags")}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {hashtags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-foreground"
                >
                  #{tag}
                  <button
                    onClick={() => handleRemoveHashtag(tag)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <input
              value={hashtagInput}
              onChange={(e) => setHashtagInput(e.target.value)}
              onKeyDown={handleAddHashtag}
              placeholder="Type a tag and press Enter…"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Schedule (shown for scheduled posts or drafts with a date set) */}
          {(post.status === "scheduled" || post.status === "draft") && (
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {t("social.editDrawer.schedule")}
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          {/* Error message */}
          {(updateMutation.isError || scheduleMutation.isError) && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {updateMutation.error instanceof Error
                ? updateMutation.error.message
                : scheduleMutation.error instanceof Error
                ? scheduleMutation.error.message
                : "Something went wrong"}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border shrink-0 flex items-center gap-3">
          {saveState === "saving" && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Spinner size={12} /> {t("social.editDrawer.saving")}
            </span>
          )}
          {saveState === "saved" && (
            <span className="text-xs text-emerald-500">{t("social.editDrawer.saved")}</span>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              {t("social.editDrawer.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending || scheduleMutation.isPending}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {(updateMutation.isPending || scheduleMutation.isPending) ? (
                <><Spinner size={14} /> {t("social.editDrawer.saving")}</>
              ) : (
                t("social.editDrawer.save")
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Platform Tabs ───────────────────────────────────────────────────────────

type PlatformFilter = SocialPlatform | "all";

function PlatformTabs({
  active,
  onChange,
}: {
  active: PlatformFilter;
  onChange: (p: PlatformFilter) => void;
}) {
  const { t } = useTranslation();
  const tabs: { value: PlatformFilter; label: string }[] = [
    { value: "all", label: t("social.platformTabs.all") },
    { value: "linkedin", label: t("social.platformTabs.linkedin") },
    { value: "twitter", label: t("social.platformTabs.twitter") },
    { value: "instagram", label: t("social.platformTabs.instagram") },
    { value: "facebook", label: t("social.platformTabs.facebook") },
  ];

  return (
    <div className="flex gap-1 border-b border-border pb-0">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === tab.value
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.value !== "all" && (
            <PlatformIcon platform={tab.value as SocialPlatform} size={14} />
          )}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function SocialPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const { setCurrentProject } = useProjectStore();
  const queryClient = useQueryClient();

  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  const { data: posts = [], isLoading } = useQuery<SocialPost[]>({
    queryKey: ["social-posts", projectId, platformFilter],
    queryFn: () =>
      listSocialPosts(
        projectId,
        platformFilter === "all" ? undefined : platformFilter,
      ),
  });

  function handleCreated(post: SocialPost) {
    setShowNewModal(false);
    queryClient.invalidateQueries({ queryKey: ["social-posts", projectId] });
    setEditingPost(post);
  }

  const filteredPosts = posts;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title={t("social.title")}
        icon={Share2}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: t("social.title") }]}
        description={t("social.subtitle")}
        actions={
          <button
            onClick={() => setShowNewModal(true)}
            className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("social.newPost")}
          </button>
        }
      />

      {/* Platform tabs */}
      <PlatformTabs active={platformFilter} onChange={setPlatformFilter} />

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner size={28} />
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 rounded-xl border border-dashed border-border">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              {t("social.noPosts")}{platformFilter !== "all" ? ` for ${PLATFORM_LABELS[platformFilter]}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("social.noPostsHint")}
            </p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
          >
            <Plus className="h-4 w-4" />
            {t("social.createPost")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredPosts.map((post) => (
            <SocialPostCard
              key={post.id}
              post={post}
              projectId={projectId}
              onEdit={setEditingPost}
            />
          ))}
        </div>
      )}

      {/* New post modal */}
      {showNewModal && (
        <NewPostModal
          projectId={projectId}
          onClose={() => setShowNewModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Edit drawer */}
      {editingPost && (
        <EditDrawer
          post={editingPost}
          projectId={projectId}
          onClose={() => setEditingPost(null)}
        />
      )}
    </div>
  );
}
