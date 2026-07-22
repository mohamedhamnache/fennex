import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        destructive: "hsl(var(--destructive) / <alpha-value>)",
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Figtree", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Fraunces", "Playfair Display", "Georgia", "ui-serif", "serif"],
      },
      // Type scale bumped up one comfortable notch for readability — the UI leans
      // heavily on xs/sm/base, so a larger floor materially improves legibility.
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],      // 11px
        xs:   ["0.8125rem", { lineHeight: "1.15rem" }],   // 13px
        sm:   ["0.875rem",  { lineHeight: "1.3rem" }],    // 14px
        base: ["0.9375rem", { lineHeight: "1.55rem" }],   // 15px
        md:   ["1rem",      { lineHeight: "1.6rem" }],     // 16px
        lg:   ["1.0625rem", { lineHeight: "1.7rem" }],    // 17px
        xl:   ["1.1875rem", { lineHeight: "1.7rem" }],    // 19px
        "2xl":["1.5rem",    { lineHeight: "1.9rem" }],    // 24px
        "3xl":["1.875rem",  { lineHeight: "2.2rem" }],    // 30px
        "4xl":["2.375rem",  { lineHeight: "2.6rem" }],    // 38px
        "5xl":["3.25rem",   { lineHeight: "1.12" }],      // 52px
      },
      spacing: { "13": "3.25rem", "15": "3.75rem", "18": "4.5rem" },
      borderRadius: {
        sm:  "0.25rem",
        DEFAULT: "0.5rem",
        md:  "0.625rem",
        lg:  "0.75rem",
        xl:  "1rem",
        "2xl":"1.25rem",
        "3xl":"1.5rem",
      },
      boxShadow: {
        xs:      "0 1px 2px hsl(220 13% 0% / 0.05)",
        sm:      "0 1px 3px hsl(220 13% 0% / 0.08), 0 1px 2px hsl(220 13% 0% / 0.04)",
        DEFAULT: "0 2px 8px hsl(220 13% 0% / 0.08), 0 1px 3px hsl(220 13% 0% / 0.05)",
        md:      "0 4px 16px hsl(220 13% 0% / 0.08), 0 2px 6px hsl(220 13% 0% / 0.05)",
        lg:      "0 8px 32px hsl(220 13% 0% / 0.1), 0 4px 12px hsl(220 13% 0% / 0.06)",
        "indigo":"0 4px 20px hsl(252 95% 63% / 0.3)",
      },
      backgroundImage: {
        "gradient-brand": "linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%)",
        "gradient-dark":  "linear-gradient(145deg, #0f0c29 0%, #1a1065 40%, #24243e 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
