"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2, ExternalLink, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { generateImage, type GeneratedImage, type ImageStyle } from "@/lib/api";
import {
  InstagramIcon,
  YoutubeIcon,
  LinkedInIcon,
  FacebookIcon,
  TikTokIcon,
  PinterestIcon,
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
      { id: "facebook_ad",   label: "Facebook Ad",    size: "1200×628",  aspect: "1.91:1", Icon: FacebookIcon },
      { id: "tiktok_cover",  label: "TikTok Cover",   size: "1080×1920", aspect: "9:16",   Icon: TikTokIcon },
      { id: "pinterest_pin", label: "Pinterest Pin",  size: "1000×1500", aspect: "2:3",    Icon: PinterestIcon },
    ],
  },
];

const ALL_PLATFORM_IDS = PLATFORM_GROUPS.flatMap((g) => g.platforms.map((p) => p.id));

function AspectPreview({ aspect }: { aspect: string }) {
  const [w, h] = aspect.split(":").map(Number);
  const ratio = (w && h) ? w / h : 1;
  const isLandscape = ratio > 1;
  const isPortrait = ratio < 1;
  return (
    <span
      className="inline-block shrink-0 rounded-[2px] border border-current opacity-40"
      style={{
        width:  isLandscape ? 18 : isPortrait ? 10 : 12,
        height: isLandscape ? 10 : isPortrait ? 18 : 12,
      }}
    />
  );
}

interface SocialTabProps {
  projectId: string;
  subject: string;
  useBrandKit: boolean;
  style?: ImageStyle;
  quality?: "standard" | "hd";
  onSwitchToGenerate?: () => void;
}

export function SocialTab({
  projectId,
  subject,
  useBrandKit,
  style,
  quality = "standard",
  onSwitchToGenerate,
}: SocialTabProps) {
  const [selected, setSelected] = useState<string[]>(["instagram_post", "instagram_story"]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [showResults, setShowResults] = useState(false);

  function togglePlatform(id: string) {
    if (isRunning) return;
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAll() {
    if (!isRunning) setSelected([...ALL_PLATFORM_IDS]);
  }

  function selectNone() {
    if (!isRunning) setSelected([]);
  }

  async function handleGenerate() {
    if (selected.length === 0 || isRunning) return;
    const platforms = selected;
    setPending(new Set(platforms));
    setDone(new Set());
    setFailed(new Set());
    setResults([]);
    setIsRunning(true);
    setShowResults(false);

    await Promise.allSettled(
      platforms.map(async (platform) => {
        try {
          const img = await generateImage({
            project_id: projectId,
            title: subject || "Social media content",
            usage: "social_post",
            social_platform: platform,
            use_brand_kit: useBrandKit,
            style,
            quality,
          });
          setResults((prev) => [...prev, img]);
          setDone((prev) => new Set([...prev, platform]));
        } catch {
          setFailed((prev) => new Set([...prev, platform]));
        } finally {
          setPending((prev) => {
            const next = new Set(prev);
            next.delete(platform);
            return next;
          });
        }
      }),
    );

    setIsRunning(false);
    setShowResults(true);
  }

  function handleReset() {
    setDone(new Set());
    setFailed(new Set());
    setResults([]);
    setShowResults(false);
    setPending(new Set());
  }

  const allFinished = !isRunning && (done.size > 0 || failed.size > 0);
  const allSelected = selected.length === ALL_PLATFORM_IDS.length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Subject preview */}
      {subject.trim() ? (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 flex items-start gap-2">
          <span className="text-xs text-muted-foreground shrink-0 mt-0.5">Subject</span>
          <p className="flex-1 text-xs font-medium text-foreground line-clamp-2">{subject}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-3 text-center">
          <p className="text-xs text-muted-foreground mb-2">
            Enter a prompt in the Generate tab to set the subject.
          </p>
          {onSwitchToGenerate && (
            <button
              type="button"
              onClick={onSwitchToGenerate}
              className="text-xs text-primary font-medium hover:underline"
            >
              Go to Generate tab →
            </button>
          )}
        </div>
      )}

      {/* Settings sync badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Settings from Generate tab</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
          {quality}
        </span>
        {style && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {style.replace(/_/g, " ")}
          </span>
        )}
        {useBrandKit && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            Brand kit
          </span>
        )}
      </div>

      {/* Platform selector */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-foreground">Platforms</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={allSelected ? selectNone : selectAll}
              disabled={isRunning}
              className="text-[10px] text-primary hover:underline disabled:opacity-40"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {PLATFORM_GROUPS.map((group) => (
            <div key={group.name}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5 px-0.5">
                {group.name}
              </p>
              <div className="flex flex-col gap-1">
                {group.platforms.map((p) => {
                  const isPending = pending.has(p.id);
                  const isDone = done.has(p.id);
                  const isFailed = failed.has(p.id);
                  const isSelected = selected.includes(p.id);

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlatform(p.id)}
                      disabled={isRunning}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        isSelected && !isDone && !isFailed
                          ? "border-primary bg-primary/10 text-primary"
                          : isDone
                          ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                          : isFailed
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-border/80",
                        isRunning && "cursor-not-allowed opacity-80",
                      )}
                    >
                      <p.Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-xs font-medium">{p.label}</span>
                      <AspectPreview aspect={p.aspect} />
                      <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{p.size}</span>
                      {isPending && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
                      {isDone && <Check className="h-3 w-3 shrink-0 text-green-500" />}
                      {isFailed && <X className="h-3 w-3 shrink-0 text-destructive" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Generate button */}
      <button
        type="button"
        disabled={selected.length === 0 || isRunning}
        onClick={handleGenerate}
        className="btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isRunning ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating {done.size + failed.size}/{selected.length}…
          </>
        ) : (
          selected.length > 1
            ? `Generate ${selected.length} formats`
            : selected.length === 1
            ? "Generate"
            : "Select a platform"
        )}
      </button>

      {/* Results */}
      {allFinished && (
        <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowResults((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/50 transition-colors"
          >
            <span className="text-xs font-medium text-foreground">
              {done.size} generated{failed.size > 0 ? `, ${failed.size} failed` : ""}
            </span>
            <div className="flex items-center gap-2">
              <a
                href={`/${projectId}/images`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Gallery <ExternalLink className="h-3 w-3" />
              </a>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", showResults && "rotate-180")} />
            </div>
          </button>

          {showResults && results.length > 0 && (
            <div className="border-t border-border px-3 pb-3 pt-2 grid grid-cols-2 gap-2">
              {results.map((img) => (
                <a
                  key={img.id}
                  href={`/${projectId}/images/edit/${img.id}`}
                  className="group block rounded-lg overflow-hidden border border-border bg-card hover:border-primary/50 transition-colors"
                >
                  {img.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.image_url}
                      alt={img.alt_text ?? img.prompt ?? "Generated image"}
                      className="w-full aspect-square object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-square bg-muted flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <p className="px-1.5 py-1 text-[9px] text-muted-foreground truncate group-hover:text-foreground transition-colors">
                    {img.social_platform?.replace(/_/g, " ") ?? "—"}
                  </p>
                </a>
              ))}
            </div>
          )}

          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Generate again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
