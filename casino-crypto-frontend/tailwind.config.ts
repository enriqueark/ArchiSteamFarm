import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#e53e3e",
          dark: "#c53030",
          light: "#fc8181",
        },
        surface: {
          DEFAULT: "#111118",
          100: "#17171f",
          200: "#1c1c27",
          300: "#24243a",
          400: "#2d2d44",
        },
        border: {
          DEFAULT: "#2a2a3d",
          light: "#3a3a52",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
