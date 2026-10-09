/**
 * The editor's production build, loaded from file:// as the desktop app loads it. The other specs run
 * on Vite's dev server, which has no chunks, no minified React and no relative asset URLs, so this is
 * where a broken chunk boundary or a build-only failure shows up. Built by e2e/production.setup.ts.
 */

import { expect, test, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { collectConsoleProblems, hook, openEditor, PRODUCTION_BUILD, skipWelcome, waitForPrototype } from "./helpers.ts";

const INDEX = join(PRODUCTION_BUILD, "index.html");
const EDITOR_URL = `${pathToFileURL(INDEX).href}?sonobeTest`;
/** Code that loads on demand: each stays a file of its own, outside the startup scripts index.html names. */
const ON_DEMAND = ["PatchEditor", "vendor-flow", "WelcomeScreen", "SettingsDialog", "LearnDrawer"];

/** Stop the page's timers, animation frames and performance.now() before its first script runs (see e2e/boot.spec.ts). */
async function stopClockAtLoad(page: Page): Promise<void> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
}

test.describe("the production build", () => {
  test.beforeAll(() => {
    if (!existsSync(INDEX)) throw new Error("The production build isn't there. Run `npx playwright test --project=production` without `--no-deps`, so the build project runs first.");
  });

  test("boots from file:// with no errors and nothing from the network", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const remote: string[] = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) remote.push(request.url());
    });
    await openEditor(page, { path: EDITOR_URL });

    await expect(page.locator(".sb-pe .react-flow__node").first()).toBeVisible();
    await expect(page.locator("#sb-layers .sb-tree__row").first()).toBeVisible();
    expect(problems).toEqual([]);
    expect(remote).toEqual([]);
  });

  test("shows the patch editor without waiting on a timer", async ({ page }) => {
    await stopClockAtLoad(page);
    await skipWelcome(page);
    await page.goto(EDITOR_URL);

    await expect(page.locator(".sb-pe")).toBeAttached();
    await expect(page.locator(".sb-app-loading")).toHaveCount(0);
  });

  test("shows the welcome screen on a first launch without waiting on a timer", async ({ page }) => {
    await stopClockAtLoad(page);
    await page.goto(EDITOR_URL);

    await expect(page.locator(".sb-welcome[role=dialog]")).toBeAttached();
  });

  test("shows the recovery screen, not a blank window, when the editor can't draw", async ({ page }) => {
    await openEditor(page, { path: EDITOR_URL });
    await hook(page, (s) => s.failRender("Sonobe"));

    // The production React reports a caught error through the root's handler alone, with no component names to lean on.
    const recovery = page.locator(".sb-recovery");
    await expect(recovery.getByRole("heading", { name: "Sonobe hit a problem" })).toBeVisible();
    await expect(recovery.locator(".sb-recovery__draft")).toHaveText("There were no unsaved changes.");
    await expect(recovery.getByRole("button", { name: "Reload Sonobe" })).toBeFocused();
    await recovery.getByText("Error details").click();
    await expect(recovery.locator("pre")).toContainText("Error: Sonobe was asked to fail (window.__sonobe.failRender).");

    await recovery.getByRole("button", { name: "Reload Sonobe" }).click();
    await waitForPrototype(page);
    await expect(page.locator(".sb-pe .react-flow__node").first()).toBeVisible();
    await expect(page.locator(".sb-recovery")).toHaveCount(0);
  });

  test("keeps the code that loads on demand in files of its own", () => {
    const assets = readdirSync(join(PRODUCTION_BUILD, "assets"));
    const html = readFileSync(INDEX, "utf8");
    for (const name of ON_DEMAND) {
      expect(assets.filter((file) => file.startsWith(`${name}-`) && file.endsWith(".js")), `a ${name} chunk`).toHaveLength(1);
      expect(html, `${name} in index.html`).not.toContain(`/${name}-`);
    }
  });
});
