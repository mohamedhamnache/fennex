"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Languages, Check, ChevronDown } from "lucide-react";
import { SUPPORTED_LOCALES, Locale, writeLangCookie } from "@/lib/i18n";
import { updateMyLanguage, isAuthenticated } from "@/lib/api";

// Native language names — no flag emoji (flags misrepresent languages and render
// inconsistently across platforms). The two-letter code is shown as a badge.
const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  pt: "Português",
  ar: "العربية",
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
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Language"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Languages className="h-4 w-4 shrink-0" strokeWidth={1.9} />
        {showLabel ? (
          <span className="font-medium" dir={current === "ar" ? "rtl" : "ltr"}>{LOCALE_LABEL[current] ?? LOCALE_LABEL.en}</span>
        ) : (
          <span className="text-xs font-semibold uppercase tracking-wide">{current}</span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="popover animate-scale-in absolute right-0 top-full z-50 mt-2 w-44 origin-top-right p-1"
        >
          {SUPPORTED_LOCALES.map((lang) => {
            const selected = lang === current;
            return (
              <button
                key={lang}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  mutation.mutate(lang);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                  selected ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold uppercase ${
                    selected ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {lang}
                </span>
                <span className="flex-1 truncate" dir={lang === "ar" ? "rtl" : "ltr"}>{LOCALE_LABEL[lang]}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.4} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
