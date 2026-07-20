"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { success: showSuccess, error: showError } = useToast();
  const gTitle = t("nomadPage.toast.genFail", { defaultValue: "Couldn't generate" });
  const gRetry = t("nomadPage.toast.retry", { defaultValue: "Please try again." });
  const gServer = t("nomadPage.toast.server", { defaultValue: "Could not reach the server." });
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
      else showError(gTitle, { message: res.error ? t(`nomadPage.errors.${res.error}`, { defaultValue: TESTIMONIAL_ERRORS[res.error] ?? gRetry }) : gRetry });
    } catch {
      showError(gTitle, { message: gServer });
    } finally {
      setBusy(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    showSuccess(t("nomadPage.toast.copied", { defaultValue: "Copied" }), { message: t("nomadPage.toast.copiedMsg", { defaultValue: "Text copied to clipboard." }) });
  }

  async function saveLinkedIn(content: string) {
    try {
      await createSocialPost({ project_id: projectId, platform: "linkedin", post_type: "tip", content });
      setSavedLinkedIn(true);
      showSuccess(t("nomadPage.toast.saved", { defaultValue: "Saved" }), { message: t("nomadPage.toast.savedMsg", { defaultValue: "Saved as a LinkedIn draft in Social." }) });
    } catch {
      showError(t("nomadPage.toast.saveFail", { defaultValue: "Couldn't save" }), { message: gRetry });
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Quote className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <h2 className="text-sm font-semibold text-foreground">{t("nomadPage.testimonial.title", { defaultValue: "Testimonial to content" })}</h2>
        <span className="text-xs text-muted-foreground">{t("nomadPage.testimonial.subtitle", { defaultValue: "— turn a client win into social proof" })}</span>
      </div>
      <textarea
        value={testimonial}
        onChange={(e) => setTestimonial(e.target.value)}
        rows={3}
        placeholder={t("nomadPage.testimonial.placeholder", { defaultValue: "Paste a client testimonial… e.g. “Working with Sam doubled our booking rate in 6 weeks — clear communication and real results.”" })}
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={client}
          onChange={(e) => setClient(e.target.value)}
          placeholder={t("nomadPage.testimonial.clientPlaceholder", { defaultValue: "Client / company (optional)" })}
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          style={{ minWidth: 160 }}
        />
        <input
          value={service}
          onChange={(e) => setService(e.target.value)}
          placeholder={t("nomadPage.testimonial.servicePlaceholder", { defaultValue: "Service you provided (optional)" })}
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          style={{ minWidth: 160 }}
        />
        <button
          onClick={generate}
          disabled={busy || !testimonial.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? t("nomadPage.testimonial.writing", { defaultValue: "Writing…" }) : t("nomadPage.testimonial.generate", { defaultValue: "Generate" })}
        </button>
      </div>

      {pieces && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pieces.map((p, i) => (
            <div key={i} className="flex flex-col rounded-xl border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {t(`nomadPage.pieces.${p.format}`, { defaultValue: PIECE_LABEL[p.format] ?? p.format })}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {p.format === "linkedin_post" && (
                    <button
                      onClick={() => saveLinkedIn(p.content)}
                      disabled={savedLinkedIn}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-60"
                    >
                      {savedLinkedIn ? <Check className="h-3 w-3 text-success" /> : <Linkedin className="h-3 w-3" />}
                      {savedLinkedIn ? t("nomadPage.saved", { defaultValue: "Saved" }) : t("nomadPage.saveDraft", { defaultValue: "Save draft" })}
                    </button>
                  )}
                  <button
                    onClick={() => copyText(p.content)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" /> {t("nomadPage.copy", { defaultValue: "Copy" })}
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
  const { t } = useTranslation();
  const { error: showError } = useToast();
  const [segments, setSegments] = useState<IcpSegment[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await generateIcp(projectId);
      if (res.ok && res.segments) setSegments(res.segments);
      else showError(t("nomadPage.toast.genFail", { defaultValue: "Couldn't generate" }), { message: res.error ? t(`nomadPage.errors.${res.error}`, { defaultValue: ICP_ERRORS[res.error] ?? t("nomadPage.toast.retry", { defaultValue: "Please try again." }) }) : t("nomadPage.toast.retry", { defaultValue: "Please try again." }) });
    } catch {
      showError(t("nomadPage.toast.genFail", { defaultValue: "Couldn't generate" }), { message: t("nomadPage.toast.server", { defaultValue: "Could not reach the server." }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <h2 className="text-sm font-semibold text-foreground">{t("nomadPage.icp.title", { defaultValue: "Ideal client profile" })}</h2>
        <span className="text-xs text-muted-foreground">{t("nomadPage.icp.subtitle", { defaultValue: "— who to target (Oasis)" })}</span>
        <button
          onClick={generate}
          disabled={busy}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? t("nomadPage.icp.researching", { defaultValue: "Researching…" }) : segments ? t("nomadPage.icp.regenerate", { defaultValue: "Regenerate" }) : t("nomadPage.icp.define", { defaultValue: "Define my ICP" })}
        </button>
      </div>

      {!segments ? (
        <p className="text-xs text-muted-foreground">
          {t("nomadPage.icp.intro", { defaultValue: "Oasis maps 2-4 ideal client segments from your niche — their pains, where to find them, and the angle that lands. Target one to sharpen your outreach plan." })}
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
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{t("nomadPage.icp.pains", { defaultValue: "Pains" })}</p>
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
                  <p className="mt-2 text-[11px] text-muted-foreground"><span className="font-semibold">{t("nomadPage.icp.findThem", { defaultValue: "Find them:" })}</span> {s.channels.join(", ")}</p>
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
                  {on ? <><Check className="h-3.5 w-3.5" /> {t("nomadPage.icp.targeting", { defaultValue: "Targeting" })}</> : <><Target className="h-3.5 w-3.5 text-primary" /> {t("nomadPage.icp.targetThis", { defaultValue: "Target this" })}</>}
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
  const { t } = useTranslation();
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<OutreachPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [audience, setAudience] = useState<{ name: string; text: string } | null>(null);
  const { success: showSuccess, error: showError } = useToast();
  const queryClient = useQueryClient();

  const goalSuggestions = t("nomadPage.goalSuggestions", { returnObjects: true, defaultValue: GOAL_SUGGESTIONS }) as string[];

  async function generate() {
    setGenerating(true);
    try {
      const res = await planOutreach(projectId, goal, audience?.text);
      if (res.ok) {
        setPlan(res);
        queryClient.invalidateQueries({ queryKey: ["social"] });
        showSuccess(t("nomadPage.toast.planReady", { defaultValue: "Plan ready" }), {
          message: t("nomadPage.toast.planReadyMsg", { count: res.drafts_saved ?? 0, defaultValue: `${res.drafts_saved ?? 0} posts saved as LinkedIn drafts in Social.` }),
        });
      } else {
        showError(t("nomadPage.toast.planFail", { defaultValue: "Plan failed" }), { message: res.error ?? t("nomadPage.toast.retry", { defaultValue: "Please try again." }) });
      }
    } catch {
      showError(t("nomadPage.toast.planFail", { defaultValue: "Plan failed" }), { message: t("nomadPage.toast.server", { defaultValue: "Could not reach the server." }) });
    } finally {
      setGenerating(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    showSuccess(t("nomadPage.toast.copied", { defaultValue: "Copied" }), { message: t("nomadPage.toast.copiedMsg", { defaultValue: "Text copied to clipboard." }) });
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Compass className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">{t("nomadPage.title", { defaultValue: "Nomad · Outreach Agent" })}</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            {t("nomadPage.subtitle", { defaultValue: "Win clients on LinkedIn — a full week of posts and DMs, plus social proof from your wins" })}
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
        <label className="text-sm font-semibold text-foreground">{t("nomadPage.goalLabel", { defaultValue: "What do you want to achieve this week?" })}</label>
        {audience && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            <Target className="h-3 w-3" /> {t("nomadPage.targetingChip", { defaultValue: "Targeting:" })} {audience.name}
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
            placeholder={t("nomadPage.goalPlaceholder", { defaultValue: "e.g. Land two new web design clients in the restaurant niche" })}
            className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("nomadPage.planning", { defaultValue: "Nomad is planning..." })}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> {t("nomadPage.planWeek", { defaultValue: "Plan my week" })}
              </>
            )}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {goalSuggestions.map((s) => (
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
              {t("nomadPage.draftsBanner", { count: plan.drafts_saved ?? 0, defaultValue: `${plan.drafts_saved ?? 0} posts saved as LinkedIn drafts — review, edit and publish them from Social.` })}
            </p>
            <Link
              href={`/${projectId}/social`}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("nomadPage.openSocial", { defaultValue: "Open Social" })} <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {/* Post series */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" strokeWidth={1.8} />
              <h2 className="text-sm font-semibold text-foreground">{t("nomadPage.weekOfPosts", { defaultValue: "Your week of posts" })}</h2>
              <span className="text-xs text-muted-foreground">{t("nomadPage.weekOfPostsSub", { defaultValue: "— one per weekday, drafted and ready" })}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {(plan.posts ?? []).map((p, i) => (
                <Card key={i} className="flex flex-col p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{p.day || t("nomadPage.postN", { n: i + 1, defaultValue: `Post ${i + 1}` })}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {t(`nomadPage.postTypes.${p.type}`, { defaultValue: TYPE_LABEL[p.type] ?? p.type })}
                    </span>
                    <button
                      onClick={() => copyText(p.content + (p.hashtags.length ? "\n\n" + p.hashtags.join(" ") : ""))}
                      className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <Copy className="h-3 w-3" /> {t("nomadPage.copy", { defaultValue: "Copy" })}
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
                <h2 className="text-sm font-semibold text-foreground">{t("nomadPage.dmTemplates", { defaultValue: "DM templates" })}</h2>
                <span className="text-xs text-muted-foreground">{t("nomadPage.dmTemplatesSub", { defaultValue: "— for connections and follow-ups" })}</span>
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
                        <Copy className="h-3 w-3" /> {t("nomadPage.copy", { defaultValue: "Copy" })}
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
                <h2 className="text-sm font-semibold text-foreground">{t("nomadPage.tipsTitle", { defaultValue: "Nomad's outreach tips" })}</h2>
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
          <p className="text-sm">{t("nomadPage.emptyTitle", { defaultValue: "Tell Nomad your goal and he will map out the whole week." })}</p>
          <p className="text-xs max-w-md">
            {t("nomadPage.emptyDesc", { defaultValue: "Five posts tuned to your niche, three DM templates, and tips — every post lands in your Social drafts, ready to publish or schedule." })}
          </p>
        </div>
      )}

      {/* Testimonial → content (social proof from your wins) */}
      <TestimonialTool projectId={projectId} />
    </div>
  );
}
