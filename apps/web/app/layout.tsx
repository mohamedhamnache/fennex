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
            __html: `try{var p=localStorage.getItem('fx-palette');if(p){var d=document.documentElement;if(p.charAt(0)==='#'){var x=p.slice(1);if(/^[0-9a-fA-F]{6}$/.test(x)){var n=parseInt(x,16),r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,s=0,h=0;if(mx!==mn){var e=mx-mn;s=l>0.5?e/(2-mx-mn):e/(mx+mn);h=mx===r?(g-b)/e+(g<b?6:0):mx===g?(b-r)/e+2:(r-g)/e+4;h/=6;}var H=Math.round(h*360),S=Math.round(s*100),L=Math.round(l*100),P=H+' '+S+'% '+L+'%';d.style.setProperty('--primary',P);d.style.setProperty('--ring',P);d.style.setProperty('--primary-accent',H+' '+Math.min(S+4,100)+'% '+Math.min(L+7,92)+'%');d.style.setProperty('--primary-foreground',L>65?'26 30% 12%':'40 44% 98%');}}else{d.setAttribute('data-palette',p);}}}catch(e){}`,
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
