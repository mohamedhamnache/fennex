"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles, Bot, User, Wand2, Pencil, Loader2, Copy, Check, AlertCircle, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/cn";
import { planCampaign, generateImage, type GeneratedImage, type CampaignPlan } from "@/lib/api";
import { SaveCollectionButton } from "./SaveCollectionButton";

interface AiStudioChatProps {
  projectId: string;
  useBrandKit: boolean;
}

type AssetResult = { status: "loading" | "ready" | "error"; image?: GeneratedImage };

type ChatMessage =
  | { id: string; role: "user"; kind: "text"; text: string }
  | { id: string; role: "assistant"; kind: "text"; text: string; error?: boolean }
  | { id: string; role: "assistant"; kind: "plan"; plan: CampaignPlan; results: AssetResult[] };

const STARTERS = [
  "Launch my oat-milk latte on Instagram",
  "A product page set for my leather wallet on Shopify",
  "Blog cover + inline images for an article on remote work",
  "A summer sale campaign across social platforms",
];

const PLATFORM_LABEL: Record<string, string> = {
  instagram_post: "IG Post",
  instagram_story: "IG Story",
  instagram_reel: "IG Reel",
  youtube_thumbnail: "YouTube",
  linkedin_banner: "LinkedIn Banner",
  linkedin_post: "LinkedIn",
  facebook_ad: "Facebook Ad",
  tiktok_cover: "TikTok",
  pinterest_pin: "Pinterest",
};

let idc = 0;
const nextId = () => `m-${Date.now()}-${idc++}`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy caption"}
    </button>
  );
}

export function AiStudioChat({ projectId, useBrandKit }: AiStudioChatProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [planning, setPlanning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, planning]);

  const updateResult = useCallback((msgId: string, index: number, res: AssetResult) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId && m.role === "assistant" && m.kind === "plan") {
          const results = [...m.results];
          results[index] = res;
          return { ...m, results };
        }
        return m;
      }),
    );
  }, []);

  const run = useCallback(
    async (goal: string) => {
      const trimmed = goal.trim();
      if (!trimmed || planning) return;
      setInput("");
      setPlanning(true);
      setMessages((prev) => [...prev, { id: nextId(), role: "user", kind: "text", text: trimmed }]);

      const thinkingId = nextId();
      setMessages((prev) => [
        ...prev,
        { id: thinkingId, role: "assistant", kind: "text", text: "Planning your campaign…" },
      ]);

      let plan: CampaignPlan;
      try {
        plan = await planCampaign(trimmed, useBrandKit, projectId);
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId
              ? { id: m.id, role: "assistant", kind: "text", error: true, text: `Couldn't plan that: ${e instanceof Error ? e.message : "unknown error"}` }
              : m,
          ),
        );
        setPlanning(false);
        return;
      }

      // Replace the thinking bubble with the plan (assets start as loading)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? { id: thinkingId, role: "assistant", kind: "plan", plan, results: plan.assets.map(() => ({ status: "loading" as const })) }
            : m,
        ),
      );
      setPlanning(false);

      // Generate each asset in parallel, filling thumbnails as they resolve
      plan.assets.forEach((asset, i) => {
        generateImage({
          project_id: projectId,
          prompt: asset.prompt,
          style: asset.style,
          usage: asset.usage,
          quality: "standard",
          use_brand_kit: useBrandKit,
          social_platform: asset.platform ?? undefined,
        })
          .then((img) =>
            updateResult(thinkingId, i, img.status === "ready" && img.image_url ? { status: "ready", image: img } : { status: "error" }),
          )
          .catch(() => updateResult(thinkingId, i, { status: "error" }));
      });
    },
    [planning, projectId, useBrandKit, updateResult],
  );

  const hasChat = messages.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 py-6 flex flex-col gap-4">
          {/* Empty state */}
          {!hasChat && (
            <div className="animate-fade-in pt-6">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/80 to-primary shadow-sm">
                  <Sparkles className="h-6 w-6 text-white" strokeWidth={1.7} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Sirocco · Creative Director</h2>
                  <p className="mt-1 text-sm text-muted-foreground max-w-md">
                    Tell Sirocco your goal and it will plan a coordinated campaign — a matched set of visuals with captions, ready to generate.
                  </p>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => run(s)}
                    className="group flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-left text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
                  >
                    <Wand2 className="h-3.5 w-3.5 shrink-0 text-primary/60 group-hover:text-primary transition-colors" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex gap-2.5 animate-msg-in", m.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center shrink-0 shadow-sm",
                  m.role === "user" ? "bg-muted" : "bg-gradient-to-br from-primary/80 to-primary",
                )}
              >
                {m.role === "user" ? <User className="h-3.5 w-3.5 text-muted-foreground" /> : <Bot className="h-3.5 w-3.5 text-white" />}
              </div>

              <div className={cn("flex flex-col gap-2 min-w-0", m.role === "user" ? "items-end max-w-[85%]" : "items-start w-full")}>
                {/* Text bubbles */}
                {m.kind === "text" && (
                  <div
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : m.error
                        ? "bg-destructive/10 text-destructive rounded-bl-sm"
                        : "bg-muted text-foreground rounded-bl-sm",
                    )}
                  >
                    {m.role === "assistant" && m.error && <AlertCircle className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
                    {m.text}
                  </div>
                )}

                {/* Campaign plan */}
                {m.kind === "plan" && (
                  <div className="w-full rounded-2xl rounded-bl-sm border border-border bg-card p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <LayoutGrid className="h-4 w-4 text-primary shrink-0" strokeWidth={1.8} />
                      <p className="text-sm font-semibold text-foreground">{m.plan.title}</p>
                    </div>
                    {m.plan.summary && (
                      <p className="text-xs text-muted-foreground leading-relaxed mb-3">{m.plan.summary}</p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {m.plan.assets.map((asset, i) => {
                        const res = m.results[i];
                        return (
                          <div key={i} className="rounded-xl border border-border overflow-hidden bg-background">
                            {/* Visual */}
                            <div className="group relative aspect-square bg-muted">
                              {res?.status === "ready" && res.image?.image_url ? (
                                <>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={res.image.image_url} alt={asset.title} className="absolute inset-0 h-full w-full object-cover" />
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/${projectId}/images/edit/${res.image!.id}`)}
                                    className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-lg bg-background/95 px-2 py-1 text-[10px] font-semibold text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                  >
                                    <Pencil className="h-3 w-3 text-primary" /> Edit
                                  </button>
                                </>
                              ) : res?.status === "error" ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-destructive">
                                  <AlertCircle className="h-5 w-5" />
                                  <span className="text-[10px]">Failed</span>
                                </div>
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            {/* Meta */}
                            <div className="p-2.5 flex flex-col gap-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-foreground truncate">{asset.title}</span>
                                {asset.platform && (
                                  <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                                    {PLATFORM_LABEL[asset.platform] ?? asset.platform}
                                  </span>
                                )}
                              </div>
                              {asset.caption && (
                                <>
                                  <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">{asset.caption}</p>
                                  <CopyButton text={asset.caption} />
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Save the generated set as a collection */}
                    {m.results.some((r) => r?.status === "ready") && (
                      <div className="mt-3 flex justify-end">
                        <SaveCollectionButton
                          projectId={projectId}
                          imageIds={m.results.filter((r) => r?.status === "ready" && r.image).map((r) => r.image!.id)}
                          defaultName={m.plan.title}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {planning && (
            <div className="flex gap-2.5 animate-msg-in">
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3 flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all overflow-hidden">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  run(input);
                }
              }}
              placeholder='Describe your goal — e.g. "a launch campaign for my new coffee blend"'
              rows={2}
              className="flex-1 resize-none bg-transparent px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="button"
              disabled={!input.trim() || planning}
              onClick={() => run(input)}
              className="m-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
            I&apos;ll plan a matched set of visuals · Enter to send{useBrandKit ? " · Brand kit on" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
