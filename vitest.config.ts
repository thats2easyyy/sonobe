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
  },
});
