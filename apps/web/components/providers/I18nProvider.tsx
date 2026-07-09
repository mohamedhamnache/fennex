"use client";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import i18n, { readLangCookie, toSupported } from "@/lib/i18n";
import { getMe, isAuthenticated, listProjects } from "@/lib/api";
import { useProjectStore } from "@/lib/store";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const authed = typeof window !== "undefined" && isAuthenticated();

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

  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projectLocale = toSupported(
    projects?.find((p) => p.id === currentProjectId)?.locale ?? projects?.[0]?.locale,
  );

  // Resolve and apply the UI language ONLY after mount (in an effect), so the
  // initial client render always matches the English SSR output — no hydration
  // mismatch. Priority: an explicit picker choice, then an explicitly-chosen
  // non-default UI language, then the project's language (the default the user
  // asked for), then the browser, then English.
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

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
