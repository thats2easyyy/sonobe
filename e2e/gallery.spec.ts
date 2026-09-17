import { expect, test } from "@playwright/test";
import { collectConsoleProblems, skipWelcome } from "./helpers.ts";

test("the widget gallery route still loads", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await skipWelcome(page);
  await page.goto("/#gallery");
  await expect(page.locator(".sb-gallery").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__sonobe === undefined)).toBe(true);

  // Leaving the gallery mounts the editor on the demo.
  await page.evaluate(() => {
    window.location.hash = "";
  });
  await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3, undefined, { timeout: 30_000 });
  await expect(page.locator("#sb-layers").getByText("Event Card", { exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});
