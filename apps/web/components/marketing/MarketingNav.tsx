"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FennecMark } from "@fennex/ui";
import { Menu, X, ArrowRight } from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";

const LINKS = [
  { key: "pack", href: "#pack" },
  { key: "how", href: "#loop" },
  { key: "features", href: "#features" },
  { key: "results", href: "#results" },
];

/**
 * Public marketing header. Transparent over the hero, then gains a frosted
 * background + border once the page scrolls. Collapses to a sheet on mobile.
 */
export function MarketingNav() {
  const { t } = useTranslation();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-border/70 bg-background/80 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/landing" className="flex items-center gap-2.5">
          <span className="gradient-brand flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm">
            <FennecMark className="h-5 w-5 brightness-0 invert" />
          </span>
          <span className="text-lg font-bold tracking-tight">Fennex</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(`landing.nav.${l.key}`)}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-1.5 md:flex">
          <LanguageSwitcher />
          <Link
            href="/login"
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("landing.nav.signIn")}
          </Link>
          <Link
            href="/register"
            className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm"
          >
            {t("landing.nav.start")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-foreground"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="animate-scale-in border-t border-border bg-background/95 px-5 pb-6 pt-2 backdrop-blur-xl md:hidden">
          <div className="flex flex-col">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {t(`landing.nav.${l.key}`)}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2">
              <Link
                href="/login"
                className="rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium"
              >
                {t("landing.nav.signIn")}
              </Link>
              <Link
                href="/register"
                className="btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm"
              >
                {t("landing.nav.start")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
