import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        muted: "#64748b",
        line: "#d8dee8",
        panel: "#ffffff",
        wash: "#f5f7fb",
        navy: "#1d3557",
        teal: "#0f766e",
        amber: "#b7791f",
        rose: "#b91c1c",
        mint: "#e6f4f1",
        gold: "#fff4d6"
      },
      boxShadow: {
        soft: "0 12px 30px rgba(23, 32, 51, 0.08)"
      },
      borderRadius: {
        DEFAULT: "8px"
      }
    }
  },
  plugins: []
};

export default config;
