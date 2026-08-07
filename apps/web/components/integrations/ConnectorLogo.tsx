"use client";

import { useState } from "react";
import { Plug } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A connector's real mark.
 *
 * A grid of identical plug icons tells you nothing -- brand recognition is the
 * whole point of an integrations directory, and people scan for the Shopify
 * bag or the Stripe wordmark, not for the fourth grey plug in row two.
 *
 * Served from Simple Icons by slug rather than bundled: 29 SVGs would be 29
 * files to keep current as brands rebrand, and the CDN already tracks that.
 * Anything that fails to load falls back to the neutral mark, so a blocked
 * request degrades to what we had before rather than to a broken image.
 */

// Our app key -> Simple Icons slug. Only where they differ or where the brand
// name is ambiguous; the rest fall through to the app key itself.
const SLUG: Record<string, string> = {
  "google-search-console": "googlesearchconsole",
  "google-analytics": "googleanalytics",
  "google-drive": "googledrive",
  "google-ads": "googleads",
  "meta-ads": "meta",
  "tiktok-ads": "tiktok",
  "x": "x",
  threads: "threads",
  email: "maildotru",
  woocommerce: "woocommerce",
  wordpress: "wordpress",
};

// Marks that are essentially monochrome black and would vanish on a dark
// surface. Simple Icons serves a colour per request, so these get white.
const NEEDS_LIGHT = new Set(["x", "threads", "notion", "github", "vercel", "ghost"]);

export function ConnectorLogo({ app, label, className }: {
  app: string; label: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const slug = SLUG[app] ?? app.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const colour = NEEDS_LIGHT.has(app) ? "/white" : "";

  if (failed) {
    return (
      <span className={cn("flex items-center justify-center rounded-lg bg-muted text-muted-foreground", className)}>
        <Plug className="h-4 w-4" strokeWidth={1.9} />
      </span>
    );
  }
  return (
    <span className={cn("flex items-center justify-center rounded-lg bg-muted/60 p-1.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://cdn.simpleicons.org/${slug}${colour}`}
        alt=""                      /* decorative: the label is always beside it */
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
