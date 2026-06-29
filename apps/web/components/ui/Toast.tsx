"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastOptions {
  message?: string;
  /** Auto-dismiss delay in ms. Default 4000. Pass 0 to disable. */
  duration?: number;
}

interface ToastContextValue {
  toast: (tone: ToastTone, title: string, options?: ToastOptions) => void;
  success: (title: string, options?: ToastOptions) => void;
  error: (title: string, options?: ToastOptions) => void;
  warning: (title: string, options?: ToastOptions) => void;
  info: (title: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_META: Record<
  ToastTone,
  { icon: React.ElementType; ring: string; iconColor: string }
> = {
  success: { icon: CheckCircle2, ring: "border-success/30", iconColor: "text-success" },
  error: { icon: XCircle, ring: "border-destructive/30", iconColor: "text-destructive" },
  warning: { icon: AlertTriangle, ring: "border-warning/30", iconColor: "text-warning" },
  info: { icon: Info, ring: "border-info/30", iconColor: "text-info" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const idRef = useRef(0);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const toast = useCallback(
    (tone: ToastTone, title: string, options?: ToastOptions) => {
      const id = ++idRef.current;
      const duration = options?.duration ?? 4000;
      setItems((prev) => [...prev, { id, tone, title, message: options?.message }]);
      if (duration > 0) {
        timers.current[id] = setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    setMounted(true);
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
    };
  }, []);

  const value: ToastContextValue = {
    toast,
    success: (title, options) => toast("success", title, options),
    error: (title, options) => toast("error", title, options),
    warning: (title, options) => toast("warning", title, options),
    info: (title, options) => toast("info", title, options),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted && <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2.5">
        {items.map((t) => {
          const meta = TONE_META[t.tone];
          const Icon = meta.icon;
          return (
            <div
              key={t.id}
              className={cn(
                "popover animate-toast-in pointer-events-auto flex items-start gap-3 border-l-2 p-3.5 pr-2.5",
                meta.ring,
              )}
              role="status"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.iconColor)} strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{t.title}</p>
                {t.message && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t.message}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
