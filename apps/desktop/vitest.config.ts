import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs only this app's colocated electron/ and player/ suites (`npm test -w @sonobe/desktop`).
// The root vitest.config.ts includes apps/*/electron and apps/*/player too, so `npx vitest run apps/desktop` runs them as well.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["electron/**/*.test.ts", "player/**/*.test.ts"],
    environment: "node",
  },
});
