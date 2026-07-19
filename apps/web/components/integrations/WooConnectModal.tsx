"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, ShoppingCart, Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { connectWoo, disconnectWoo, type WooStatus } from "@/lib/api";

interface Props {
  projectId: string;
  status: WooStatus;
  onClose: () => void;
  onChanged: () => void;
}

const ERROR_KEYS = new Set(["unauthorized", "invalid_url", "missing_credentials", "not_woocommerce", "unreachable"]);

export function WooConnectModal({ projectId, status, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(status.store_url ?? "");
  const [ck, setCk] = useState("");
  const [cs, setCs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = url.trim() && ck.trim() && cs.trim();

  async function handleConnect() {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await connectWoo(projectId, url.trim(), ck.trim(), cs.trim());
      if (!res.ok) {
        const code = res.error ?? "";
        if (ERROR_KEYS.has(code)) setError(t(`integrations.woo.errors.${code}`));
        else setError(`${t("integrations.woo.errors.generic")}${code ? ` (${code})` : ""}${res.detail ? `: ${res.detail}` : ""}`);
        return;
      }
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("integrations.woo.errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectWoo(projectId);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("integrations.woo.errors.generic"));
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
              <ShoppingCart className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <h2 className="text-sm font-semibold text-foreground">{t("integrations.woo.title")}</h2>
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
                <p className="truncate text-sm font-medium text-foreground">{status.shop_name || status.store_url}</p>
                <p className="truncate text-xs text-muted-foreground">{status.store_url}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("integrations.woo.connectedHint")}</p>
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
                {t("integrations.woo.disconnect")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <p className="text-xs text-muted-foreground">{t("integrations.woo.intro")}</p>
            <ol className="flex flex-col gap-1.5 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
              <li>{t("integrations.woo.step1")}</li>
              <li>{t("integrations.woo.step2")}</li>
              <li>{t("integrations.woo.step3")}</li>
            </ol>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">{t("integrations.woo.urlLabel")}</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://shop.example.com"
                autoComplete="off"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">{t("integrations.woo.keyLabel")}</span>
              <input
                value={ck}
                onChange={(e) => setCk(e.target.value)}
                placeholder="ck_..."
                autoComplete="off"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">{t("integrations.woo.secretLabel")}</span>
              <input
                value={cs}
                onChange={(e) => setCs(e.target.value)}
                type="password"
                placeholder="cs_..."
                autoComplete="off"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <span className="text-[11px] text-muted-foreground">{t("integrations.woo.secretHint")}</span>
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <a
                href="https://woocommerce.com/document/woocommerce-rest-api/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {t("integrations.woo.help")}
                <ExternalLink className="h-3 w-3" />
              </a>
              <button
                type="button"
                onClick={handleConnect}
                disabled={busy || !canSubmit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("integrations.woo.connect")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
