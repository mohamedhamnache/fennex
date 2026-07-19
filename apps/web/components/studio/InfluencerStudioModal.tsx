"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Sparkles, Loader2, Copy, Check, Clock, Save, Wand2, Twitter } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  generateSocialStudio, createSocialPost, type SocialPlatform, type StudioVariant,
} from "@/lib/api";
import { LinkedInIcon, InstagramIcon, FacebookIcon, TikTokIcon } from "@/components/studio/SocialIcons";

type IconCmp = React.ComponentType<{ className?: string }>;

const PLATFORMS: { id: SocialPlatform; label: string; Icon: IconCmp; limit: number }[] = [
  { id: "linkedin", label: "LinkedIn", Icon: LinkedInIcon, limit: 3000 },
  { id: "instagram", label: "Instagram", Icon: InstagramIcon, limit: 2200 },
  { id: "twitter", label: "X", Icon: (p) => <Twitter {...p} />, limit: 280 },
  { id: "facebook", label: "Facebook", Icon: FacebookIcon, limit: 2000 },
  { id: "tiktok", label: "TikTok", Icon: TikTokIcon, limit: 2200 },
];
const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));

const TONES = ["professional", "casual", "bold", "playful", "inspirational"];

function replaceFirstLine(text: string, hook: string): string {
  const nl = text.indexOf("\n");
  return nl === -1 ? hook : hook + text.slice(nl);
}

interface Props {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function InfluencerStudioModal({ projectId, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState("");
  const [keyword, setKeyword] = useState("");
  const [tone, setTone] = useState("professional");
  const [selected, setSelected] = useState<SocialPlatform[]>(["linkedin", "instagram", "twitter"]);
  const [variants, setVariants] = useState<StudioVariant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  function togglePlatform(id: SocialPlatform) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function handleGenerate() {
    if (busy || !topic.trim() || selected.length === 0) return;
    setBusy(true);
    setError(null);
    setSaved(new Set());
    try {
      const res = await generateSocialStudio({ project_id: projectId, topic: topic.trim(), platforms: selected, tone, keyword: keyword.trim() || null });
      if (!res.ok) {
        setError(res.error === "no_ai_key" ? t("influencerStudio.errors.no_ai_key") : t("influencerStudio.errors.generic"));
        return;
      }
      setVariants(res.variants);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("influencerStudio.errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  function updateContent(platform: string, content: string) {
    setVariants((vs) => vs.map((v) => (v.platform === platform ? { ...v, content, char_count: content.length } : v)));
  }

  async function saveVariant(v: StudioVariant) {
    if (saved.has(v.platform)) return;
    try {
      await createSocialPost({ project_id: projectId, platform: v.platform, post_type: "tip", content: v.content, hashtags: v.hashtags });
      setSaved((s) => new Set(s).add(v.platform));
      onSaved();
    } catch {
      setError(t("influencerStudio.errors.saveFailed"));
    }
  }

  async function copyVariant(v: StudioVariant) {
    const text = v.hashtags.length ? `${v.content}\n\n${v.hashtags.join(" ")}` : v.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(v.platform);
      setTimeout(() => setCopied((c) => (c === v.platform ? null : c)), 1500);
    } catch { /* ignore */ }
  }

  const hasResults = variants.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wand2 className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("influencerStudio.title")}</h2>
              <p className="text-[11px] text-muted-foreground">{t("influencerStudio.subtitle")}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {/* Brief */}
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">{t("influencerStudio.topicLabel")}</span>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={2}
                placeholder={t("influencerStudio.topicPlaceholder")}
                className="resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 160 }}>
                <span className="text-xs font-semibold text-foreground">{t("influencerStudio.keywordLabel")}</span>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder={t("influencerStudio.keywordPlaceholder")}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-foreground">{t("influencerStudio.toneLabel")}</span>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                >
                  {TONES.map((tn) => (
                    <option key={tn} value={tn}>{t(`influencerStudio.tones.${tn}`)}</option>
                  ))}
                </select>
              </label>
            </div>
            {/* Networks */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">{t("influencerStudio.networksLabel")}</span>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => {
                  const on = selected.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlatform(p.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        on ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <p.Icon className="h-3.5 w-3.5" /> {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || !topic.trim() || selected.length === 0}
                className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {hasResults ? t("influencerStudio.regenerate") : t("influencerStudio.generate")}
              </button>
            </div>
          </div>

          {/* Variants */}
          {hasResults && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              {variants.map((v) => {
                const cfg = PLATFORM_MAP[v.platform];
                const over = cfg && v.char_count > cfg.limit;
                return (
                  <div key={v.platform} className="rounded-xl border border-border bg-background/50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        {cfg && <cfg.Icon className="h-4 w-4" />} {cfg?.label ?? v.platform}
                      </span>
                      <span className={cn("text-[11px] tabular-nums", over ? "text-destructive font-semibold" : "text-muted-foreground")}>
                        {v.char_count}{cfg ? `/${cfg.limit}` : ""}
                      </span>
                    </div>
                    {/* Hook options */}
                    {v.hooks.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{t("influencerStudio.hooks")}</span>
                        {v.hooks.map((h, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => updateContent(v.platform, replaceFirstLine(v.content, h))}
                            title={t("influencerStudio.useHook")}
                            className="max-w-[220px] truncate rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea
                      value={v.content}
                      onChange={(e) => updateContent(v.platform, e.target.value)}
                      rows={5}
                      className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                    />
                    {v.hashtags.length > 0 && (
                      <p className="mt-1 line-clamp-1 text-[11px] text-primary/80">{v.hashtags.join(" ")}</p>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {v.best_time ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" /> {t("influencerStudio.bestTime")}: {t(`influencerStudio.days.${v.best_time.day}`)} {v.best_time.time}
                        </span>
                      ) : <span />}
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => copyVariant(v)} className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                          {copied === v.platform ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                          {t("influencerStudio.copy")}
                        </button>
                        <button
                          type="button"
                          onClick={() => saveVariant(v)}
                          disabled={saved.has(v.platform)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                            saved.has(v.platform) ? "bg-success/10 text-success" : "bg-primary text-primary-foreground hover:bg-primary/90",
                          )}
                        >
                          {saved.has(v.platform) ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                          {saved.has(v.platform) ? t("influencerStudio.saved") : t("influencerStudio.saveDraft")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
