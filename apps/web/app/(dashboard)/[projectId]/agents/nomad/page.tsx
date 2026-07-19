"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  Compass, Loader2, Send, Copy, ArrowRight, Check, MessageSquare,
  Lightbulb, CalendarDays, Quote, Sparkles, Linkedin, Target, Users, X,
} from "lucide-react";
import {
  planOutreach, generateTestimonialContent, generateIcp, createSocialPost,
  type OutreachPlan, type TestimonialPiece, type IcpSegment,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

const PIECE_LABEL: Record<string, string> = {
  linkedin_post: "LinkedIn post",
  case_study: "Case study",
  quote_card: "Quote card",
  website_blurb: "Website blurb",
};

const TESTIMONIAL_ERRORS: Record<string, string> = {
  no_ai_key: "Add an Anthropic or OpenAI key in Settings to generate content.",
  empty: "Paste a client testimonial first.",
  provider_unreachable: "Could not reach the AI provider — please try again.",
  bad_format: "The AI returned an unexpected format — please try again.",
};

function TestimonialTool({ projectId }: { projectId: string }) {
  const { success: showSuccess, error: showError } = useToast();
  const [testimonial, setTestimonial] = useState("");
  const [client, setClient] = useState("");
  const [service, setService] = useState("");
  const [pieces, setPieces] = useState<TestimonialPiece[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedLinkedIn, setSavedLinkedIn] = useState(false);

  async function generate() {
    if (busy || !testimonial.trim()) return;
    setBusy(true);
    setSavedLinkedIn(false);
    try {
      const res = await generateTestimonialContent(projectId, { testimonial, client, service });
      if (res.ok && res.pieces) setPieces(res.pieces);
      else showError("Couldn't generate", { message: TESTIMONIAL_ERRORS[res.error ?? ""] ?? "Please try again." });
    } catch {
      showError("Couldn't generate", { message: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    showSuccess("Copied", { message: "Text copied to clipboard." });
  }

  async function saveLinkedIn(content: string) {
    try {
      await createSocialPost({ project_id: projectId, platform: "linkedin", post_type: "tip", content });
      setSavedLinkedIn(true);
      showSuccess("Saved", { message: "Saved as a LinkedIn draft in Social." });
    } catch {
      showError("Couldn't save", { message: "Please try again." });
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Quote className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <h2 className="text-sm font-semibold text-foreground">Testimonial to content</h2>
        <span className="text-xs text-muted-foreground">— turn a client win into social proof</span>
      </div>
      <textarea
        value={testimonial}
        onChange={(e) => setTestimonial(e.target.value)}
        rows={3}
        placeholder="Paste a client testimonial… e.g. “Working with Sam doubled our booking rate in 6 weeks — clear communication and real results.”"
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={client}
          onChange={(e) => setClient(e.target.value)}
          placeholder="Client / company (optional)"
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          style={{ minWidth: 160 }}
        />
        <input
          value={service}
          onChange={(e) => setService(e.target.value)}
          placeholder="Service you provided (optional)"
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          style={{ minWidth: 160 }}
        />
        <button
          onClick={generate}
          disabled={busy || !testimonial.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Writing…" : "Generate"}
        </button>
      </div>

      {pieces && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pieces.map((p, i) => (
            <div key={i} className="flex flex-col rounded-xl border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {PIECE_LABEL[p.format] ?? p.format}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {p.format === "linkedin_post" && (
                    <button
                      onClick={() => saveLinkedIn(p.content)}
                      disabled={savedLinkedIn}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-60"
                    >
                      {savedLinkedIn ? <Check className="h-3 w-3 text-success" /> : <Linkedin className="h-3 w-3" />}
                      {savedLinkedIn ? "Saved" : "Save draft"}
                    </button>
                  )}
                  <button
                    onClick={() => copyText(p.content)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{p.content}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const GOAL_SUGGESTIONS = [
  "Attract new clients for my services",
  "Position myself as an expert in my niche",
  "Promote a new offer or package",
  "Grow my LinkedIn audience this month",
];

const TYPE_LABEL: Record<string, string> = {
  tip: "Tip",
  question: "Question",
  announcement: "Announcement",
  article_share: "Article share",
};

const ICP_ERRORS: Record<string, string> = {
  no_ai_key: "Add an Anthropic or OpenAI key in Settings to generate a profile.",
  provider_unreachable: "Could not reach the AI provider — please try again.",
  bad_format: "The AI returned an unexpected format — please try again.",
};

function IcpTool({
  projectId, onTarget, targetedName,
}: { projectId: string; onTarget: (s: IcpSegment) => void; targetedName: string | null }) {
  const { error: showError } = useToast();
  const [segments, setSegments] = useState<IcpSegment[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await generateIcp(projectId);
      if (res.ok && res.segments) setSegments(res.segments);
      else showError("Couldn't generate", { message: ICP_ERRORS[res.error ?? ""] ?? "Please try again." });
    } catch {
      showError("Couldn't generate", { message: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <h2 className="text-sm font-semibold text-foreground">Ideal client profile</h2>
        <span className="text-xs text-muted-foreground">— who to target (Oasis)</span>
        <button
          onClick={generate}
          disabled={busy}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "Researching…" : segments ? "Regenerate" : "Define my ICP"}
        </button>
      </div>

      {!segments ? (
        <p className="text-xs text-muted-foreground">
          Oasis maps 2-4 ideal client segments from your niche — their pains, where to find them, and the angle that lands. Target one to sharpen your outreach plan.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {segments.map((s, i) => {
            const on = targetedName === s.name;
            return (
              <div key={i} className={cn("flex flex-col rounded-xl border p-3", on ? "border-primary ring-1 ring-primary/40" : "border-border")}>
                <p className="text-sm font-bold text-foreground">{s.name}</p>
                <p className="mt-1 text-xs text-foreground/80">{s.description}</p>
                {s.pains.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Pains</p>
                    <ul className="mt-0.5 flex flex-col gap-0.5">
                      {s.pains.map((p, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-[11px] text-foreground/80">
                          <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />{p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.channels.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground"><span className="font-semibold">Find them:</span> {s.channels.join(", ")}</p>
                )}
                {s.angle && (
                  <p className="mt-1.5 rounded-lg bg-primary/5 px-2 py-1.5 text-[11px] italic text-foreground/80">“{s.angle}”</p>
                )}
                <button
                  onClick={() => onTarget(s)}
                  className={cn(
                    "mt-2.5 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    on ? "bg-success/10 text-success" : "border border-border text-foreground hover:bg-accent",
                  )}
                >
                  {on ? <><Check className="h-3.5 w-3.5" /> Targeting</> : <><Target className="h-3.5 w-3.5 text-primary" /> Target this</>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function NomadPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<OutreachPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [audience, setAudience] = useState<{ name: string; text: string } | null>(null);
  const { success: showSuccess, error: showError } = useToast();
  const queryClient = useQueryClient();

  async function generate() {
    setGenerating(true);
    try {
      const res = await planOutreach(projectId, goal, audience?.text);
      if (res.ok) {
        setPlan(res);
        queryClient.invalidateQueries({ queryKey: ["social"] });
        showSuccess("Plan ready", {
          message: `${res.drafts_saved ?? 0} posts saved as LinkedIn drafts in Social.`,
        });
      } else {
        showError("Plan failed", { message: res.error ?? "Please try again." });
      }
    } catch {
      showError("Plan failed", { message: "Could not reach the server." });
    } finally {
      setGenerating(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    showSuccess("Copied", { message: "Text copied to clipboard." });
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Compass className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Nomad · Outreach Agent</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            Win clients on LinkedIn — a full week of posts and DMs, plus social proof from your wins
          </p>
        </div>
      </div>

      {/* Ideal client profile (Oasis) */}
      <IcpTool
        projectId={projectId}
        targetedName={audience?.name ?? null}
        onTarget={(s) => setAudience({ name: s.name, text: `${s.description} Angle: ${s.angle}` })}
      />

      {/* Goal input */}
      <Card className="p-5">
        <label className="text-sm font-semibold text-foreground">What do you want to achieve this week?</label>
        {audience && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <Target className="h-3 w-3" /> Targeting: {audience.name}
            <button onClick={() => setAudience(null)} className="ml-0.5 text-primary/70 hover:text-primary">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !generating && generate()}
            placeholder="e.g. Land two new web design clients in the restaurant niche"
            className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Nomad is planning...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Plan my week
              </>
            )}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {GOAL_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setGoal(s)}
              className={cn(
                "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors",
                goal === s && "border-primary/50 bg-primary/8 text-primary",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      {plan?.ok && (
        <>
          {/* Drafts saved banner */}
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/8 px-4 py-3">
            <Check className="h-4 w-4 shrink-0 text-success" strokeWidth={2.5} />
            <p className="flex-1 text-sm text-foreground">
              {plan.drafts_saved ?? 0} posts saved as LinkedIn drafts — review, edit and publish them from Social.
            </p>
            <Link
              href={`/${projectId}/social`}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Open Social <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {/* Post series */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" strokeWidth={1.8} />
              <h2 className="text-sm font-semibold text-foreground">Your week of posts</h2>
              <span className="text-xs text-muted-foreground">— one per weekday, drafted and ready</span>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {(plan.posts ?? []).map((p, i) => (
                <Card key={i} className="flex flex-col p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{p.day || `Post ${i + 1}`}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {TYPE_LABEL[p.type] ?? p.type}
                    </span>
                    <button
                      onClick={() => copyText(p.content + (p.hashtags.length ? "\n\n" + p.hashtags.join(" ") : ""))}
                      className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                  </div>
                  <p className="mt-2.5 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{p.content}</p>
                  {p.hashtags.length > 0 && (
                    <p className="mt-2.5 text-xs font-medium text-primary">{p.hashtags.join(" ")}</p>
                  )}
                </Card>
              ))}
            </div>
          </div>

          {/* DM templates */}
          {(plan.messages ?? []).length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" strokeWidth={1.8} />
                <h2 className="text-sm font-semibold text-foreground">DM templates</h2>
                <span className="text-xs text-muted-foreground">— for connections and follow-ups</span>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {plan.messages!.map((m, i) => (
                  <Card key={i} className="flex flex-col p-4">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-xs font-semibold text-muted-foreground">{m.scenario}</p>
                      <button
                        onClick={() => copyText(m.content)}
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <p className="mt-2 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{m.content}</p>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Tips */}
          {(plan.tips ?? []).length > 0 && (
            <Card className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" strokeWidth={1.8} />
                <h2 className="text-sm font-semibold text-foreground">Nomad&apos;s outreach tips</h2>
              </div>
              <ul className="flex flex-col gap-1.5">
                {plan.tips!.map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {!plan && !generating && (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
          <Compass className="h-8 w-8 opacity-40" strokeWidth={1.5} />
          <p className="text-sm">Tell Nomad your goal and he will map out the whole week.</p>
          <p className="text-xs max-w-md">
            Five posts tuned to your niche, three DM templates, and tips — every post lands in your
            Social drafts, ready to publish or schedule.
          </p>
        </div>
      )}

      {/* Testimonial → content (social proof from your wins) */}
      <TestimonialTool projectId={projectId} />
    </div>
  );
}
