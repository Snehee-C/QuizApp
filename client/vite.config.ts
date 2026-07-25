import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true exposes the dev server on your LAN so phones on the same WiFi
// can reach it at http://<your-lan-ip>:5173
//
// base: GitHub Pages project sites are served from https://<user>.github.io/<repo>/,
// not the domain root, so every asset URL needs that /<repo>/ prefix in
// production. The deploy workflow sets VITE_BASE_PATH; local dev leaves it
// unset and falls back to "/".
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    host: true,
    port: 5173,
  },
});
