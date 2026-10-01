import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.{ts,tsx}",
      "apps/*/electron/**/*.test.ts",
      "apps/*/player/**/*.test.ts",
      "examples/**/*.test.ts",
      "evals/**/*.test.ts",
    ],
    environment: "node",
    // CI runners are slower than a laptop and uneven: tests that take 2.5 s there have run past 5 s on a busy one.
    testTimeout: process.env.CI ? 30_000 : 5_000,
  },
});
