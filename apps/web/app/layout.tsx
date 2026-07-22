import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

// Geist (Vercel) — the modern standard for AI/dev-tool SaaS. Self-hosted via the
// `geist` package (next/font under the hood) and exposed as --font-geist-sans on
// <html>, so it applies app-wide with no flash of a fallback face.
import { QueryProvider } from "@/components/providers/QueryProvider";
import { I18nProvider } from "@/components/providers/I18nProvider";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Fennex — AI SEO Growth Platform",
    template: "%s | Fennex",
  },
  description: "Autonomous AI-powered SEO and content growth platform. Grow organic traffic on autopilot.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Apply the saved per-project palette before paint to avoid a flash of the default. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=localStorage.getItem('fx-palette');if(p)document.documentElement.setAttribute('data-palette',p);}catch(e){}`,
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <QueryProvider>
            <I18nProvider>
              <ToastProvider>{children}</ToastProvider>
            </I18nProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
