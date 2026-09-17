import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** node_modules packages as a path test (either separator). */
const npm = (names: string) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${names})[\\\\/]`);
/** Workspace packages as a path test. */
const workspace = (names: string) => new RegExp(`[\\\\/]packages[\\\\/](?:${names})[\\\\/]`);

/**
 * Editor build. `base: "./"` keeps asset URLs relative so the production build loads
 * from `file://` inside Electron as well as from any static host.
 *
 * Chunks: the entry holds the app shell and panels that paint first. The patch editor (React Flow,
 * d3), the Learn drawer (guides, examples, lessons, patch reference), the welcome screen, the
 * Assistant, and the Connect Claude, Settings, and About dialogs load with dynamic imports. ELK is a
 * classic script asset that loads on the first Tidy Up. Panels on screen at startup reach the patch
 * editor only through `panels/patch-editor/api.ts`, which doesn't import React Flow.
 *
 * Libraries and the Sonobe packages are split into long-lived vendor chunks that load in parallel.
 * The patch catalog (specs, docs, examples as JSON) gets its own chunk: it changes on a different
 * schedule from the evaluators. It still loads at startup, because the session builds the patch
 * registry before first paint; deferring docs needs a docs-free registry from @sonobe/patches.
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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: npm("react|react-dom|scheduler|zustand|use-sync-external-store"), priority: 40 },
            { name: "vendor-zod", test: npm("zod"), priority: 40 },
            { name: "vendor-icons", test: npm("lucide-react"), priority: 40 },
            { name: "vendor-flow", test: npm("@xyflow|d3-[a-z-]+|classcat"), priority: 40 },
            { name: "sonobe-patch-catalog", test: /[\\/]packages[\\/]patches[\\/]catalog[\\/][^\\/]+\.json$/, priority: 35 },
            { name: "sonobe-patch-scripting", test: /[\\/]packages[\\/]patches[\\/]src[\\/]scripting[\\/]/, priority: 35 },
            { name: "sonobe-patches", test: workspace("patches"), priority: 30 },
            { name: "sonobe-core", test: workspace("core"), priority: 30 },
            { name: "sonobe-runtime", test: workspace("engine|renderer"), priority: 30 },
          ],
        },
      },
    },
  },
});
