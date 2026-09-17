import { expect, test } from "@playwright/test";
import { collectConsoleProblems, hook, openEditor, screenshot } from "./helpers.ts";

test.describe("editor app", () => {
  test("loads the demo with no console errors", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);

    await expect(page.getByRole("button", { name: /Photo Zoom/ })).toBeVisible();
    const layers = page.locator("#sb-layers");
    for (const name of ["Status Bar", "Title", "Event Card", "Like Button", "Next Card", "Background"]) {
      await expect(layers.getByText(name, { exact: true }).first()).toBeVisible();
    }
    expect(await hook(page, (s) => s.playing())).toBe(true);

    // The console starts as a tab strip; the patch editor loads on its own.
    await expect(page.locator("#sb-hud")).toHaveAttribute("data-collapsed");
    await expect(page.locator(".sb-pe .react-flow__node").first()).toBeVisible();
    await page.waitForTimeout(600);
    await screenshot(page, "app-01-default");
    expect(problems).toEqual([]);
  });

  test("the console opens on the first error", async ({ page }) => {
    await openEditor(page);
    await expect(page.locator("#sb-hud")).toHaveAttribute("data-collapsed");
    await hook(page, (s) => {
      s.session.console.getState().push("error", ["Something went wrong in a patch"]);
      s.session.console.getState().flush();
    });
    await expect(page.locator("#sb-hud")).not.toHaveAttribute("data-collapsed");
    await expect(page.locator("#sb-hud").getByText("Something went wrong in a patch")).toBeVisible();
    expect(await hook(page, (s) => s.layout().hudTab)).toBe("console");
  });

  test("toolbar drives the runtime, device, view mode, and theme", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const toolbar = page.locator(".sb-toolbar");

    await toolbar.getByRole("button", { name: "Pause prototype" }).click();
    await expect.poll(() => hook(page, (s) => s.playing())).toBe(false);
    const pausedAt = await hook(page, (s) => s.frame());
    await page.waitForTimeout(200);
    expect(await hook(page, (s) => s.frame())).toBe(pausedAt);
    await toolbar.getByRole("button", { name: "Play prototype" }).click();
    await expect.poll(() => hook(page, (s) => s.playing())).toBe(true);
    await page.waitForFunction((at) => (window.__sonobe?.frame() ?? 0) > at + 40, pausedAt);
    const beforeRestart = await hook(page, (s) => s.frame());
    await toolbar.getByRole("button", { name: "Restart prototype" }).click();
    await expect.poll(() => hook(page, (s) => s.frame())).toBeLessThan(beforeRestart);

    await toolbar.getByLabel("Device: iPhone 17 Pro").click();
    await page.getByRole("combobox", { name: "Search Device" }).fill("iPhone SE");
    await page.keyboard.press("Enter");
    await expect.poll(() => hook(page, (s) => s.doc().project.device.preset)).toBe("iphone-se");
    await expect(toolbar.getByLabel("Device: iPhone SE")).toBeVisible();

    await toolbar.getByRole("radio", { name: "Patches only" }).click();
    await expect(page.locator(".sb-shell__canvas")).toHaveCount(0);
    await expect(page.locator(".sb-shell__patches .sb-pe")).toBeVisible();
    await toolbar.getByRole("radio", { name: "Canvas only" }).click();
    await expect(page.locator(".sb-shell__patches")).toHaveCount(0);
    await toolbar.getByRole("radio", { name: "Canvas and patches" }).click();
    await toolbar.getByRole("button", { name: "Put patches beside the canvas" }).click();
    await expect(page.locator(".sb-shell__center")).toHaveAttribute("data-direction", "columns");

    await toolbar.getByRole("button", { name: "Use light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.mouse.move(720, 860);
    await page.waitForTimeout(400);
    await screenshot(page, "app-11-light-columns");
    expect(problems).toEqual([]);
  });
});
