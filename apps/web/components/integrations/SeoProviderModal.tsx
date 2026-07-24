"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { createApiKey, deleteApiKey, testDataForSeo, type ApiKey } from "@/lib/api";

/** Connect the SEO data provider (DataForSEO).
 *
 *  Credentials are a login and password rather than a single token, and they
 *  are verified against the provider on save — a wrong password used to fail
 *  silently much later, as a keyword lookup that simply returned nothing.
 */
export function SeoProviderModal({
  existing, onClose,
}: { existing?: ApiKey; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: async () => {
      setError(null);
      await createApiKey("dataforseo", `${login.trim()}:${password.trim()}`);
      // Verify immediately so a bad credential surfaces here, not weeks later.
      return testDataForSeo();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      if (result.ok) {
        onClose();
      } else {
        setError(result.error ?? t("integrations.seo.testFailed"));
      }
    },
    onError: () => setError(t("integrations.seo.saveFailed")),
  });

  const remove = useMutation({
    mutationFn: () => deleteApiKey(existing!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm animate-fade-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl animate-scale-in"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-bold text-foreground">
              {t("integrations.seo.title")}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("integrations.seo.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {existing ? (
          <div className="mt-4 rounded-xl border border-success/30 bg-success/[0.06] p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-success">
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              {t("integrations.seo.connected")}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {existing.masked_value}
            </p>
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="mt-3 cursor-pointer rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
            >
              {t("integrations.seo.disconnect")}
            </button>
          </div>
        ) : (
          <>
            <label className="mt-4 block text-[11px] font-semibold text-muted-foreground" htmlFor="seo-login">
              {t("integrations.seo.login")}
            </label>
            <input
              id="seo-login"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
            />

            <label className="mt-3 block text-[11px] font-semibold text-muted-foreground" htmlFor="seo-password">
              {t("integrations.seo.password")}
            </label>
            <div className="relative mt-1">
              <input
                id="seo-password"
                type={reveal ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? t("integrations.seo.hide") : t("integrations.seo.reveal")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
              >
                {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>

            {error && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => connect.mutate()}
              disabled={!login.trim() || !password.trim() || connect.isPending}
              className="btn-primary mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connect.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("integrations.seo.connectAndTest")}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {t("integrations.seo.hint")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
