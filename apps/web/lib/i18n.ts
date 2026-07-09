import i18n from "i18next";
import { initReactI18next } from "react-i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const enCommon = require("../public/locales/en/common.json");

export const SUPPORTED_LOCALES = ["en", "fr", "es", "de", "pt", "ar"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

if (!i18n.isInitialized) {
  const chain = i18n.use(initReactI18next);

  if (typeof window !== "undefined") {
    // Browser-only plugin — safe to omit during SSR. The HTTP backend lazily
    // loads non-English locale bundles. Language DETECTION is intentionally not
    // a plugin here: it runs post-mount in I18nProvider so it can never change
    // the language during the initial (SSR-matching) client render.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Backend = require("i18next-http-backend").default;
    chain.use(Backend);
  }

  chain.init({
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LOCALES,
    ns: ["common"],
    defaultNS: "common",
    // Always seed English so SSR and initial client render produce identical text,
    // preventing React hydration mismatches on translation keys.
    resources: { en: { common: enCommon } },
    // Allow the HTTP backend to load non-English locales even though English is
    // bundled statically in resources above.
    partialBundledLanguages: true,
    // Always start in English on BOTH server and the initial client render so
    // hydration produces identical text. The real language is applied after
    // mount in I18nProvider (post-hydration), preventing React hydration
    // mismatches when a non-English locale bundle wins the load race.
    lng: "en",
    backend: { loadPath: "/locales/{{lng}}/{{ns}}.json" },
    interpolation: { escapeValue: false },
  });
}

// Cookie that records an EXPLICIT language pick from the LanguagePicker only.
// Deliberately not "fennex_lang": the old LanguageDetector auto-cached a
// detected/browser value into that name, which would wrongly override the
// project's language. This fresh name is written only on a real user pick, so
// with no explicit choice the interface defaults to the project's language.
export const LANG_COOKIE = "fennex_ui_lang";

export function readLangCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + LANG_COOKIE + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export function writeLangCookie(lang: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LANG_COOKIE}=${encodeURIComponent(lang)}; max-age=${365 * 24 * 3600}; path=/; samesite=lax`;
}

/** Normalise any locale-ish string to a supported 2-letter code, or null. */
export function toSupported(l: string | null | undefined): Locale | null {
  const c = (l || "").slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(c) ? (c as Locale) : null;
}

export default i18n;
