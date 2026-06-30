"use client";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SUPPORTED_LOCALES, Locale } from "@/lib/i18n";
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
  const current = (i18n.language?.slice(0, 2) ?? "en") as Locale;
  const meta = LOCALE_META[current] ?? LOCALE_META.en;

  const mutation = useMutation({
    mutationFn: (lang: Locale) => {
      i18n.changeLanguage(lang);
      if (isAuthenticated()) return updateMyLanguage(lang);
      return Promise.resolve({ language: lang });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Language"
      >
        <span className="text-base leading-none">{meta.flag}</span>
        {showLabel && <span className="font-medium">{meta.label}</span>}
      </button>
      <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block w-40 rounded-xl border border-border bg-popover shadow-lg py-1">
        {SUPPORTED_LOCALES.map((lang) => {
          const m = LOCALE_META[lang];
          return (
            <button
              key={lang}
              onClick={() => mutation.mutate(lang)}
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
    </div>
  );
}
