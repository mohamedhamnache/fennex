"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { FennecMark } from "@fennex/ui";
import {
  ArrowRight, Search, ScrollText, Wand2, Send, BarChart3, Compass,
  Sparkles, Check, Star, TrendingUp, Zap, ShieldCheck, Globe, Clock,
  type LucideIcon,
} from "lucide-react";
import { FENNEX_AGENTS, type AgentId } from "@/lib/agents";
import { Reveal } from "@/components/marketing/Reveal";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { BRAND_LOGOS, BrandGlyph } from "@/components/marketing/BrandLogos";

// Each agent's signature gradient (mirrors the dashboard Pack strip).
const PACK_GRADIENT: Record<AgentId, string> = {
  zerda: "from-orange-500 to-amber-600",
  sirocco: "from-rose-500 to-orange-500",
  dune: "from-amber-500 to-yellow-600",
  mirage: "from-rose-500 to-pink-600",
  sable: "from-stone-500 to-stone-700",
  oasis: "from-emerald-600 to-teal-600",
  nomad: "from-amber-600 to-red-500",
};

const PACK_ORDER: AgentId[] = ["zerda", "dune", "mirage", "sirocco", "sable", "oasis", "nomad"];

const LOOP: { n: string; icon: LucideIcon; key: string }[] = [
  { n: "01", icon: Search, key: "research" },
  { n: "02", icon: ScrollText, key: "create" },
  { n: "03", icon: Send, key: "publish" },
  { n: "04", icon: TrendingUp, key: "learn" },
];

const FEATURES: { icon: LucideIcon; key: string; tone: string }[] = [
  { icon: Search, key: "keyword", tone: "text-amber-500 bg-amber-500/12" },
  { icon: ScrollText, key: "articles", tone: "text-primary bg-primary/12" },
  { icon: Wand2, key: "images", tone: "text-rose-500 bg-rose-500/12" },
  { icon: Send, key: "publishing", tone: "text-emerald-500 bg-emerald-500/12" },
  { icon: BarChart3, key: "tracking", tone: "text-sky-500 bg-sky-500/12" },
  { icon: Compass, key: "backlinks", tone: "text-orange-500 bg-orange-500/12" },
];

const STATS: { value: string; key: string }[] = [
  { value: "1,200+", key: "teams" },
  { value: "750M+", key: "views" },
  { value: "7", key: "agents" },
  { value: "< 4 min", key: "draft" },
];

export function LandingContent() {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      <MarketingNav />

      {/* ─────────────────────────────  HERO  ───────────────────────────── */}
      <section className="relative isolate overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
        <div className="mesh-warm pointer-events-none absolute inset-0 -z-10" />
        <div className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-[0.35] [mask-image:radial-gradient(70%_60%_at_50%_0%,#000,transparent)]" />
        <div className="orb-1 pointer-events-none absolute -top-24 -left-24 -z-10 h-[420px] w-[420px] rounded-full blur-[90px]" />
        <div className="orb-2 pointer-events-none absolute -top-10 right-0 -z-10 h-[360px] w-[360px] rounded-full blur-[90px]" />

        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <span className="badge border border-border bg-card/60 text-muted-foreground backdrop-blur-sm">
                <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-success" />
                {t("landing.hero.badge")}
              </span>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="mt-6 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                {t("landing.hero.titleA")}{" "}
                <span className="gradient-text">{t("landing.hero.titleHi")}</span>
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
                {t("landing.hero.subtitle")}
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="btn-primary inline-flex w-full items-center justify-center gap-2 px-6 py-3 text-sm sm:w-auto"
                >
                  {t("landing.hero.ctaPrimary")} <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="#pack"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card/50 px-6 py-3 text-sm font-medium backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-primary sm:w-auto"
                >
                  {t("landing.hero.ctaSecondary")}
                </a>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> {t("landing.hero.trial")}</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> {t("landing.hero.keys")}</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-success" /> {t("landing.hero.cancel")}</span>
              </div>
            </Reveal>
          </div>

          {/* Hero product panel */}
          <Reveal delay={200} className="mt-16">
            <div className="relative mx-auto max-w-4xl">
              <div className="spin-slow pointer-events-none absolute -inset-x-20 -top-24 -z-10 mx-auto h-[420px] w-[420px] rounded-full bg-[conic-gradient(from_0deg,transparent,hsl(var(--primary)/0.18),transparent_60%)] blur-2xl" />
              <div className="glass overflow-hidden rounded-2xl p-2 shadow-2xl">
                <div className="rounded-xl border border-border/60 bg-card/70">
                  <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
                    <span className="ml-3 inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                      <Globe className="h-3 w-3" /> app.fennex.ai
                    </span>
                  </div>
                  <div className="grid gap-4 p-5 sm:grid-cols-3">
                    <div className="glass flex flex-col justify-between p-4 sm:col-span-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("landing.results.views")}</p>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                          <TrendingUp className="h-3.5 w-3.5" /> 38.2%
                        </span>
                      </div>
                      <p className="mt-1 font-display text-3xl font-semibold tabular-nums">128.4K</p>
                      <svg viewBox="0 0 320 72" className="mt-3 h-16 w-full" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="lp-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d="M0 60 L40 54 L80 58 L120 40 L160 44 L200 28 L240 30 L280 16 L320 8"
                          fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M0 60 L40 54 L80 58 L120 40 L160 44 L200 28 L240 30 L280 16 L320 8 L320 72 L0 72 Z"
                          fill="url(#lp-fill)" />
                      </svg>
                    </div>
                    <div className="flex flex-col gap-4">
                      <div className="glass p-4">
                        <p className="text-xs text-muted-foreground">{t("landing.loop.learn.title")}</p>
                        <p className="mt-1 font-display text-2xl font-semibold tabular-nums">4.1</p>
                      </div>
                      <div className="glass p-4">
                        <p className="text-xs text-muted-foreground">{t("landing.loop.publish.title")}</p>
                        <p className="mt-1 font-display text-2xl font-semibold tabular-nums">36</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ────────────────────────  INTEGRATIONS MARQUEE  ──────────────────── */}
      <section className="border-y border-border/60 bg-card/30 py-11">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {t("landing.integrations.title")}
          </p>
          <div className="marquee-mask mt-8 overflow-hidden">
            <div className="marquee-track items-center gap-16 pr-16">
              {[...BRAND_LOGOS, ...BRAND_LOGOS].map((logo, i) => (
                <BrandGlyph
                  key={i}
                  logo={logo}
                  className="h-10 w-10 shrink-0 text-muted-foreground/60 transition-colors duration-300 hover:text-foreground"
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ──────────────────────────────  THE PACK  ────────────────────────── */}
      <section id="pack" className="relative py-24 sm:py-32">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="badge border border-border bg-card/60 text-primary">
              <Sparkles className="h-3.5 w-3.5" /> {t("landing.pack.badge")}
            </span>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("landing.pack.title")}
            </h2>
            <p className="mt-4 text-balance text-muted-foreground">
              {t("landing.pack.subtitle")}
            </p>
          </Reveal>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PACK_ORDER.map((id, i) => {
              const a = FENNEX_AGENTS[id];
              return (
                <Reveal key={id} delay={(i % 3) * 90} as="article" className="h-full">
                  <div className="tilt-card group flex h-full flex-col rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-sm">
                    <div className="flex items-center gap-3.5">
                      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm transition-transform group-hover:scale-105 ${PACK_GRADIENT[id]}`}>
                        <a.Icon className="h-6 w-6" strokeWidth={1.9} />
                      </span>
                      <div>
                        <h3 className="font-display text-lg font-semibold leading-none">{a.name}</h3>
                        <p className="mt-1 text-xs font-medium text-primary">{a.role}</p>
                      </div>
                    </div>
                    <p className="mt-4 text-sm italic text-muted-foreground">&ldquo;{a.tagline}&rdquo;</p>
                    <ul className="mt-4 space-y-2 border-t border-border/60 pt-4">
                      {a.capabilities.slice(0, 3).map((cap) => (
                        <li key={cap} className="flex items-start gap-2 text-sm text-foreground/80">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2.4} />
                          <span>{cap}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              );
            })}
            <Reveal delay={90} className="h-full">
              <Link
                href="/register"
                className="group flex h-full flex-col items-start justify-between gap-6 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary-accent/10 p-6 transition-colors hover:border-primary/60"
              >
                <span className="gradient-brand flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-sm">
                  <FennecMark className="h-6 w-6 brightness-0 invert" />
                </span>
                <div>
                  <h3 className="font-display text-lg font-semibold">{t("landing.pack.ctaTitle")}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {t("landing.pack.ctaBody")}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                    {t("landing.pack.ctaLink")} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────  THE LOOP  ─────────────────────────── */}
      <section id="loop" className="relative border-y border-border/60 bg-card/30 py-24 sm:py-32">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="badge border border-border bg-background/60 text-primary">
              <Zap className="h-3.5 w-3.5" /> {t("landing.loop.badge")}
            </span>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("landing.loop.title")}
            </h2>
            <p className="mt-4 text-balance text-muted-foreground">
              {t("landing.loop.subtitle")}
            </p>
          </Reveal>

          <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {LOOP.map((step, i) => (
              <Reveal key={step.n} delay={i * 90} as="div" className="h-full">
                <div className="relative flex h-full flex-col rounded-2xl border border-border bg-background/60 p-6">
                  <span className="font-display text-sm font-bold text-primary/50">{step.n}</span>
                  <span className="mt-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <step.icon className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold">{t(`landing.loop.${step.key}.title`)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`landing.loop.${step.key}.body`)}</p>
                  {i < LOOP.length - 1 && (
                    <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-border lg:block rtl:rotate-180" />
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────  FEATURES  ─────────────────────────── */}
      <section id="features" className="py-24 sm:py-32">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="badge border border-border bg-card/60 text-primary">
              <ShieldCheck className="h-3.5 w-3.5" /> {t("landing.features.badge")}
            </span>
            <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("landing.features.title")}
            </h2>
            <p className="mt-4 text-balance text-muted-foreground">
              {t("landing.features.subtitle")}
            </p>
          </Reveal>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.key} delay={(i % 3) * 90} as="article" className="h-full">
                <div className="tilt-card flex h-full flex-col rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-sm">
                  <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${f.tone}`}>
                    <f.icon className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold">{t(`landing.features.${f.key}.title`)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`landing.features.${f.key}.body`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ──────────────────────────────  RESULTS  ─────────────────────────── */}
      <section id="results" className="relative overflow-hidden border-y border-border/60 py-24 sm:py-28">
        <div className="mesh-warm pointer-events-none absolute inset-0 -z-10 opacity-70" />
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((s, i) => (
              <Reveal key={s.key} delay={i * 80} className="h-full">
                <div className="glass flex h-full flex-col items-center justify-center rounded-2xl px-4 py-8 text-center">
                  <p className="gradient-text font-display text-4xl font-semibold tracking-tight sm:text-5xl">{s.value}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{t(`landing.results.${s.key}`)}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120} className="mx-auto mt-14 max-w-3xl">
            <figure className="glass rounded-2xl p-8 text-center sm:p-10">
              <div className="flex items-center justify-center gap-1 text-warning">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <blockquote className="mt-5 text-balance font-display text-xl font-medium leading-relaxed sm:text-2xl">
                &ldquo;{t("landing.results.quote")}&rdquo;
              </blockquote>
              <figcaption className="mt-6 flex items-center justify-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full gradient-brand text-sm font-bold text-white">
                  ML
                </span>
                <div className="text-start">
                  <p className="text-sm font-semibold">{t("landing.results.author")}</p>
                  <p className="text-xs text-muted-foreground">{t("landing.results.role")}</p>
                </div>
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* ────────────────────────────  FINAL CTA  ─────────────────────────── */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-border bg-card/60 px-6 py-16 text-center backdrop-blur-sm sm:px-12">
              <div className="mesh-warm pointer-events-none absolute inset-0 -z-10" />
              <div className="orb-1 pointer-events-none absolute -bottom-24 -left-16 h-[300px] w-[300px] rounded-full blur-[90px]" />
              <span className="gradient-brand mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg glow-primary">
                <FennecMark className="h-8 w-8 brightness-0 invert" />
              </span>
              <h2 className="mx-auto mt-6 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-5xl">
                {t("landing.cta.title")}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-balance text-muted-foreground">
                {t("landing.cta.body")}
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="btn-primary inline-flex w-full items-center justify-center gap-2 px-7 py-3.5 text-sm sm:w-auto"
                >
                  {t("landing.cta.primary")} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background/50 px-7 py-3.5 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary sm:w-auto"
                >
                  {t("landing.cta.signIn")}
                </Link>
              </div>
              <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> {t("landing.cta.setup")}
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ──────────────────────────────  FOOTER  ──────────────────────────── */}
      <footer className="border-t border-border/60 bg-card/30">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <div className="flex flex-col justify-between gap-10 md:flex-row">
            <div className="max-w-xs">
              <div className="flex items-center gap-2.5">
                <span className="gradient-brand flex h-8 w-8 items-center justify-center rounded-lg text-white">
                  <FennecMark className="h-5 w-5 brightness-0 invert" />
                </span>
                <span className="text-lg font-bold tracking-tight">Fennex</span>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                {t("landing.footer.tagline")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
              <FooterCol title={t("landing.footer.product")} links={[
                { label: t("landing.nav.pack"), href: "#pack" },
                { label: t("landing.nav.how"), href: "#loop" },
                { label: t("landing.nav.features"), href: "#features" },
                { label: t("landing.nav.results"), href: "#results" },
              ]} />
              <FooterCol title={t("landing.footer.company")} links={[
                { label: t("landing.footer.about"), href: "#" },
                { label: t("landing.footer.blog"), href: "#" },
                { label: t("landing.footer.careers"), href: "#" },
                { label: t("landing.footer.contact"), href: "#" },
              ]} />
              <FooterCol title={t("landing.footer.getStarted")} links={[
                { label: t("landing.footer.signIn"), href: "/login" },
                { label: t("landing.footer.createAccount"), href: "/register" },
              ]} />
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row">
            <p>© {new Date().getFullYear()} Fennex. {t("landing.footer.rights")}</p>
            <div className="flex items-center gap-5">
              <a href="#" className="transition-colors hover:text-foreground">{t("landing.footer.privacy")}</a>
              <a href="#" className="transition-colors hover:text-foreground">{t("landing.footer.terms")}</a>
              <a href="#" className="transition-colors hover:text-foreground">{t("landing.footer.status")}</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-foreground/70">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
