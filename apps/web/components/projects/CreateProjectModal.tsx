"use client";

import { useState } from "react";
import { X, ArrowLeft, ArrowRight, Check, Loader2, PenLine, ShoppingBag, Briefcase, Building2, Sparkles, type LucideIcon } from "lucide-react";
import { createProject, type ProjectPersona } from "@/lib/api";
import { cn } from "@/lib/cn";

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const PERSONA_CARDS: {
  id: ProjectPersona;
  label: string;
  desc: string;
  Icon: LucideIcon;
  gets: string[];
}[] = [
  {
    id: "creator",
    label: "Content creator",
    desc: "Blogger, influencer or publisher growing an audience.",
    Icon: PenLine,
    gets: ["AI articles & blog covers", "Social sets for every platform", "Topic & trend radar"],
  },
  {
    id: "ecommerce",
    label: "Ecommerce seller",
    desc: "Shopify or WooCommerce store selling products.",
    Icon: ShoppingBag,
    gets: ["Product photo studio", "Buyer-intent keyword tracking", "Store publishing & market study"],
  },
  {
    id: "freelancer",
    label: "Freelancer / business",
    desc: "Winning clients and exploring a market.",
    Icon: Briefcase,
    gets: ["Market sizing & niche analysis", "Competitor scans", "Client-ready reports & outreach content"],
  },
  {
    id: "company",
    label: "Company / Brand",
    desc: "Owning your brand's search and social presence.",
    Icon: Building2,
    gets: ["Rank tracking & SEO opportunities", "On-brand articles & campaigns", "Multi-channel publishing"],
  },
];

const CREATOR_PLATFORMS = ["Instagram", "YouTube", "TikTok", "LinkedIn", "Pinterest", "X", "Newsletter"];

const MISSIONS_PREVIEW: Record<ProjectPersona, string[]> = {
  creator: [
    "Connect Google Search Console & sync your real traffic",
    "Generate your first SEO article",
    "Create a multi-platform social set",
    "Discover what your audience searches for",
  ],
  ecommerce: [
    "Connect your store for one-click publishing",
    "Connect Search Console & find buyer-intent queries",
    "Shoot professional product photos with AI",
    "Study your market & competitors",
  ],
  freelancer: [
    "Connect Search Console & size the market",
    "Run a competitor scan on rivals",
    "Set up your brand kit",
    "Create LinkedIn outreach content",
  ],
  company: [
    "Connect Search Console & track your rankings",
    "Publish your first ranking article",
    "Set up your brand kit & voice",
    "Launch a multi-channel campaign",
  ],
};

export function CreateProjectModal({ open, onClose, onCreated }: CreateProjectModalProps) {
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState<ProjectPersona | null>(null);

  // Essentials
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [locale, setLocale] = useState("en");
  const [targetCountry, setTargetCountry] = useState("");

  // Persona-specific
  const [niche, setNiche] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [storePlatform, setStorePlatform] = useState("shopify");
  const [category, setCategory] = useState("");
  const [services, setServices] = useState("");
  const [targetMarket, setTargetMarket] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setStep(0);
    setPersona(null);
    setName("");
    setDomain("");
    setLocale("en");
    setTargetCountry("");
    setNiche("");
    setPlatforms([]);
    setStorePlatform("shopify");
    setCategory("");
    setServices("");
    setTargetMarket("");
    setError(null);
  }

  function pickPersona(p: ProjectPersona) {
    setPersona(p);
    setStep(1);
  }

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  const essentialsOk = name.trim().length > 0 && domain.trim().length > 0;

  async function handleCreate() {
    if (!persona || !essentialsOk || loading) return;
    setLoading(true);
    setError(null);

    const persona_data: Record<string, unknown> =
      persona === "creator"
        ? { niche: niche.trim(), platforms }
        : persona === "ecommerce"
        ? { store_platform: storePlatform, category: category.trim() }
        : { services: services.trim(), target_market: targetMarket.trim() };

    try {
      await createProject({
        name: name.trim(),
        domain: domain.trim(),
        locale,
        ...(targetCountry.trim() ? { target_country: targetCountry.trim() } : {}),
        persona,
        persona_data,
      });
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-0 transition-colors";
  const labelClass = "mb-1.5 block text-xs font-medium text-foreground";

  const personaCard = persona ? PERSONA_CARDS.find((c) => c.id === persona)! : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex w-full max-w-xl flex-col rounded-2xl border border-border bg-card shadow-lg animate-slide-up max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {step === 0 ? "Who is this workspace for?" : step === 1 ? "Set up your project" : "Your workspace plan"}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {step === 0
                  ? "Fennex tailors its tools to how you work"
                  : step === 1
                  ? personaCard?.label
                  : "Here's what we'll set up together"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Step dots */}
            <div className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : "w-1.5 bg-muted")} />
              ))}
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close modal"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* ── Step 0: persona ── */}
          {step === 0 && (
            <div className="grid grid-cols-1 gap-3">
              {PERSONA_CARDS.map(({ id, label, desc, Icon, gets }) => (
                <button
                  key={id}
                  onClick={() => pickPersona(id)}
                  className="group flex items-start gap-4 rounded-xl border border-border p-4 text-left transition-all hover:border-primary/50 hover:shadow-md"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {gets.map((g) => (
                        <span key={g} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              ))}
            </div>
          )}

          {/* ── Step 1: essentials + persona setup ── */}
          {step === 1 && persona && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Project name <span className="text-destructive">*</span></label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Website" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>
                    {persona === "ecommerce" ? "Store URL" : "Website"} <span className="text-destructive">*</span>
                  </label>
                  <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="https://example.com" className={inputClass} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Locale</label>
                  <select value={locale} onChange={(e) => setLocale(e.target.value)} className={inputClass}>
                    <option value="en">English (en)</option>
                    <option value="fr">French (fr)</option>
                    <option value="de">German (de)</option>
                    <option value="es">Spanish (es)</option>
                    <option value="ar">Arabic (ar)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Target country</label>
                  <input value={targetCountry} onChange={(e) => setTargetCountry(e.target.value)} placeholder="US" className={inputClass} />
                </div>
              </div>

              <div className="h-px bg-border" />

              {persona === "creator" && (
                <>
                  <div>
                    <label className={labelClass}>Your niche / topics</label>
                    <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. home cooking, personal finance, fitness…" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Where do you publish?</label>
                    <div className="flex flex-wrap gap-1.5">
                      {CREATOR_PLATFORMS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => togglePlatform(p)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                            platforms.includes(p)
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {persona === "ecommerce" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Store platform</label>
                    <select value={storePlatform} onChange={(e) => setStorePlatform(e.target.value)} className={inputClass}>
                      <option value="shopify">Shopify</option>
                      <option value="woocommerce">WooCommerce (WordPress)</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>What do you sell?</label>
                    <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. skincare, home decor…" className={inputClass} />
                  </div>
                </div>
              )}

              {persona === "freelancer" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Services you offer</label>
                    <input value={services} onChange={(e) => setServices(e.target.value)} placeholder="e.g. web design, SEO consulting…" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Target clients / market</label>
                    <input value={targetMarket} onChange={(e) => setTargetMarket(e.target.value)} placeholder="e.g. local restaurants, SaaS startups…" className={inputClass} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: workspace plan ── */}
          {step === 2 && persona && personaCard && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl bg-gradient-to-br from-primary/10 to-transparent p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <personaCard.Icon className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{name || "Your project"} · {personaCard.label}</p>
                  <p className="text-xs text-muted-foreground">Your Overview page will guide you through these missions:</p>
                </div>
              </div>
              <div className="space-y-2">
                {MISSIONS_PREVIEW[persona].map((m, i) => (
                  <div key={m} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {i + 1}
                    </span>
                    <span className="text-xs text-foreground">{m}</span>
                  </div>
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                The AI Copilot, Market studio and image tools will all speak your language: {personaCard.label.toLowerCase()}.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}
        </div>

        {/* Footer */}
        {step > 0 && (
          <div className="flex gap-2 border-t border-border p-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <div className="flex-1" />
            {step === 1 && (
              <button
                type="button"
                disabled={!essentialsOk}
                onClick={() => setStep(2)}
                className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
              >
                Continue <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                disabled={loading}
                onClick={handleCreate}
                className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
              >
                {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</> : <><Check className="h-3.5 w-3.5" /> Create workspace</>}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
