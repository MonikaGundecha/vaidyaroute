import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // VaidyaRoute enterprise wellness palette
        brand: {
          DEFAULT: "#1D6B4A", // forest green (primary)
          dark: "#145236", // hover
          light: "#E8F5EF", // green tint
        },
        accent: {
          DEFAULT: "#E8943A", // warm amber (CTAs)
          dark: "#D4832A", // hover
          light: "#FEF3E2", // amber tint (category tags)
          soft: "#FEF3C7", // amber banner background
          text: "#92400E", // amber text
        },
        edge: "#E2E8E4", // borders
        ink: {
          DEFAULT: "#111827", // text primary
          soft: "#6B7280", // text secondary
          muted: "#9CA3AF", // text muted
        },
        success: "#059669",
        danger: "#DC2626",
        warning: "#D97706",
        cream: "#F9F7F4",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-468px 0" },
          "100%": { backgroundPosition: "468px 0" },
        },
      },
      animation: {
        shimmer: "shimmer 1.5s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
