import type { Metadata } from "next";
import { LandingContent } from "@/components/marketing/LandingContent";

export const metadata: Metadata = {
  title: "Fennex — Your virtual AI marketing agency",
  description:
    "Fennex is a pack of seven named AI specialists that research keywords, write ranking articles, design visuals, publish to WordPress & Shopify, and track what works — closing the loop on organic growth.",
};

export default function LandingPage() {
  return <LandingContent />;
}
