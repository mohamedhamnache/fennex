"use client";

import { useState } from "react";
import { X, Download, Loader2, CheckCircle2, AlertCircle, FileImage } from "lucide-react";
import { cn } from "@/lib/cn";
import { exportImage, type ExportFormat, type ExportResult } from "@/lib/api";

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: "png",  label: "PNG",  hint: "Lossless, transparency" },
  { id: "jpg",  label: "JPG",  hint: "Small, photos" },
  { id: "webp", label: "WebP", hint: "Smallest, modern web" },
];

const SIZES: { label: string; value: number | null }[] = [
  { label: "Original", value: null },
  { label: "2048px", value: 2048 },
  { label: "1080px", value: 1080 },
  { label: "720px", value: 720 },
];

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

interface ExportModalProps {
  imageId: string;
  originalWidth?: number;
  originalHeight?: number;
  onClose: () => void;
}

export function ExportModal({ imageId, originalWidth, originalHeight, onClose }: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [quality, setQuality] = useState(90);
  const [size, setSize] = useState<number | null>(null);
  const [customWidth, setCustomWidth] = useState<string>("");
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveWidth = useCustom
    ? (Number(customWidth) >= 16 && Number(customWidth) <= 8192 ? Number(customWidth) : undefined)
    : (size ?? undefined);
  const customInvalid = useCustom && customWidth !== "" && effectiveWidth === undefined;

  async function handleExport() {
    if (loading || customInvalid) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await exportImage(imageId, format, quality, effectiveWidth);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileImage className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Export image</h2>
              {originalWidth && originalHeight ? (
                <p className="text-[10px] text-muted-foreground tabular-nums">{originalWidth}×{originalHeight} source</p>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Format */}
          <div>
            <span className="text-xs font-semibold text-foreground mb-2 block">Format</span>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { setFormat(f.id); setResult(null); }}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 transition-colors",
                    format === f.id ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                  )}
                >
                  <span className={cn("text-xs font-semibold", format === f.id ? "text-primary" : "text-foreground")}>{f.label}</span>
                  <span className="text-[9px] text-muted-foreground leading-tight text-center">{f.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Quality — lossy formats only */}
          {format !== "png" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Quality</span>
                <span className="text-xs text-muted-foreground tabular-nums">{quality}</span>
              </div>
              <input
                type="range"
                min={40}
                max={100}
                step={5}
                value={quality}
                onChange={(e) => { setQuality(Number(e.target.value)); setResult(null); }}
                className="w-full accent-primary"
              />
            </div>
          )}

          {/* Size */}
          <div>
            <span className="text-xs font-semibold text-foreground mb-2 block">Size</span>
            <div className="flex flex-wrap gap-1.5">
              {SIZES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => { setUseCustom(false); setSize(s.value); setResult(null); }}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    !useCustom && size === s.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                  )}
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setUseCustom(true); setResult(null); }}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  useCustom ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                Custom
              </button>
            </div>
            {useCustom && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  autoFocus
                  min={16}
                  max={8192}
                  value={customWidth}
                  onChange={(e) => { setCustomWidth(e.target.value); setResult(null); }}
                  placeholder={String(originalWidth ?? 1024)}
                  className="w-24 rounded-lg border border-border bg-input px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="text-xs text-muted-foreground">px wide (aspect kept)</span>
              </div>
            )}
            {customInvalid && <p className="mt-1 text-xs text-destructive">Width must be 16–8192px.</p>}
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}

          {/* Result */}
          {result && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-green-600/30 bg-green-500/10 px-3 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                <span className="text-xs text-foreground tabular-nums truncate">
                  {result.width}×{result.height} · {result.format.toUpperCase()} · {humanBytes(result.size_bytes)}
                </span>
              </div>
              <a
                href={result.download_url}
                download={`export-${imageId.slice(0, 8)}.${result.format}`}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors">
            {result ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={loading || customInvalid}
            onClick={handleExport}
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting…</> : result ? "Export again" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
