"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { attachImage } from "@/lib/api";
import type { GeneratedImage, Article, SocialPost } from "@/lib/api";

function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 className="animate-spin" style={{ width: size, height: size }} />;
}

interface AttachModalProps {
  image: GeneratedImage;
  projectId: string;
  articles: Article[];
  socialPosts: SocialPost[];
  onClose: () => void;
  onAttached: () => void;
}

export function AttachModal({
  image,
  projectId: _projectId,
  articles,
  socialPosts,
  onClose,
  onAttached,
}: AttachModalProps) {
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
    onSuccess: () => { onAttached(); },
    onError: (err) => { setError(err instanceof Error ? err.message : "Attach failed"); },
  });

  const readyArticles = articles.filter(
    (a) => a.status === "ready" || a.status === "published",
  );

  const canSubmit = attachTo === "article" ? !!selectedArticleId : !!selectedPostId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("images.attachModal.title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("images.attachModal.subtitle")}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">{t("images.attachModal.attachTo")}</label>
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
              <label className="block text-sm font-medium text-foreground mb-1.5">{t("images.attachModal.selectArticle")}</label>
              <select value={selectedArticleId} onChange={(e) => setSelectedArticleId(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">{t("images.attachModal.choose")}</option>
                {readyArticles.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t("images.attachModal.selectSocialPost")}</label>
              <select value={selectedPostId} onChange={(e) => setSelectedPostId(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">{t("images.attachModal.choose")}</option>
                {socialPosts.map((p) => <option key={p.id} value={p.id}>{p.platform} — {p.content.slice(0, 40)}{p.content.length > 40 ? "…" : ""}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors">
              {t("images.generateModal.cancel")}
            </button>
            <button
              onClick={() => attachMutation.mutate()}
              disabled={!canSubmit || attachMutation.isPending}
              className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {attachMutation.isPending ? <><Spinner size={14} /> {t("images.attachModal.attaching")}</> : t("images.attachModal.attach")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
