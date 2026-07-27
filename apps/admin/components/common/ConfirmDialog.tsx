"use client";

import { useEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Uses the destructive token for the confirm button and the title icon
   * accent — for suspend/delete/revoke-style actions. */
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Disables both buttons and swaps the confirm label for a spinner while
   * the mutation is in flight. The dialog stays open — the caller closes it
   * once the request settles. */
  loading?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible confirmation modal used ahead of destructive/irreversible admin
 * actions (suspend org, revoke key, etc.). Reuses the console's `.popover`
 * surface and `.cmd-overlay` backdrop so it matches the CommandPalette
 * rather than introducing a second modal look.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onClose,
  loading,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button on open so Enter immediately confirms; restore
  // focus to whatever triggered the dialog on close.
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => trigger?.focus?.();
  }, [open]);

  // Esc closes, Tab/Shift+Tab is trapped within the panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled"),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="cmd-overlay fixed inset-0 z-50 flex items-center justify-center px-4 motion-safe:animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? "confirm-dialog-description" : undefined}
        className="popover w-full max-w-sm p-5 motion-safe:animate-scale-in"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="confirm-dialog-title" className="font-display text-lg font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {description && (
          <p id="confirm-dialog-description" className="mt-2 text-sm text-muted-foreground">
            {description}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex min-h-[40px] cursor-pointer items-center rounded-lg border border-border px-3.5 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-primary-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
              destructive ? "bg-destructive hover:brightness-110" : "bg-primary hover:brightness-110",
            )}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
