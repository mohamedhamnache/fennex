"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Share2, Loader2, Sparkles, Pencil, Globe, AlertCircle,
  Check, Copy,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { StyleGrid } from "./StyleGrid";
import {
  generateImage, generateImageSeo, type GeneratedImage, type ImageStyle,
} from "@/lib/api";
import { PublishModal } from "./PublishModal";
import { SaveCollectionButton } from "./SaveCollectionButton";
import {
  InstagramIcon, YoutubeIcon, LinkedInIcon, FacebookIcon, TikTokIcon, PinterestIcon,
} from "./SocialIcons";

type IconComponent = React.ComponentType<{ className?: string }>;

interface Platform {
  id: string;
  label: string;
  size: string;
  aspect: string;
  Icon: IconComponent;
}

const PLATFORM_GROUPS: { name: string; platforms: Platform[] }[] = [
  {
    name: "Instagram",
    platforms: [
      { id: "instagram_post",  label: "Post",  size: "1080×1080", aspect: "1:1",  Icon: InstagramIcon },
      { id: "instagram_story", label: "Story", size: "1080×1920", aspect: "9:16", Icon: InstagramIcon },
      { id: "instagram_reel",  label: "Reel",  size: "1080×1920", aspect: "9:16", Icon: InstagramIcon },
    ],
  },
  {
    name: "YouTube",
    platforms: [
      { id: "youtube_thumbnail", label: "Thumbnail", size: "1280×720", aspect: "16:9", Icon: YoutubeIcon },
    ],
  },
  {
    name: "LinkedIn",
    platforms: [
      { id: "linkedin_post",   label: "Post",   size: "1200×627", aspect: "1.91:1", Icon: LinkedInIcon },
      { id: "linkedin_banner", label: "Banner", size: "1584×396", aspect: "4:1",    Icon: LinkedInIcon },
    ],
  },
  {
    name: "Other",
    platforms: [
      { id: "facebook_ad",   label: "Facebook Ad",   size: "1200×628",  aspect: "1.91:1", Icon: FacebookIcon },
      { id: "tiktok_cover",  label: "TikTok Cover",  size: "1080×1920", aspect: "9:16",   Icon: TikTokIcon },
      { id: "pinterest_pin", label: "Pinterest Pin", size: "1000×1500", aspect: "2:3",    Icon: PinterestIcon },
    ],
  },
];

const ALL_PLATFORMS = PLATFORM_GROUPS.flatMap((g) => g.platforms);
const ALL_IDS = ALL_PLATFORMS.map((p) => p.id);
const PLATFORM_BY_ID: Record<string, Platform> = Object.fromEntries(ALL_PLATFORMS.map((p) => [p.id, p]));

function aspectRatio(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  return w && h ? w / h : 1;
}

type SocialResult = {
  platform: string;
  status: "loading" | "ready" | "error";
  image?: GeneratedImage;
  caption?: string;
  captionLoading?: boolean;
  error?: string;
};

interface SocialStudioProps {
  projectId: string;
  useBrandKit: boolean;
  onBack: () => void;
}

function CaptionRow({ caption, loading }: { caption?: string; loading?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (loading) {
    return <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Writing caption…</p>;
  }
  if (!caption) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">{caption}</p>
      <button
        type="button"
        onClick={() => { navigator.clipboard.writeText(caption); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors self-start"
      >
        {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy caption"}
      </button>
    </div>
  );
}

export function SocialStudio({ projectId, useBrandKit, onBack }: SocialStudioProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<ImageStyle>("professional");
  const [selected, setSelected] = useState<Set<string>>(new Set(["instagram_post", "instagram_story"]));
  const [results, setResults] = useState<SocialResult[]>([]);
  const [generating, setGenerating] = useState(false);
  const [publishId, setPublishId] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const allSelected = selected.size === ALL_IDS.length;

  const setResultAt = useCallback((i: number, patch: Partial<SocialResult>) => {
    setResults((prev) => {
      const n = [...prev];
      n[i] = { ...n[i], ...patch };
      return n;
    });
  }, []);

  const canGenerate = topic.trim().length > 0 && selected.size > 0 && !generating;

  async function handleGenerate() {
    if (!canGenerate) return;
    const platforms = [...selected];
    setGenerating(true);
    setResults(platforms.map((platform) => ({ platform, status: "loading" })));

    await Promise.all(
      platforms.map(async (platform, i) => {
        try {
          const img = await generateImage({
            project_id: projectId,
            title: topic.trim(),
            usage: "social_post",
            social_platform: platform,
            style,
            use_brand_kit: useBrandKit,
          });
          if (img.status === "ready" && img.image_url) {
            setResultAt(i, { status: "ready", image: img, captionLoading: true });
            // Caption via the SEO endpoint (reuses existing infra)
            generateImageSeo(img.id)
              .then((seo) => setResultAt(i, { caption: seo.caption ?? "", captionLoading: false }))
              .catch(() => setResultAt(i, { captionLoading: false }));
          } else {
            setResultAt(i, { status: "error", error: img.error ?? "Generation failed" });
          }
        } catch (e) {
          setResultAt(i, { status: "error", error: e instanceof Error ? e.message : "Failed" });
        }
      }),
    );
    setGenerating(false);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-2.5 flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Share2 className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <span className="text-sm font-semibold text-foreground">Social post</span>
        <span className="text-xs text-muted-foreground">— one topic, every platform, captions included</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Config column */}
        <div className="w-[380px] shrink-0 border-r border-border overflow-y-auto p-4 flex flex-col gap-5">
          {/* Topic */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">1</span>
              <span className="text-xs font-semibold text-foreground">Topic</span>
            </div>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              placeholder="What's the post about? e.g. launching our new cold-brew coffee for summer"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>

          {/* Style */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">2</span>
              <span className="text-xs font-semibold text-foreground">Look &amp; feel</span>
            </div>
            <StyleGrid value={style} onChange={setStyle} />
          </div>

          {/* Platforms */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">3</span>
                <span className="text-xs font-semibold text-foreground">Platforms</span>
              </div>
              <button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(ALL_IDS))}
                className="text-[10px] text-primary hover:underline">
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {PLATFORM_GROUPS.map((group) => (
                <div key={group.name}>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5 px-0.5">{group.name}</p>
                  <div className="flex flex-col gap-1">
                    {group.platforms.map((p) => {
                      const on = selected.has(p.id);
                      return (
                        <button key={p.id} type="button" onClick={() => toggle(p.id)}
                          className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                            on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-border/80")}>
                          <p.Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-xs font-medium">{p.label}</span>
                          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{p.size}</span>
                          {on && <Check className="h-3 w-3 shrink-0 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results column */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">{results.length > 0 ? "Your social set" : "Results"}</p>
            <div className="flex items-center gap-2">
              {results.some((r) => r.status === "ready") && (
                <SaveCollectionButton
                  projectId={projectId}
                  imageIds={results.filter((r) => r.status === "ready" && r.image).map((r) => r.image!.id)}
                  defaultName={topic.trim() ? `${topic.trim().slice(0, 40)} — social set` : "Social set"}
                />
              )}
              <button type="button" disabled={!canGenerate} onClick={handleGenerate}
                className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                  canGenerate ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed")}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? "Generating…" : `Generate ${selected.size > 0 ? selected.size : ""} format${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-24 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <Share2 className="h-7 w-7 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">One topic, every format</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                  Write your topic, choose platforms, and we&apos;ll generate each at the right size with a ready-to-post caption.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {results.map((res, i) => {
                const meta = PLATFORM_BY_ID[res.platform];
                return (
                  <div key={i} className="rounded-xl border border-border overflow-hidden bg-card flex flex-col">
                    <div className="group relative w-full bg-muted" style={{ aspectRatio: meta ? aspectRatio(meta.aspect) : 1 }}>
                      {res.status === "ready" && res.image?.image_url ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={res.image.image_url} alt={meta?.label ?? res.platform} className="absolute inset-0 h-full w-full object-cover" />
                          <div className="absolute inset-0 flex items-end justify-end gap-1 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button type="button" onClick={() => router.push(`/${projectId}/images/edit/${res.image!.id}`)}
                              className="flex items-center gap-1 rounded-lg bg-background/95 px-2 py-1 text-[10px] font-semibold text-foreground">
                              <Pencil className="h-3 w-3 text-primary" /> Edit
                            </button>
                            <button type="button" onClick={() => setPublishId(res.image!.id)}
                              className="flex items-center gap-1 rounded-lg bg-background/95 px-2 py-1 text-[10px] font-semibold text-foreground">
                              <Globe className="h-3 w-3 text-primary" /> Publish
                            </button>
                          </div>
                        </>
                      ) : res.status === "error" ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-destructive px-2 text-center">
                          <AlertCircle className="h-5 w-5" />
                          <span className="text-[10px]">{res.error ?? "Failed"}</span>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="p-2.5 flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        {meta && <meta.Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        <span className="text-xs font-semibold text-foreground truncate">{meta?.label ?? res.platform}</span>
                        {meta && <span className="ml-auto text-[9px] tabular-nums text-muted-foreground shrink-0">{meta.size}</span>}
                      </div>
                      {res.status === "ready" && <CaptionRow caption={res.caption} loading={res.captionLoading} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {publishId && <PublishModal imageId={publishId} onClose={() => setPublishId(null)} />}
    </div>
  );
}
