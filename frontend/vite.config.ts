import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This is deployed as a user/organization GitHub Pages site
// (https://atis24.github.io/), which is always served at the domain
// ROOT — unlike a project Pages site (https://USERNAME.github.io/REPO/),
// it never needs a /REPO/ subpath prefix, regardless of what the
// repository is named. VITE_BASE_PATH is left unset in the deploy
// workflow so this defaults to "/"; only set it if you specifically
// deploy this as a project site under someone else's user/org page.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    outDir: "dist",
    sourcemap: mode !== "production",
  },
}));
