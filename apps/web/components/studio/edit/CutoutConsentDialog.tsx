"use client";

import { useTranslation } from "react-i18next";
import { Loader2, Scissors } from "lucide-react";
import { cn } from "@/lib/cn";

interface CutoutConsentDialogProps {
  open: boolean;
  /** Exact credit cost of the cutout call — interpolated into the body copy,
   *  never hard-coded, so a reprice can't leave the dialog's text wrong. */
  credits: number;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Consent gate for a template's "subject-cutout" layer (families.ts / text
 * -templates.ts): removing the background is a paid Replicate call
 * (editing_service.remove_background_cheap), and applying a template must
 * never silently spend a customer's credits. Cancel applies nothing; Confirm
 * runs the cutout and only then builds the template's layers.
 */
export function CutoutConsentDialog({
  open,
  credits,
  loading = false,
  error,
  onConfirm,
  onCancel,
}: CutoutConsentDialogProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={loading ? undefined : onCancel}
    >
      <div
        className="relative w-[420px] max-w-[92vw] rounded-2xl border border-border bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Scissors className="h-4 w-4" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-foreground">
              {t("imageEdit.cutout.title", "Cut out the background?")}
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t(
                "imageEdit.cutout.body",
                "This template places the subject with its background removed — an AI step that costs {{count}} credits.",
                { count: credits },
              )}
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-destructive leading-relaxed">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("imageEdit.cutout.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("imageEdit.cutout.confirm", "Cut out and apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
