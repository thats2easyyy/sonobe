import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs only this app's colocated electron/**/*.test.ts suites (`npm test -w @sonobe/desktop`).
// The root vitest.config.ts includes apps/*/electron too, so `npx vitest run apps/desktop` runs them as well.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["electron/**/*.test.ts"],
    environment: "node",
  },
});
