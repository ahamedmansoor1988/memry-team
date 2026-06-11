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
        background:       "var(--bg)",
        foreground:       "var(--text)",
        surface:          "var(--surface)",
        "sidebar-bg":     "var(--sidebar-bg)",
        border:           "var(--border)",
        "border-2":       "var(--border-2)",
        "text-1":         "var(--text)",
        "text-2":         "var(--text-2)",
        "text-3":         "var(--text-3)",
        accent:           "var(--accent)",
        "accent-ink":     "var(--accent-ink)",
        "accent-soft":    "var(--accent-soft)",
        "accent-softer":  "var(--accent-softer)",
        "accent-border":  "var(--accent-border)",
        "accent-text":    "var(--accent-text)",
        green:            "var(--green)",
        "green-soft":     "var(--green-soft)",
        amber:            "var(--amber)",
        "amber-soft":     "var(--amber-soft)",
        red:              "var(--red)",
        "red-soft":       "var(--red-soft)",
        blue:             "var(--blue)",
        "blue-soft":      "var(--blue-soft)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Helvetica Neue", "sans-serif"],
        mono: ["var(--font-mono)", "SF Mono", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        xs:    ["11px", { lineHeight: "16px" }],
        sm:    ["12px", { lineHeight: "18px" }],
        base:  ["13px", { lineHeight: "20px" }],
        md:    ["14px", { lineHeight: "22px" }],
        lg:    ["15px", { lineHeight: "24px" }],
        xl:    ["17px", { lineHeight: "26px", letterSpacing: "-0.01em" }],
        "2xl": ["20px", { lineHeight: "28px", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm:  "6px",
        md:  "8px",
        lg:  "10px",
        xl:  "12px",
        "2xl": "16px",
        full: "9999px",
      },
      boxShadow: {
        "1": "var(--shadow-1)",
        "2": "var(--shadow-2)",
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
