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
        "app-bg":     "#0F1117",
        "surface":    "#161920",
        "elevated":   "#1e2130",
        "input-bg":   "#13151f",
        "app-border": "#2a2d3a",
        "primary":    "#e2e4ef",
        "muted":      "#9ea3b8",
        "faint":      "#6e7391",
        "accent":     "#6366F1",
        "warn":       "#EF9F27",
      },
      fontSize: {
        "10": "10px",
        "11": "11px",
      },
    },
  },
  plugins: [],
};
export default config;
