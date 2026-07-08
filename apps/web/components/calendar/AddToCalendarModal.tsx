"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X, FileText, Share2, Image as ImageIcon, Loader2 } from "lucide-react";
import {
  createCalendarEntry,
  listArticles,
  listSocialPosts,
  listImages,
  listPublishingConnections,
  type CalendarContentType,
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

interface AddToCalendarModalProps {
  projectId: string;
  defaultDate?: string;
  onClose: () => void;
}

const TYPE_ICON: Record<CalendarContentType, React.ElementType> = {
  article: FileText,
  social: Share2,
  banner: ImageIcon,
};

export function AddToCalendarModal({ projectId, defaultDate, onClose }: AddToCalendarModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [contentType, setContentType] = useState<CalendarContentType>("article");
  const [contentId, setContentId] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState<string>(defaultDate ?? "");
  const [connectionId, setConnectionId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const { data: articles = [] } = useQuery({
    queryKey: ["calendar-articles", projectId],
    queryFn: () => listArticles(projectId),
    enabled: contentType === "article",
  });
  const { data: socialPosts = [] } = useQuery({
    queryKey: ["calendar-social", projectId],
    queryFn: () => listSocialPosts(projectId),
    enabled: contentType === "social",
  });
  const { data: images = [] } = useQuery({
    queryKey: ["calendar-images", projectId],
    queryFn: () => listImages(projectId),
    enabled: contentType === "banner",
  });
  const { data: connections = [] } = useQuery({
    queryKey: ["calendar-connections", projectId],
    queryFn: () => listPublishingConnections(projectId),
    enabled: contentType !== "social",
  });

  const draftArticles = useMemo(
    () => articles.filter((a) => a.status !== "published"),
    [articles],
  );
  const draftSocialPosts = useMemo(
    () => socialPosts.filter((p) => p.status === "draft"),
    [socialPosts],
  );
  const bannerImages = useMemo(() => {
    const withFormat = images.filter((i) => !!i.banner_format);
    return withFormat.length > 0 ? withFormat : images;
  }, [images]);

  const wordpressConnections = useMemo(
    () => connections.filter((c) => c.platform === "wordpress"),
    [connections],
  );

  const items: { id: string; label: string }[] =
    contentType === "article"
      ? draftArticles.map((a) => ({ id: a.id, label: a.title }))
      : contentType === "social"
      ? draftSocialPosts.map((p) => ({ id: p.id, label: p.content.slice(0, 60) || p.id }))
      : bannerImages.map((i) => ({ id: i.id, label: i.seo_filename || i.prompt.slice(0, 60) || i.id }));

  function selectType(type: CalendarContentType) {
    setContentType(type);
    setContentId("");
    setConnectionId("");
  }

  const canSubmit = contentId.length > 0 && scheduledAt.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await createCalendarEntry(projectId, {
        content_type: contentType,
        content_id: contentId,
        scheduled_at: new Date(scheduledAt).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        target_kind: contentType === "social" ? "linkedin" : "wordpress",
        connection_id: contentType === "social" ? undefined : connectionId || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["calendar", projectId] });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const labelClass = "mb-1.5 block text-xs font-medium text-foreground";
  const inputClass =
    "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-0 transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-lg animate-scale-in max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">{t("calendar.addContent")}</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t("calendar.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(["article", "social", "banner"] as CalendarContentType[]).map((type) => {
              const Icon = TYPE_ICON[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => selectType(type)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors",
                    contentType === type
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                  {t(`calendar.type.${type}`)}
                </button>
              );
            })}
          </div>

          <div>
            <label className={labelClass}>{t(`calendar.type.${contentType}`)}</label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5">
              {items.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("calendar.empty")}</p>
              )}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setContentId(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    contentId === item.id
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 rounded-full border",
                      contentId === item.id ? "border-primary bg-primary" : "border-border",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass}>{t("calendar.pickDate")}</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className={inputClass}
            />
          </div>

          {contentType !== "social" && (
            <div>
              <label className={labelClass}>{t("calendar.target")}</label>
              <select
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className={inputClass}
              >
                <option value="">{t("calendar.targetWordpress")}</option>
                {wordpressConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t("calendar.cancel")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("calendar.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
