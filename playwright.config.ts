import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the editor in Chromium. The Electron app is covered separately by
 * apps/desktop/tests/smoke.mjs (`npm run smoke -w @sonobe/desktop`), which isn't part of `npm run e2e` or CI.
 * SONOBE_E2E_PORT picks the dev server port (default 5199), so parallel checkouts don't share a server.
 *
 * Two more projects cover what the dev server can't: "build" makes the editor's production build in a
 * scratch folder (e2e/production.setup.ts), and "production" boots it from file://, as the desktop app
 * does (e2e/production.spec.ts).
 */

const port = Number(process.env.SONOBE_E2E_PORT) || 5199;
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  // A CI runner is several times slower than a laptop and runs the specs side by side, so a spec that leans
  // on timing fails there now and then. On CI a failed test runs again, up to twice, and the report lists it
  // as flaky. Locally a failure stays a failure, so it gets looked at.
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
    launchOptions: { args: ["--mute-audio"] },
  },
  // The first line stays as written: apps/desktop/electron/architecture.test.ts looks for it.
  // prettier-ignore
  projects: [{ name: "chromium", testIgnore: /production\./, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "build", testMatch: /production\.setup\.ts/ },
    {
      name: "production",
      testMatch: /production\.spec\.ts/,
      dependencies: ["build"],
      // Chromium only reads a page's own scripts and styles from file:// with this switch.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: { args: ["--mute-audio", "--allow-file-access-from-files"] } },
    },
  ],
  webServer: {
    command: `npm run dev -w @sonobe/editor -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
