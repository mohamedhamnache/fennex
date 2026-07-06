"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Globe, ExternalLink, X, Check, Loader2, AlertCircle } from "lucide-react";
import { publishImage } from "@/lib/api";

const PLATFORMS = [
  {
    id: "wordpress",
    label: "WordPress",
    description: "Upload to media library",
    Icon: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#21759b">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM3.5 12c0-1.03.19-2.01.53-2.93L7.7 20.2A8.52 8.52 0 013.5 12zm8.5 8.5a8.5 8.5 0 01-2.38-.34l2.53-7.35 2.59 7.09c.02.04.04.08.06.11A8.53 8.53 0 0112 20.5zm1.17-12.56c.51-.03.97-.08.97-.08.46-.06.4-.72-.06-.7 0 0-1.37.11-2.26.11-.83 0-2.24-.11-2.24-.11-.46-.02-.52.66-.06.69 0 0 .44.05.9.08l1.34 3.67-1.88 5.63L6.3 8.07c.51-.03.97-.08.97-.08.46-.06.4-.72-.06-.7 0 0-1.37.11-2.26.11-.16 0-.34 0-.53-.01A8.5 8.5 0 0112 3.5c2.24 0 4.28.87 5.8 2.28-.04 0-.07-.01-.11-.01-.83 0-1.42.72-1.42 1.5 0 .69.4 1.28.83 1.97.32.56.7 1.28.7 2.32 0 .72-.28 1.56-.64 2.72l-.84 2.8-3.05-9.07zm4.01 10.52l2.54-7.34c.47-1.18.63-2.12.63-2.96 0-.3-.02-.59-.06-.86A8.5 8.5 0 0120.5 12a8.48 8.48 0 01-3.82 7.12l.0-.06z" />
      </svg>
    ),
    configField: null,
  },
  {
    id: "shopify",
    label: "Shopify",
    description: "Upload to Files",
    Icon: () => (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#95bf47">
        <path d="M15.34 3.5c-.04-.3-.3-.45-.52-.47-.22-.02-4.7-.35-4.7-.35L8.1 1.16C7.87.94 7.4.99 7.2 1.06L6.28 1.4C6 .6 5.46 0 4.7 0 4.68 0 4.67 0 4.66 0L4.56.02C4.4.01 3.58-.08 2.88.88L1.65 4.7l-.02.08C.63 5.16 0 5.64 0 6.25v.01c0 .13.02.25.05.37L2.3 20.4c.13.7.72 1.2 1.43 1.2h14.56c.7 0 1.3-.5 1.43-1.2l2.24-13.78c.04-.2.04-.41 0-.6zM13.8 5.1l-2.14.66V5.5c0-.6-.08-1.08-.21-1.47l2.35-.73zm-3.5-1.97c.17.4.28.97.28 1.76v.1l-2.15.67c.42-1.6 1.2-2.37 1.87-2.53zm-.83-.56C9.3 2.7 8.5 3.82 8.08 5.63L6.5 6.13c.5-1.7 1.64-2.8 2.97-3.56zm8.43 2.84l-.4.13-1.82.57c-.14-.5-.36-.93-.65-1.27l.64-.2c.32-.1.47.02.52.1.05.1.07.25.06.42l1.65-.52c0-.01-.01-.23-.07-.43zm-1.04-1.9c-.17-.73-.51-1.3-1.09-1.62-.6-.33-1.4-.3-2.35-.12l-.5.14-.32.1-2.5.77-.06.02-2.15.66-1.72.53-2.42.75-.06.02-.4.12L2.9 5.32a2 2 0 01.8-.32l.5-.07L5.3 4.6l.78-.24L8 3.8l.03-.01 1.4-.43 2.5-.77.12-.04 2.64-.82c.73-.22 1.35-.3 1.9-.24.56.06 1 .28 1.34.66.5.57.78 1.4.87 2.47z" />
      </svg>
    ),
    configField: { key: "shopify_domain", label: "Store domain", placeholder: "mystore.myshopify.com" },
  },
];

interface PublishModalProps {
  imageId: string;
  onClose: () => void;
}

export function PublishModal({ imageId, onClose }: PublishModalProps) {
  const [selectedId, setSelectedId] = useState("wordpress");
  const [shopifyDomain, setShopifyDomain] = useState("");
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const selected = PLATFORMS.find((p) => p.id === selectedId)!;

  const mutation = useMutation({
    mutationFn: () => {
      const config: Record<string, string> = {};
      if (selectedId === "shopify" && shopifyDomain.trim()) {
        config.shopify_domain = shopifyDomain.trim();
      }
      return publishImage(imageId, selectedId, config);
    },
    onSuccess: (data) => {
      if (data.external_url) setPublishedUrl(data.external_url);
    },
  });

  const canPublish =
    selectedId === "shopify" ? shopifyDomain.trim().length > 0 : true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-xl bg-card border border-border shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Publish Image</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Platform picker */}
        <div className="p-4 flex flex-col gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setSelectedId(p.id); setPublishedUrl(null); mutation.reset(); }}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                selectedId === p.id
                  ? "border-primary bg-primary/8"
                  : "border-border hover:bg-accent/50"
              }`}
            >
              <p.Icon />
              <div>
                <p className={`text-sm font-medium ${selectedId === p.id ? "text-primary" : "text-foreground"}`}>
                  {p.label}
                </p>
                <p className="text-xs text-muted-foreground">{p.description}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Config field (Shopify domain) */}
        {selected.configField && (
          <div className="px-4 pb-3">
            <label className="block text-xs font-medium text-foreground mb-1.5">
              {selected.configField.label}
            </label>
            <input
              type="text"
              value={shopifyDomain}
              onChange={(e) => setShopifyDomain(e.target.value)}
              placeholder={selected.configField.placeholder}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        )}

        {/* Success */}
        {publishedUrl && (
          <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2">
            <Check className="h-4 w-4 text-green-500 shrink-0" />
            <a
              href={publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green-600 hover:underline flex items-center gap-1 truncate"
            >
              Published — view <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
        )}

        {/* Error */}
        {mutation.isError && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : "Publish failed"}
            </p>
          </div>
        )}

        {/* Action */}
        <div className="px-4 pb-4">
          <button
            type="button"
            disabled={mutation.isPending || !!publishedUrl || !canPublish}
            onClick={() => mutation.mutate()}
            className="btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {publishedUrl ? "Published" : mutation.isPending ? "Publishing..." : `Publish to ${selected.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}
