import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        rent: {
          bg: "#040816",
          panel: "#0d1528",
          border: "#202b45",
          accent: "#56b6f7",
        },
      },
      boxShadow: {
        panel: "0 18px 60px rgba(0, 0, 0, 0.35)",
      },
      backgroundImage: {
        "rent-gradient":
          "radial-gradient(circle at 20% 20%, rgba(86, 182, 247, 0.16), transparent 38%), radial-gradient(circle at 80% 0%, rgba(80, 120, 255, 0.18), transparent 45%), radial-gradient(circle at 50% 100%, rgba(125, 91, 255, 0.12), transparent 30%)",
      },
    },
  },
  plugins: [],
};

export default config;
