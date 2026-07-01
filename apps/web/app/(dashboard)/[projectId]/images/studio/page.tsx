"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wand2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  generateImage,
  listArticles,
  listSocialPosts,
  type GeneratedImage,
  type ImageStyle,
  type ImageUsage,
  type Article,
  type SocialPost,
} from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { addToHistory } from "@/components/studio/prompt-storage";
import { StudioLeftPanel } from "@/components/studio/StudioLeftPanel";
import { StudioRightPanel } from "@/components/studio/StudioRightPanel";
import { AttachModal } from "@/components/studio/AttachModal";

interface PastRun {
  prompt: string;
  images: GeneratedImage[];
  batchCount: number;
}

export default function StudioPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();
  const { setCurrentProject } = useProjectStore();

  // Controls state
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [style, setStyle] = useState<ImageStyle>("professional");
  const [quality, setQuality] = useState<"standard" | "hd">("standard");
  const [batchCount, setBatchCount] = useState<1 | 2 | 4>(1);
  const [usage, setUsage] = useState<ImageUsage>("article_cover");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [useBrandKit, setUseBrandKit] = useState(false);

  // Results state
  const [generating, setGenerating] = useState(false);
  const [currentImages, setCurrentImages] = useState<(GeneratedImage | null)[]>([]);
  const [pastRuns, setPastRuns] = useState<PastRun[]>([]);

  // Attach modal
  const [attachingImage, setAttachingImage] = useState<GeneratedImage | null>(null);

  useEffect(() => { setCurrentProject(projectId); }, [projectId, setCurrentProject]);

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
  });

  const { data: socialPosts = [] } = useQuery<SocialPost[]>({
    queryKey: ["social-posts", projectId],
    queryFn: () => listSocialPosts(projectId),
  });

  const runGeneration = useCallback(
    async (overridePrompt?: string, overrideBatch?: number) => {
      const activePrompt = overridePrompt ?? prompt;
      const activeBatch = overrideBatch ?? batchCount;

      // Move current results to past runs if there are any ready images
      setCurrentImages((prev) => {
        const readyImages = prev.filter((img): img is GeneratedImage => img !== null && img.status === "ready");
        if (readyImages.length > 0) {
          const archivedPrompt = readyImages[0]?.prompt ?? activePrompt;
          setPastRuns((runs) => [{ prompt: archivedPrompt, images: readyImages, batchCount: activeBatch }, ...runs]);
        }
        return [];
      });

      // Show skeletons immediately
      setCurrentImages(Array(activeBatch).fill(null));
      setGenerating(true);
      addToHistory(projectId, activePrompt.trim() || "Auto-generated");

      const requests = Array.from({ length: activeBatch }, () =>
        generateImage({
          project_id: projectId,
          prompt: activePrompt.trim() || undefined,
          style,
          usage,
          quality,
          reference_image: referenceImage ?? undefined,
          use_brand_kit: useBrandKit,
        }),
      );

      // Resolve each request independently
      requests.forEach((req, i) => {
        req
          .then((img) => {
            setCurrentImages((prev) => {
              const next = [...prev];
              next[i] = img;
              return next;
            });
          })
          .catch(() => {
            setCurrentImages((prev) => {
              const next = [...prev];
              // Keep skeleton on error — no crash
              return next;
            });
          });
      });

      await Promise.allSettled(requests);
      setGenerating(false);
    },
    [prompt, batchCount, projectId, style, usage, quality, referenceImage, useBrandKit],
  );

  function handleRegenerate(index: number) {
    const existingImage = currentImages[index];
    const activePrompt = existingImage?.prompt ?? prompt;
    generateImage({
      project_id: projectId,
      prompt: activePrompt.trim() || undefined,
      style,
      usage,
      quality,
      reference_image: referenceImage ?? undefined,
    }).then((img) => {
      setCurrentImages((prev) => {
        const next = [...prev];
        next[index] = img;
        return next;
      });
    });
    setCurrentImages((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }

  function handlePastRegenerate(runIndex: number, imageIndex: number) {
    const run = pastRuns[runIndex];
    const activePrompt = run.images[imageIndex]?.prompt ?? run.prompt;
    const skeleton = { ...run.images[imageIndex], status: "generating" } as GeneratedImage;
    setPastRuns((runs) => {
      const next = [...runs];
      next[runIndex] = {
        ...next[runIndex],
        images: next[runIndex].images.map((img, i) => (i === imageIndex ? skeleton : img)),
      };
      return next;
    });
    generateImage({
      project_id: projectId,
      prompt: activePrompt.trim() || undefined,
      style: run.images[imageIndex]?.style ?? style,
      usage: run.images[imageIndex]?.usage ?? usage,
      quality,
    }).then((img) => {
      setPastRuns((runs) => {
        const next = [...runs];
        next[runIndex] = {
          ...next[runIndex],
          images: next[runIndex].images.map((existing, i) => (i === imageIndex ? img : existing)),
        };
        return next;
      });
    });
  }

  // "Try a template" from empty state opens templates popover in left panel
  // We use a ref-based trigger; simplest approach: lift a flag
  const [triggerTemplates, setTriggerTemplates] = useState(false);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
      {/* Studio header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/${projectId}/images`)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Images
          </button>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" strokeWidth={1.8} />
            <span className="text-sm font-semibold text-foreground">Image Studio</span>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-[380px] shrink-0 border-r border-border overflow-hidden">
          <StudioLeftPanel
            projectId={projectId}
            prompt={prompt}
            onPromptChange={setPrompt}
            negativePrompt={negativePrompt}
            onNegativePromptChange={setNegativePrompt}
            style={style}
            onStyleChange={setStyle}
            quality={quality}
            onQualityChange={setQuality}
            batchCount={batchCount}
            onBatchCountChange={setBatchCount}
            usage={usage}
            onUsageChange={setUsage}
            referenceImage={referenceImage}
            onReferenceImageChange={setReferenceImage}
            useBrandKit={useBrandKit}
            onUseBrandKitChange={setUseBrandKit}
            onGenerate={() => runGeneration()}
            generating={generating}
          />
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-hidden">
          <StudioRightPanel
            currentImages={currentImages}
            batchCount={batchCount}
            pastRuns={pastRuns}
            onUse={setAttachingImage}
            onRegenerate={handleRegenerate}
            onPastRegenerate={handlePastRegenerate}
            onOpenTemplates={() => setTriggerTemplates((v) => !v)}
          />
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
          onAttached={() => setAttachingImage(null)}
        />
      )}
    </div>
  );
}
