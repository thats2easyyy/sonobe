import { expect, test } from "@playwright/test";
import { collectConsoleProblems, openEditor, runCommand, screenshot, waitForPrototype } from "./helpers.ts";

test.describe("settings and about", () => {
  test("changes motion and Claude's permissions, and they persist", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);

    await runCommand(page, "Settings");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();

    await settings.getByRole("radio", { name: "Reduce" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    await settings.getByRole("radio", { name: "Read only" }).click();
    await expect(settings.getByText("can't change, save, or open prototypes")).toBeVisible();
    await settings.getByRole("button", { name: /^Default device:/ }).click();
    const devices = page.getByRole("listbox");
    await expect(devices).toBeVisible();
    // A menu opened from a dialog paints above it: the point at its centre belongs to the menu, not the dialog behind.
    await expect(devices).toBeInViewport();
    await expect(async () => {
      const box = (await devices.boundingBox())!;
      const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".sb-select-popover"), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      expect(onTop).toBe(true);
    }).toPass();
    await page.getByRole("combobox", { name: /Search Default device/ }).fill("iPad");
    await page.getByRole("option", { name: /iPad/ }).first().click();
    await expect(devices).toBeHidden();
    await expect(settings.getByText("No trusted prototypes yet.")).toBeVisible();
    await page.waitForTimeout(250);
    await screenshot(page, "app-12-settings");

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sonobe.settings.v1") ?? "{}") as Record<string, unknown>);
    expect(stored).toMatchObject({ motion: "reduce", agentPermission: "readOnly" });
    expect(String(stored.defaultDevice)).toMatch(/^ipad/);

    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();

    await page.reload();
    await waitForPrototype(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    expect(problems).toEqual([]);
  });

  test("About lists the open-source software Sonobe is built with", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    await runCommand(page, "About Sonobe");
    const about = page.getByRole("dialog", { name: "Sonobe" });
    await expect(about).toBeVisible();
    for (const name of ["React Flow (@xyflow/react)", "elkjs", "lottie-web", "Zod", "Lucide"]) await expect(about.getByRole("link", { name })).toBeVisible();
    await expect(about.getByRole("button", { name: "Report an Issue…" })).toBeVisible();
    await screenshot(page, "app-13-about");
    await page.keyboard.press("Escape");
    await expect(about).toBeHidden();
    expect(problems).toEqual([]);
  });
});
