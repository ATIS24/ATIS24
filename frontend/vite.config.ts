import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves project sites from https://USERNAME.github.io/REPO/,
// so every asset URL needs that /REPO/ prefix in production. Set
// VITE_BASE_PATH in your build environment (e.g. GitHub Actions) to
// "/your-repo-name/"; defaults to "/" for local dev.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    outDir: "dist",
    sourcemap: mode !== "production",
  },
}));
