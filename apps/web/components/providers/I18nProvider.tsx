"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { I18nextProvider } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import i18n, { readLangCookie, toSupported } from "@/lib/i18n";
import { getMe, isAuthenticated, listProjects } from "@/lib/api";
import { useProjectStore } from "@/lib/store";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const authed = typeof window !== "undefined" && isAuthenticated();
  const pathname = usePathname();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: authed,
    staleTime: 5 * 60_000,
  });

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: authed,
    staleTime: 5 * 60_000,
  });

  // The viewed project lives in the URL (/{projectId}/...). Resolve the active
  // project from the URL first (so the language matches what's on screen and is
  // identical on login and after a refresh), then the store, then the first
  // project.
  const urlProjectId = pathname?.split("/").filter(Boolean)[0] ?? null;
  const storeProjectId = useProjectStore((s) => s.currentProjectId);
  const activeProject =
    projects?.find((p) => p.id === urlProjectId) ??
    projects?.find((p) => p.id === storeProjectId) ??
    projects?.[0];
  const projectLocale = toSupported(activeProject?.locale);

  // Resolve and apply the UI language ONLY after mount (in an effect), so the
  // initial client render always matches the English SSR output — no hydration
  // mismatch. Priority: an explicit picker choice, then an explicitly-chosen
  // non-default UI language, then the project's language (the default), then
  // the browser, then English.
  useEffect(() => {
    const target =
      toSupported(readLangCookie()) ??
      (me?.language && me.language !== "en" ? toSupported(me.language) : null) ??
      projectLocale ??
      (typeof navigator !== "undefined" ? toSupported(navigator.language) : null) ??
      "en";
    if (target && target !== i18n.language) {
      i18n.changeLanguage(target);
    }
  }, [me?.language, projectLocale]);

  // Keep <html> lang/dir in sync (Arabic is right-to-left).
  useEffect(() => {
    const apply = (lng: string) => {
      if (typeof document === "undefined") return;
      document.documentElement.lang = lng;
      document.documentElement.dir = lng === "ar" ? "rtl" : "ltr";
    };
    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => i18n.off("languageChanged", apply);
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
