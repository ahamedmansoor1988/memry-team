import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Extension design tokens
        paper:   "#FFFFFF",
        surface: "#F7F7F7",
        border:  "#E5E5E5",
        ink:     "#0A0A0A",
        muted:   "#6B6B6B",
        wash:    "#EDEDED",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      fontSize: {
        caption: ["11px", { lineHeight: "16px", letterSpacing: "0.02em" }],
        body:    ["13px", { lineHeight: "20px" }],
        lead:    ["15px", { lineHeight: "24px" }],
        title:   ["18px", { lineHeight: "26px", letterSpacing: "-0.01em" }],
      },
      borderRadius: {
        panel: "12px",
      },
      keyframes: {
        shimmer: {
          "0%":   { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.4s infinite",
        fadeIn:  "fadeIn 0.15s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
