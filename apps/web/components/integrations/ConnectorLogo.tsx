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

  // FIVE OF THESE HAVE NO MARK, and not because the slug is wrong. Simple
  // Icons removes a logo when the brand's legal team asks it to; Canva,
  // LinkedIn and Slack are among those removals, and Klaviyo was never added.
  // Bundling their SVGs locally would be doing the exact thing those companies
  // asked a public CDN to stop doing, so they get a lettermark instead.
  //
  // Tinted per brand rather than left grey: a row of identical grey squares is
  // the problem the logos were meant to solve. The hue is derived from the
  // name, so it is stable across renders and distinct between neighbours.
  if (failed) {
    const initials = label.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean)
      .slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    let hash = 0;
    for (const ch of app) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return (
      <span
        className={cn("flex items-center justify-center rounded-lg text-[11px] font-bold", className)}
        style={{
          // Fixed lightness in each theme so contrast holds both ways -- the
          // mistake the forced-white logos made.
          background: `hsl(${hash} 62% 92%)`,
          color: `hsl(${hash} 70% 30%)`,
        }}
      >
        {initials || <Plug className="h-4 w-4" strokeWidth={1.9} />}
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
