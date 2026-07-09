"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SUPPORTED_LOCALES, Locale, writeLangCookie } from "@/lib/i18n";
import { updateMyLanguage, isAuthenticated } from "@/lib/api";

const LOCALE_META: Record<Locale, { label: string; flag: string }> = {
  en: { label: "English",   flag: "🇬🇧" },
  fr: { label: "Français",  flag: "🇫🇷" },
  es: { label: "Español",   flag: "🇪🇸" },
  de: { label: "Deutsch",   flag: "🇩🇪" },
  pt: { label: "Português", flag: "🇵🇹" },
  ar: { label: "العربية",   flag: "🇸🇦" },
};

interface LanguagePickerProps {
  showLabel?: boolean;
}

export function LanguagePicker({ showLabel = false }: LanguagePickerProps) {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
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

  // Use "en" until after hydration to prevent SSR/client mismatch.
  const current = ((mounted ? i18n.language : "en")?.slice(0, 2) ?? "en") as Locale;
  const meta = LOCALE_META[current] ?? LOCALE_META.en;

  const mutation = useMutation({
    mutationFn: (lang: Locale) => {
      writeLangCookie(lang); // explicit pick — top priority on next load
      i18n.changeLanguage(lang);
      if (isAuthenticated()) return updateMyLanguage(lang);
      return Promise.resolve({ language: lang });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Language"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="text-base leading-none">{meta.flag}</span>
        {showLabel && <span className="font-medium">{meta.label}</span>}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 z-50 w-40 rounded-xl border border-border bg-popover shadow-lg py-1 animate-scale-in"
        >
          {SUPPORTED_LOCALES.map((lang) => {
            const m = LOCALE_META[lang];
            return (
              <button
                key={lang}
                role="option"
                aria-selected={lang === current}
                onClick={() => {
                  mutation.mutate(lang);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors ${
                  lang === current ? "text-foreground font-medium" : "text-muted-foreground"
                }`}
              >
                <span className="text-base">{m.flag}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
