import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs the colocated electron/**/*.test.ts suites; the root config only scans apps/<app>/src.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["electron/**/*.test.ts"],
    environment: "node",
  },
});
