/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#090d16",
        surface: "#0f172a",
        surfaceHover: "#1e293b",
        borderDark: "#1e293b",
        maivw: {
          DEFAULT: "#7d0000",
          50: "#fff1f1",
          100: "#ffe1e1",
          200: "#ffc7c7",
          300: "#ffa0a0",
          400: "#f86a6a",
          500: "#c51c1c",
          600: "#990000",
          700: "#7d0000",
          800: "#5e0000",
          900: "#400000",
          950: "#220000",
        },
        accent: {
          indigo: "#6366f1",
          cyan: "#06b6d4",
          purple: "#a855f7",
          emerald: "#10b981",
        },
      },
    },
  },
  plugins: [],
};
