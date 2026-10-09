/**
 * Boot and first opens: the parts of the editor that load on demand (the patch editor, the welcome
 * screen, the dialogs) show as soon as their code is in, and one loading doesn't hide another.
 *
 * React holds content behind a Suspense fallback until 300 ms after the fallback showed. These tests
 * stop the page's clock, so no timer can run: a surface that still shows up didn't wait on one. No
 * test here measures time.
 */

import { expect, test, type Page } from "@playwright/test";
import { installFakeAssistant } from "./fakeAssistant.ts";
import { collectConsoleProblems, modKey, openEditor, skipWelcome } from "./helpers.ts";

/** Far enough ahead that every timer the page set so far is due. */
const LATER = 60 * 60 * 1000;

/** Stop the page's timers, animation frames and performance.now() before its first script runs. */
async function stopClockAtLoad(page: Page): Promise<void> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
}

test.describe("boot", () => {
  test("the patch editor shows without waiting on a timer", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await stopClockAtLoad(page);
    await skipWelcome(page);
    await page.goto("/");

    await expect(page.locator(".sb-pe")).toBeAttached();
    await expect(page.locator(".sb-app-loading")).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test("the welcome screen shows on a first launch without waiting on a timer", async ({ page }) => {
    await stopClockAtLoad(page);
    await page.goto("/");

    await expect(page.locator(".sb-welcome[role=dialog]")).toBeAttached();
    await expect(page.locator(".sb-pe")).toBeAttached();
  });

  test("Settings opens for the first time without waiting on a timer, and the open Assistant stays on screen", async ({ page }) => {
    await page.clock.install();
    await installFakeAssistant(page, { html: "" });
    await openEditor(page);
    const mod = await modKey(page);
    await page.keyboard.press(`${mod}+6`);
    const sheet = page.locator(".sb-assistant-sheet");
    await expect(sheet).toBeVisible();

    // From here no timer runs. Under a boundary shared with Settings the sheet would be hidden until one did.
    await page.clock.pauseAt(Date.now() + LATER);
    await page.keyboard.press(`${mod}+,`);
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeAttached();
    await expect(sheet).toBeVisible();
  });
});
