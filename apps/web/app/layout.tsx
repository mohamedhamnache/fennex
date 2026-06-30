import type { Metadata } from "next";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
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
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
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
