"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe, ChevronDown } from "lucide-react";
import { SUPPORTED_LOCALES, type Locale, writeLangCookie } from "@/lib/i18n";

// Native language names — no flag emoji (kept text-only per the brand rules).
const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  pt: "Português",
  ar: "العربية",
};

/**
 * Compact language menu for the public marketing header. Works without auth:
 * it writes the explicit-choice cookie and switches i18n on the client. Renders
 * the neutral "EN" style code until mounted so SSR and hydration match.
 */
export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = ((mounted ? i18n.language : "en")?.slice(0, 2) ?? "en") as Locale;

  const pick = (lng: Locale) => {
    writeLangCookie(lng);
    i18n.changeLanguage(lng);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Language"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Globe className="h-4 w-4" />
        <span className="uppercase">{current}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="popover animate-scale-in absolute right-0 top-full z-50 mt-2 w-40 origin-top-right p-1"
        >
          {SUPPORTED_LOCALES.map((lng) => (
            <button
              key={lng}
              type="button"
              role="option"
              aria-selected={current === lng}
              onClick={() => pick(lng)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <span dir={lng === "ar" ? "rtl" : "ltr"}>{LOCALE_LABEL[lng]}</span>
              {current === lng && <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.4} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
