import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves project sites from https://USERNAME.github.io/REPO/,
// so every asset URL needs that /REPO/ prefix in production, or every JS/CSS
// request 404s and the page renders completely blank (React never mounts).
//
// Resolution order:
//   1. VITE_BASE_PATH, if explicitly set — always wins.
//   2. GITHUB_REPOSITORY (automatically set by GitHub Actions as
//      "owner/repo-name") — derives "/repo-name/" automatically, so a CI
//      build is correct even if nobody remembered to set VITE_BASE_PATH.
//   3. "/" — correct for local dev and for a user/org page
//      (username.github.io) which is served from the domain root.
function resolveBase(): string {
  if (process.env.VITE_BASE_PATH) return process.env.VITE_BASE_PATH;
  if (process.env.GITHUB_REPOSITORY) {
    const repoName = process.env.GITHUB_REPOSITORY.split("/")[1];
    if (repoName) return `/${repoName}/`;
  }
  return "/";
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: resolveBase(),
  build: {
    outDir: "dist",
    sourcemap: mode !== "production",
  },
}));
