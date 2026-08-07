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

// The brand's own domain, for the fallback below. Only where it cannot be
// guessed from the app key.
const DOMAIN: Record<string, string> = {
  "google-search-console": "google.com",
  "google-analytics": "google.com",
  "google-drive": "google.com",
  "google-ads": "google.com",
  "meta-ads": "meta.com",
  "tiktok-ads": "tiktok.com",
  gmail: "gmail.com",
  notion: "notion.so",
  x: "x.com",
  threads: "threads.net",
  woocommerce: "woocommerce.com",
  klaviyo: "klaviyo.com",
  canva: "canva.com",
  slack: "slack.com",
  linkedin: "linkedin.com",
};

export function ConnectorLogo({ app, label, className }: {
  app: string; label: string; className?: string;
}) {
  // Three steps, not two. Simple Icons has no mark for Canva, LinkedIn, Slack
  // or Klaviyo -- it removes logos at a brand's request -- but that is about
  // SIMPLE ICONS redistributing the SVG, not about whether an integrations
  // directory may show a partner's logo. Showing it is what brand guidelines
  // exist to permit. So a missing mark now falls through to the brand's own
  // favicon before it gives up and draws letters.
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const failed = step === 2;
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
    // Two characters, always. One char per word gave "C" for Canva and "L"
    // for LinkedIn -- a single letter in a tinted square reads as a missing
    // asset, not as a mark. Multi-word names take an initial from each; a
    // one-word name takes its first two letters.
    const words = label.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean);
    const initials = (words.length > 1
      ? words.slice(0, 2).map((w) => w[0]).join("")
      : (words[0] ?? "").slice(0, 2)).toUpperCase();
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
  const domain = DOMAIN[app] ?? `${app.replace(/[^a-z0-9-]/gi, "")}.com`;
  const src = step === 0
    ? `https://cdn.simpleicons.org/${slug}`
    : `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

  return (
    <span className={cn("flex items-center justify-center rounded-lg bg-muted/60 p-1.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}                   /* a new src must re-attempt, not reuse the failed node */
        src={src}
        alt=""                      /* decorative: the label is always beside it */
        loading="lazy"
        onError={() => setStep((n) => (n === 0 ? 1 : 2))}
        className={cn("h-full w-full object-contain",
                      // Only the flat SVG marks need inverting. A favicon is
                      // already full-colour artwork and inverting it would
                      // turn the brand's own logo into a negative.
                      step === 0 && MONOCHROME.has(app) && "dark:invert")}
      />
    </span>
  );
}
