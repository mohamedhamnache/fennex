"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/api";
import { FennecMark } from "@fennex/ui";

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
      {/* ── Left: fennec brand panel ── */}
      <div className="relative hidden overflow-hidden bg-[#120b07] lg:flex lg:w-[46%] flex-col justify-between p-12 xl:p-16">
        {/* The fennec, filling the panel */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/fennec-bg.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        {/* warm tint + legibility scrims layered over the image */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(120% 80% at 50% 30%, rgba(217,120,72,0.28), transparent 62%)", mixBlendMode: "overlay" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(18,11,7,0.55) 0%, rgba(18,11,7,0.10) 42%, rgba(18,11,7,0.86) 100%)" }}
        />
        {/* warm rim glow */}
        <div className="orb-1 pointer-events-none absolute -bottom-24 -left-20 h-[360px] w-[360px] rounded-full blur-[90px] opacity-70" />

        {/* Logo */}
        <div className="relative flex items-center gap-2.5">
          <span className="gradient-brand glow-primary flex h-9 w-9 items-center justify-center rounded-xl text-white">
            <FennecMark className="h-5 w-5 brightness-0 invert" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-white">Fennex</span>
        </div>

        {/* Message + stats, anchored to the bottom over the scrim */}
        <div className="relative">
          <h1 className="font-display text-[2.6rem] font-semibold leading-[1.1] tracking-tight text-white">
            Your virtual
            <br />
            <span
              style={{
                background: "linear-gradient(120deg, #f0b478 0%, #e08a52 50%, #eccb84 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              marketing agency
            </span>
          </h1>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/60">
            A pack of AI specialists that grows your organic traffic on autopilot.
          </p>

          <div className="mt-9 flex items-center gap-7">
            {stats.map((s, i) => (
              <div key={s.label} className="flex items-center gap-7">
                {i > 0 && <span className="h-9 w-px bg-white/15" />}
                <div>
                  <p className="font-display text-xl font-bold leading-none text-white">{s.value}</p>
                  <p className="mt-1.5 text-[11px] uppercase tracking-wide text-white/45">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
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
