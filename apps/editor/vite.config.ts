import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Editor build. `base: "./"` keeps asset URLs relative so the production build loads
 * from `file://` inside Electron as well as from any static host.
 */
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5199,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    target: "es2023",
    sourcemap: true,
  },
});
