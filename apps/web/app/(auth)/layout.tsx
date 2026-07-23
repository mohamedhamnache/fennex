"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/api";
import { FennecMark } from "@fennex/ui";
import { Sparkles, ScrollText, BarChart2 } from "lucide-react";

const highlights = [
  { icon: Sparkles, text: "Seven named AI agents that research, write and publish" },
  { icon: ScrollText, text: "SEO-optimized long-form content in minutes" },
  { icon: BarChart2, text: "Track rankings and traffic in real time" },
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
      {/* ── Left: warm brand panel ── */}
      <div className="auth-panel relative hidden overflow-hidden lg:flex lg:w-[44%] flex-col justify-between p-12 xl:p-16">
        {/* warm orbs */}
        <div className="orb-1 pointer-events-none absolute -top-24 -left-24 h-[380px] w-[380px] rounded-full blur-[80px]" />
        <div className="orb-2 pointer-events-none absolute -bottom-16 right-0 h-[320px] w-[320px] rounded-full blur-[80px]" />

        {/* Logo */}
        <div className="relative flex items-center gap-2.5">
          <span className="gradient-brand glow-primary flex h-9 w-9 items-center justify-center rounded-xl text-white">
            <FennecMark className="h-5 w-5 brightness-0 invert" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-white">Fennex</span>
        </div>

        {/* Message */}
        <div className="relative">
          <h1 className="font-display text-[2.6rem] font-semibold leading-[1.1] tracking-tight text-white">
            Your virtual
            <br />
            <span
              style={{
                background: "linear-gradient(120deg, #e8a06a 0%, #d97848 50%, #e9c37a 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              marketing agency
            </span>
          </h1>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/55">
            A pack of AI specialists that grows your organic traffic on autopilot.
          </p>

          <ul className="mt-9 space-y-3.5">
            {highlights.map((h) => (
              <li key={h.text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-[#e8a06a]">
                  <h.icon size={13} strokeWidth={2} />
                </span>
                <span className="text-sm leading-relaxed text-white/70">{h.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Stats */}
        <div className="relative flex items-center gap-7">
          {stats.map((s, i) => (
            <div key={s.label} className="flex items-center gap-7">
              {i > 0 && <span className="h-9 w-px bg-white/10" />}
              <div>
                <p className="font-display text-xl font-bold leading-none text-white">{s.value}</p>
                <p className="mt-1.5 text-[11px] uppercase tracking-wide text-white/40">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: form panel ── */}
      <div className="relative flex flex-1 items-center justify-center p-6 lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(560px 240px at 75% -10%, hsl(var(--primary) / 0.08), transparent 62%)" }}
        />
        <div className="relative w-full max-w-[380px] animate-slide-up">
          {/* Mobile logo */}
          <div className="mb-9 flex items-center gap-2.5 lg:hidden">
            <span className="gradient-brand glow-primary flex h-9 w-9 items-center justify-center rounded-xl">
              <FennecMark className="h-5 w-5 brightness-0 invert" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">Fennex</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
