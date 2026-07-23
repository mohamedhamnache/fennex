"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/api";
import { FennecMark } from "@fennex/ui";
import { TrendingUp, PenLine, Send, BarChart2 } from "lucide-react";

const features = [
  { icon: TrendingUp, title: "Keyword research", desc: "Find high-ROI opportunities with AI clustering" },
  { icon: PenLine, title: "AI article generation", desc: "SEO-optimized long-form content in minutes" },
  { icon: Send, title: "Auto-publish", desc: "Push to WordPress, Shopify, Ghost & more" },
  { icon: BarChart2, title: "Rank tracking", desc: "Monitor positions & traffic in real time" },
];

const stats = [
  { value: "1,200+", label: "teams" },
  { value: "750M+", label: "organic views" },
  { value: "7", label: "AI specialists" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated()) router.replace("/");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Left: warm dusk brand panel ── */}
      <div className="auth-panel relative hidden overflow-hidden lg:flex lg:w-[48%] flex-col justify-between p-10 xl:p-14">
        {/* floating warm orbs */}
        <div className="orb-1 pointer-events-none absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full blur-[80px]" />
        <div className="orb-2 pointer-events-none absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full blur-[80px]" />
        <div className="orb-3 pointer-events-none absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[60px]" />
        {/* fine dot texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="gradient-brand glow-primary flex h-10 w-10 items-center justify-center rounded-xl text-white">
            <FennecMark className="h-6 w-6 brightness-0 invert" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-white">Fennex</span>
        </div>

        {/* Hero */}
        <div className="relative space-y-9">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.07] px-3 py-1 text-[11px] font-medium text-white/75 backdrop-blur-sm">
              <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />
              A virtual marketing agency of AI agents
            </span>
            <h1 className="font-display text-[2.75rem] font-semibold leading-[1.08] tracking-tight text-white xl:text-[3.25rem]">
              Grow organic traffic
              <br />
              <span
                style={{
                  background: "linear-gradient(120deg, #e8a06a 0%, #d97848 45%, #e9c37a 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                on autopilot
              </span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-white/55">
              Research keywords, write ranking articles, publish everywhere, and measure what
              works — driven by your own AI models.
            </p>
          </div>

          {/* Feature list */}
          <div className="grid grid-cols-1 gap-2.5">
            {features.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.04] p-3.5 backdrop-blur-sm transition-colors hover:border-white/15 hover:bg-white/[0.06]"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-[#e8a06a]">
                  <f.icon size={15} strokeWidth={1.9} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="mt-0.5 text-xs text-white/45">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Social proof */}
        <div className="relative flex items-center gap-6 rounded-2xl border border-white/[0.07] bg-white/[0.04] px-5 py-4 backdrop-blur-sm">
          {stats.map((s, i) => (
            <div key={s.label} className="flex items-center gap-6">
              {i > 0 && <span className="h-8 w-px bg-white/10" />}
              <div>
                <p className="font-display text-lg font-bold leading-none text-white">{s.value}</p>
                <p className="mt-1 text-[11px] text-white/45">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: form panel ── */}
      <div className="relative flex flex-1 items-center justify-center p-6 lg:p-12">
        {/* warm ambient wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(620px 260px at 70% -10%, hsl(var(--primary) / 0.10), transparent 62%)" }}
        />
        <div className="relative w-full max-w-[400px] animate-slide-up">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="gradient-brand glow-primary flex h-9 w-9 items-center justify-center rounded-xl">
              <FennecMark className="h-5 w-5 brightness-0 invert" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Fennex</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
