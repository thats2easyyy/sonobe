import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the editor in Chromium. The Electron app is covered separately by
 * apps/desktop/tests/smoke.mjs (`npm run smoke -w @sonobe/desktop`), which isn't part of `npm run e2e` or CI.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5199",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
    launchOptions: { args: ["--mute-audio"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npm run dev -w @sonobe/editor -- --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
