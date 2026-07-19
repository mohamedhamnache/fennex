"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ShoppingBag, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { connectShopify, disconnectShopify, type ShopifyStatus } from "@/lib/api";

interface Props {
  projectId: string;
  status: ShopifyStatus;
  onClose: () => void;
  onChanged: () => void;
}

/** Known backend error codes → i18n key suffix under integrations.shopify.errors */
const ERROR_KEYS = new Set(["unauthorized", "invalid_domain", "missing_token"]);

export function ShopifyConnectModal({ projectId, status, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const [domain, setDomain] = useState(status.shop_domain ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (busy || !domain.trim() || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await connectShopify(projectId, domain.trim(), token.trim());
      if (!res.ok) {
        const code = res.error ?? "";
        setError(ERROR_KEYS.has(code) ? t(`integrations.shopify.errors.${code}`) : t("integrations.shopify.errors.generic"));
        return;
      }
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("integrations.shopify.errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectShopify(projectId);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("integrations.shopify.errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShoppingBag className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <h2 className="text-sm font-semibold text-foreground">{t("integrations.shopify.title")}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {status.connected ? (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 px-3 py-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{status.shop_name || status.shop_domain}</p>
                <p className="truncate text-xs text-muted-foreground">{status.shop_domain}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("integrations.shopify.connectedHint")}</p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                {t("common.close")}
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("integrations.shopify.disconnect")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <p className="text-xs text-muted-foreground">{t("integrations.shopify.intro")}</p>
            <ol className="flex flex-col gap-1.5 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
              <li>{t("integrations.shopify.step1")}</li>
              <li>{t("integrations.shopify.step2")}</li>
              <li>{t("integrations.shopify.step3")}</li>
            </ol>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">{t("integrations.shopify.domainLabel")}</span>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="myshop.myshopify.com"
                autoComplete="off"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">{t("integrations.shopify.tokenLabel")}</span>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
                placeholder="shpat_..."
                autoComplete="off"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <span className="text-[11px] text-muted-foreground">{t("integrations.shopify.tokenHint")}</span>
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <a
                href="https://help.shopify.com/en/manual/apps/app-types/custom-apps"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {t("integrations.shopify.help")}
                <ExternalLink className="h-3 w-3" />
              </a>
              <button
                type="button"
                onClick={handleConnect}
                disabled={busy || !domain.trim() || !token.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("integrations.shopify.connect")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
