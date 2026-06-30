import i18n from "i18next";
import { initReactI18next } from "react-i18next";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const enCommon = require("../public/locales/en/common.json");

export const SUPPORTED_LOCALES = ["en", "fr", "es", "de", "pt", "ar"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

if (!i18n.isInitialized) {
  const chain = i18n.use(initReactI18next);

  if (typeof window !== "undefined") {
    // Browser-only plugins — safe to omit during SSR
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Backend = require("i18next-http-backend").default;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const LanguageDetector = require("i18next-browser-languagedetector").default;
    chain.use(Backend).use(LanguageDetector);
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
    lng: typeof window === "undefined" ? "en" : undefined,
    backend: { loadPath: "/locales/{{lng}}/{{ns}}.json" },
    detection:
      typeof window !== "undefined"
        ? {
            order: ["cookie", "navigator"],
            lookupCookie: "fennex_lang",
            caches: ["cookie"],
            cookieOptions: { maxAge: 365 * 24 * 3600, path: "/", sameSite: "lax" },
          }
        : undefined,
    interpolation: { escapeValue: false },
  });
}

export default i18n;
