"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/api";
import { TrendingUp, PenLine, Send, BarChart2 } from "lucide-react";

const features = [
  { icon: TrendingUp, title: "Keyword Research", desc: "Find high-ROI opportunities with AI clustering" },
  { icon: PenLine, title: "AI Article Generation", desc: "SEO-optimized long-form content in minutes" },
  { icon: Send, title: "Auto-Publish", desc: "Push to WordPress, Shopify, Ghost & more" },
  { icon: BarChart2, title: "Rank Tracking", desc: "Monitor positions & traffic in real-time" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated()) router.replace("/");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Left: dark brand panel ── */}
      <div className="auth-panel relative hidden overflow-hidden lg:flex lg:w-[46%] flex-col justify-between p-10 xl:p-14">
        {/* floating orbs */}
        <div className="orb-1 pointer-events-none absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full blur-[80px]" />
        <div className="orb-2 pointer-events-none absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full blur-[80px]" />
        <div className="orb-3 pointer-events-none absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[60px]" />

        {/* Logo */}
        <div className="relative flex items-center gap-2.5">
          <div className="gradient-brand flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-indigo">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">Fennex</span>
        </div>

        {/* Hero */}
        <div className="relative space-y-8">
          <div className="space-y-4">
            <div className="badge bg-white/10 text-white/80 backdrop-blur-sm border border-white/10">
              <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-green-400" />
              AI-Powered SEO Growth Platform
            </div>
            <h1 className="text-4xl font-extrabold leading-tight text-white xl:text-5xl">
              Grow organic traffic<br />
              <span style={{ background: "linear-gradient(135deg, #a5b4fc 0%, #c4b5fd 50%, #f0abfc 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                on auto-pilot
              </span>
            </h1>
            <p className="max-w-sm text-base leading-relaxed text-white/60">
              Research keywords, generate articles, publish content, and track rankings — all driven by your own AI models.
            </p>
          </div>

          {/* Feature list */}
          <div className="grid grid-cols-1 gap-3">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-3 rounded-xl bg-white/5 border border-white/8 p-3.5 backdrop-blur-sm">
                <f.icon size={16} className="mt-0.5 shrink-0 text-white/70" />
                <div>
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="text-xs text-white/50 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Social proof */}
        <div className="relative">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/8 p-4 backdrop-blur-sm">
            <div className="flex -space-x-2">
              {["#6366f1","#8b5cf6","#a855f7","#ec4899"].map((c, i) => (
                <div key={i} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#1a1065] text-xs font-bold text-white" style={{ background: c }}>
                  {["A","B","C","D"][i]}
                </div>
              ))}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Trusted by 1,200+ teams</p>
              <p className="text-xs text-white/50">750M+ organic views generated</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: form panel ── */}
      <div className="flex flex-1 items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[400px] animate-slide-up">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="gradient-brand flex h-7 w-7 items-center justify-center rounded-md">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-white" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="font-bold">Fennex</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
