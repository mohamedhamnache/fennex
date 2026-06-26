import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        destructive: "hsl(var(--destructive))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.65rem",  { lineHeight: "1rem" }],
        xs:   ["0.75rem",  { lineHeight: "1.1rem" }],
        sm:   ["0.8125rem",{ lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.5rem" }],
        md:   ["0.9375rem",{ lineHeight: "1.5rem" }],
        lg:   ["1rem",     { lineHeight: "1.6rem" }],
        xl:   ["1.125rem", { lineHeight: "1.6rem" }],
        "2xl":["1.375rem", { lineHeight: "1.8rem" }],
        "3xl":["1.75rem",  { lineHeight: "2.1rem" }],
        "4xl":["2.25rem",  { lineHeight: "2.5rem" }],
        "5xl":["3rem",     { lineHeight: "1.15" }],
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
