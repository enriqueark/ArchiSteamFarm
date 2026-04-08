import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        page: "#090909",
        chrome: "#0d0d0d",
        panel: "#1a1a1a",
        elevated: "#161616",
        strip: "#060606",
        bevel: { top: "#252525", bot: "#242424" },
        muted: "#828282",
        accent: {
          red: "#f34950",
          "red-start": "#ac2e30",
          "red-end": "#f75154",
          gold: "#dca346",
          "gold-end": "#f0b54d",
          "gold-text": "#382400",
          green: "#55ff60",
          purple: "#9147f6",
          blue: "#53a3ff",
        },
      },
      fontFamily: {
        gotham: ['"Gotham"', '"Inter"', "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        panel: "18px",
        btn: "12px",
        pill: "38px",
      },
    },
  },
  plugins: [],
};

export default config;
