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
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Fraunces", "Playfair Display", "Georgia", "ui-serif", "serif"],
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
