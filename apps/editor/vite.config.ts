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
  // Workspace packages are served as source, so their dependencies are only found mid-load.
  // Pre-bundle them up front: a cold dev server otherwise re-optimizes and the first load 504s.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "zustand",
      "zustand/vanilla",
      "@xyflow/react",
      "lucide-react",
      "elkjs/lib/elk-api.js",
      "lottie-web",
      "zod",
    ],
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
