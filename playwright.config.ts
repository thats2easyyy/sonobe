import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the editor in Chromium. The Electron app is covered separately by
 * apps/desktop/tests/smoke.mjs (`npm run smoke -w @sonobe/desktop`), which isn't part of `npm run e2e` or CI.
 * SONOBE_E2E_PORT picks the dev server port (default 5199), so parallel checkouts don't share a server.
 */

const port = Number(process.env.SONOBE_E2E_PORT) || 5199;
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
    launchOptions: { args: ["--mute-audio"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npm run dev -w @sonobe/editor -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
