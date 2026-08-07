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
  // No mapping for "email" on purpose: it is a generic connector, not a brand.
  // It previously pointed at "maildotru", which renders the Mail.ru logo --
  // a real company that has nothing to do with this connector. Falling back to
  // initials is honest; borrowing someone's mark is not.
  // klaviyo has no mark in Simple Icons (404) -- it falls back to initials.
  woocommerce: "woocommerce",
  wordpress: "wordpress",
};

// Marks that are essentially monochrome black. They vanish on a dark surface
// -- but forcing white made them vanish on a LIGHT one instead, which is what
// happened to Canva, Notion and Ghost. Requesting the brand colour and
// inverting only in dark mode is theme-aware, where a fixed colour cannot be:
// the page can be either, and the CDN serves one image.
const MONOCHROME = new Set([
  "x", "threads", "notion", "github", "vercel", "ghost", "canva", "openai",
]);

export function ConnectorLogo({ app, label, className }: {
  app: string; label: string; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const slug = SLUG[app] ?? app.replace(/[^a-z0-9]/gi, "").toLowerCase();

  // A brand with no mark in the set gets its initials, not a generic plug: at
  // a glance "KL" in the Klaviyo row still distinguishes it from its
  // neighbours, where the fourth identical plug does not.
  if (failed) {
    return (
      <span className={cn(
        "flex items-center justify-center rounded-lg bg-muted text-[11px] font-bold uppercase text-muted-foreground",
        className,
      )}>
        {label.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean)
          .slice(0, 2).map((w) => w[0]).join("") || <Plug className="h-4 w-4" strokeWidth={1.9} />}
      </span>
    );
  }
  return (
    <span className={cn("flex items-center justify-center rounded-lg bg-muted/60 p-1.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://cdn.simpleicons.org/${slug}`}
        alt=""                      /* decorative: the label is always beside it */
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("h-full w-full object-contain",
                      MONOCHROME.has(app) && "dark:invert")}
      />
    </span>
  );
}
