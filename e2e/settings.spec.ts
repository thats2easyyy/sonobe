import { expect, test } from "@playwright/test";
import { collectConsoleProblems, openEditor, runCommand, screenshot } from "./helpers.ts";

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
    await page.getByRole("combobox", { name: /Search Default device/ }).fill("iPad");
    await page.keyboard.press("Enter");
    await expect(settings.getByText("No trusted projects yet.")).toBeVisible();
    await page.waitForTimeout(250);
    await screenshot(page, "app-12-settings");

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sonobe.settings.v1") ?? "{}") as Record<string, unknown>);
    expect(stored).toMatchObject({ motion: "reduce", agentPermission: "readOnly" });
    expect(String(stored.defaultDevice)).toMatch(/^ipad/);

    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();

    await page.reload();
    await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3);
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
