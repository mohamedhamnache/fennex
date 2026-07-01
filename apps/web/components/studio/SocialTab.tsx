"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { generateImage, type GeneratedImage } from "@/lib/api";
import {
  InstagramIcon,
  YoutubeIcon,
  LinkedInIcon,
  FacebookIcon,
  TikTokIcon,
  PinterestIcon,
} from "./SocialIcons";

type IconComponent = React.ComponentType<{ className?: string }>;

const PLATFORMS: { id: string; label: string; size: string; Icon: IconComponent }[] = [
  { id: "instagram_post",    label: "Instagram Post",    size: "1080×1080", Icon: InstagramIcon },
  { id: "instagram_story",   label: "Instagram Story",   size: "1080×1920", Icon: InstagramIcon },
  { id: "youtube_thumbnail", label: "YouTube Thumbnail", size: "1280×720",  Icon: YoutubeIcon },
  { id: "linkedin_banner",   label: "LinkedIn Banner",   size: "1584×396",  Icon: LinkedInIcon },
  { id: "linkedin_post",     label: "LinkedIn Post",     size: "1200×627",  Icon: LinkedInIcon },
  { id: "facebook_ad",       label: "Facebook Ad",       size: "1200×628",  Icon: FacebookIcon },
  { id: "tiktok_cover",      label: "TikTok Cover",      size: "1080×1920", Icon: TikTokIcon },
  { id: "pinterest_pin",     label: "Pinterest Pin",     size: "1000×1500", Icon: PinterestIcon },
];

interface SocialTabProps {
  projectId: string;
  subject: string;
  useBrandKit: boolean;
}

export function SocialTab({ projectId, subject, useBrandKit }: SocialTabProps) {
  const [selected, setSelected] = useState<string[]>(["instagram_post"]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  function togglePlatform(id: string) {
    if (isRunning) return;
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleGenerate() {
    if (selected.length === 0 || isRunning) return;

    const platforms = selected;
    setPending(new Set(platforms));
    setDone(new Set());
    setFailed(new Set());
    setResults([]);
    setIsRunning(true);

    await Promise.allSettled(
      platforms.map(async (platform) => {
        try {
          const img = await generateImage({
            project_id: projectId,
            title: subject || "Social media content",
            usage: "social_post",
            social_platform: platform,
            use_brand_kit: useBrandKit,
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
  }

  const allFinished = !isRunning && (done.size > 0 || failed.size > 0);

  return (
    <div className="flex flex-col gap-3 p-4">
      {subject.trim() ? (
        <p className="text-xs text-muted-foreground">
          Subject: <span className="text-foreground font-medium line-clamp-1">{subject}</span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Enter a prompt or subject on the Generate tab, then pick platforms below.
        </p>
      )}

      <div className="flex flex-col gap-1">
        {PLATFORMS.map((p) => {
          const isPending = pending.has(p.id);
          const isDone = done.has(p.id);
          const isFailed = failed.has(p.id);

          return (
            <button
              key={p.id}
              type="button"
              onClick={() => togglePlatform(p.id)}
              disabled={isRunning}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                selected.includes(p.id) && !isDone && !isFailed
                  ? "border-primary bg-primary/10 text-primary"
                  : isDone
                  ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                  : isFailed
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-border/80",
                isRunning && "cursor-not-allowed opacity-80",
              )}
            >
              <p.Icon className="h-5 w-5 shrink-0" />
              <span className="flex-1 text-xs font-medium">{p.label}</span>
              <span className="text-[10px] tabular-nums shrink-0 text-muted-foreground">{p.size}</span>
              {isPending && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
              {isDone && <Check className="h-3 w-3 shrink-0 text-green-500" />}
              {isFailed && <span className="text-[10px] text-destructive shrink-0">✕</span>}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={selected.length === 0 || isRunning}
        onClick={handleGenerate}
        className="btn-primary w-full py-2 text-sm disabled:opacity-50 mt-1 flex items-center justify-center gap-2"
      >
        {isRunning ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Generating ({done.size + failed.size}/{selected.length})…</>
        ) : (
          <>
            {selected.length > 1 ? `Generate ${selected.length} formats` : "Generate"}
          </>
        )}
      </button>

      {allFinished && (
        <div className="rounded-lg bg-muted/50 border border-border px-3 py-2.5 flex flex-col gap-1">
          <p className="text-xs font-medium text-foreground">
            {done.size} image{done.size !== 1 ? "s" : ""} generated
            {failed.size > 0 && `, ${failed.size} failed`}
          </p>
          <a
            href={`/${projectId}/images`}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View in gallery <ArrowRight className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}
