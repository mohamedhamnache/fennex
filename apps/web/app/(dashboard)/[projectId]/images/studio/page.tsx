"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Wand2, Sparkles, Pencil, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  generateImage,
  uploadImage,
  listArticles,
  listSocialPosts,
  type GeneratedImage,
  type ImageStyle,
  type ImageUsage,
  type Article,
  type SocialPost,
} from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { addToHistory } from "@/components/studio/prompt-storage";
import { StudioLeftPanel } from "@/components/studio/StudioLeftPanel";
import { StudioRightPanel } from "@/components/studio/StudioRightPanel";
import { AttachModal } from "@/components/studio/AttachModal";
import { CreateLauncher, type CreateIntent } from "@/components/studio/CreateLauncher";
import { EditLauncher } from "@/components/studio/EditLauncher";
import { AiStudioChat } from "@/components/studio/AiStudioChat";
import { ProductStudio } from "@/components/studio/ProductStudio";
import { SocialStudio } from "@/components/studio/SocialStudio";

type StudioMode = "create" | "edit" | "ai";

interface PastRun {
  prompt: string;
  images: GeneratedImage[];
  batchCount: number;
}

export default function StudioPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setCurrentProject } = useProjectStore();

  // Studio shell: which front door is active, and (for Create) the chosen intent.
  // Initial values can be deep-linked from the dashboard via ?mode= and ?intent=.
  const VALID_MODES: StudioMode[] = ["create", "edit", "ai"];
  const VALID_INTENTS: CreateIntent[] = ["social", "product", "blog", "banner", "freeform"];
  const paramMode = searchParams.get("mode") as StudioMode | null;
  const paramIntent = searchParams.get("intent") as CreateIntent | null;
  const [mode, setMode] = useState<StudioMode>(
    paramMode && VALID_MODES.includes(paramMode) ? paramMode : "create",
  );
  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(
    paramIntent && VALID_INTENTS.includes(paramIntent) ? paramIntent : null,
  );

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

  async function handleUpload(file: File) {
    const skeleton = {
      id: `upload-${Date.now()}`,
      status: "generating",
      prompt: "Uploading...",
    } as GeneratedImage;
    setCurrentImages((prev) => [skeleton, ...prev]);
    try {
      const img = await uploadImage(projectId, file);
      setCurrentImages((prev) => prev.map((i) => i?.id === skeleton.id ? img : i));
    } catch {
      setCurrentImages((prev) => prev.filter((i) => i?.id !== skeleton.id));
    }
  }

  // "Try a template" from empty state opens templates popover in left panel
  // We use a ref-based trigger; simplest approach: lift a flag
  const [triggerTemplates, setTriggerTemplates] = useState(false);

  function handlePickIntent(i: CreateIntent) {
    // Seed sensible defaults per intent
    if (i === "blog") setUsage("article_cover");
    else if (i === "freeform") setUsage("custom");
    else if (i === "social") setUsage("social_post");
    setCreateIntent(i);
  }

  const MODES: { id: StudioMode; label: string; Icon: LucideIcon }[] = [
    { id: "create", label: "Create", Icon: Sparkles },
    { id: "edit",   label: "Edit",   Icon: Pencil },
    { id: "ai",     label: "AI Studio", Icon: Wand2 },
  ];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
      {/* Studio header with mode switcher */}
      <div className="flex items-center justify-between border-b border-border bg-card/30 px-5 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/${projectId}/images`)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Library
          </button>
          <span className="text-muted-foreground/40">/</span>
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg gradient-brand text-white">
              <Sparkles className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <span className="font-display text-base font-bold tracking-tight text-foreground">Image Studio</span>
          </span>
        </div>

        {/* Segmented mode switcher */}
        <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                mode === id
                  ? "bg-card text-primary shadow-sm ring-1 ring-inset ring-primary/15"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>

        {/* Spacer to balance the flex layout so the switcher stays centered-ish */}
        <div className="hidden w-[120px] lg:block" />
      </div>

      {/* Body — one of three front doors */}
      <div className="flex-1 overflow-hidden">
        {mode === "create" && createIntent === null && (
          <CreateLauncher onPick={handlePickIntent} />
        )}

        {/* Product gets a dedicated full-width studio (upload → scenes → set) */}
        {mode === "create" && createIntent === "product" && (
          <ProductStudio
            projectId={projectId}
            useBrandKit={useBrandKit}
            onBack={() => setCreateIntent(null)}
          />
        )}

        {/* Social gets a dedicated full-width studio (topic → platforms → set + captions) */}
        {mode === "create" && createIntent === "social" && (
          <SocialStudio
            projectId={projectId}
            useBrandKit={useBrandKit}
            onBack={() => setCreateIntent(null)}
          />
        )}

        {mode === "create" && createIntent !== null && createIntent !== "product" && createIntent !== "social" && (
          <div className="flex h-full overflow-hidden">
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
                intent={createIntent}
                onBack={() => setCreateIntent(null)}
              />
            </div>
            <div className="flex-1 overflow-hidden">
              <StudioRightPanel
                currentImages={currentImages}
                batchCount={batchCount}
                pastRuns={pastRuns}
                projectId={projectId}
                onUse={setAttachingImage}
                onRegenerate={handleRegenerate}
                onPastRegenerate={handlePastRegenerate}
                onOpenTemplates={() => setTriggerTemplates((v) => !v)}
                onUpload={handleUpload}
              />
            </div>
          </div>
        )}

        {mode === "edit" && <EditLauncher projectId={projectId} />}

        {mode === "ai" && <AiStudioChat projectId={projectId} useBrandKit={useBrandKit} />}
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
