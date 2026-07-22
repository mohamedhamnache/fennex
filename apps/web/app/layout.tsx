import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { ThemeProvider } from "@/components/providers/ThemeProvider";

// Load the UI face through Next's font pipeline so it is self-hosted and applied
// at the document root — reliable app-wide, no flash of a fallback face. Manrope
// is a clean, modern, highly-legible sans well suited to product + marketing UI.
const uiSans = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});
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
    <html lang="en" className={uiSans.variable} suppressHydrationWarning>
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
