import { expect, test } from "@playwright/test";
import { blurFields, collectConsoleProblems, hook, modKey, openEditor, screenshot } from "./helpers.ts";

test.describe("welcome screen", () => {
  test("shows on first launch and opens a template", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page, { welcome: true });

    const welcome = page.getByRole("dialog", { name: "Welcome to Sonobe" });
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole("heading", { name: "New blank prototype" })).toBeVisible();
    await expect(welcome.locator(".sb-welcome__stop")).toHaveCount(5);
    const tapToGrow = welcome.locator(".sb-template").filter({ hasText: "Tap to Grow" });
    await expect(tapToGrow).toBeVisible();
    await expect(welcome.locator(".sb-template img").first()).toBeVisible();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".sb-template img")].slice(0, 6).every((img) => img.complete && img.naturalWidth > 0));
    await screenshot(page, "welcome-01-first-launch");

    await tapToGrow.click();
    await expect(welcome).toBeHidden();
    await expect.poll(() => hook(page, (s) => s.doc().project.name)).toBe("Tap to Grow");
    await expect(page.getByRole("button", { name: /Tap to Grow/ })).toBeVisible();

    // It was seen, so a reload goes straight to the editor.
    await page.reload();
    await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3);
    await page.waitForTimeout(400);
    await expect(page.getByRole("dialog", { name: "Welcome to Sonobe" })).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("File → New offers a blank prototype with a device", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const mod = await modKey(page);

    await blurFields(page);
    await page.keyboard.press(`${mod}+n`);
    const welcome = page.getByRole("dialog", { name: "Start something new" });
    await expect(welcome).toBeVisible();
    await welcome.getByLabel(/^Device for the new prototype/).click();
    await page.getByRole("combobox", { name: /Search Device for the new prototype/ }).fill("iPhone SE");
    await page.keyboard.press("Enter");
    await expect(welcome.getByLabel(/^Device for the new prototype/)).toContainText("iPhone SE");
    await screenshot(page, "welcome-02-new-blank");
    await welcome.getByRole("button", { name: "Create" }).click();

    await expect(welcome).toBeHidden();
    await expect.poll(() => hook(page, (s) => s.doc().project.device.preset)).toBe("iphone-se");
    expect(await hook(page, (s) => Object.keys(s.doc().components[s.doc().project.root]!.patches).length)).toBe(0);
    expect(await hook(page, (s) => s.doc().components[s.doc().project.root]!.layers.length)).toBe(0);
    expect(problems).toEqual([]);
  });

  test("keeps unsaved work through a reload, and brings it back or discards it from the welcome screen", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    // The unsaved-changes warning on reload: go ahead, the draft has the work.
    page.on("dialog", (dialog) => void dialog.accept());
    await openEditor(page);
    const mod = await modKey(page);
    await blurFields(page);
    await page.keyboard.press(`${mod}+n`);
    const start = page.getByRole("dialog", { name: "Start something new" });
    await start.getByRole("button", { name: "Create" }).click();
    await expect(start).toBeHidden();
    await hook(page, (s) => s.session.document.getState().apply([{ op: "addLayer", layer: { id: "hero", type: "rectangle", name: "Hero Card" } }], { label: "Add Hero Card" }));
    await expect.poll(() => hook(page, (s) => s.session.drafts?.current()?.id ?? null)).not.toBeNull();

    // A reload (a crash, a closed tab) leaves the draft; the welcome screen offers it at launch.
    await page.reload();
    await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3);
    const welcome = page.getByRole("dialog", { name: "Welcome to Sonobe" });
    await expect(welcome).toBeVisible();
    const recovered = welcome.getByRole("region", { name: "Recovered" });
    const row = recovered.getByRole("listitem").filter({ hasText: "Untitled" });
    await expect(row).toContainText(/Not saved · (just now|1 min ago) · 1 layer/);
    await page.waitForTimeout(250);
    await screenshot(page, "welcome-03-recovered");
    await row.getByRole("button", { name: "Open Untitled" }).click();
    await expect(welcome).toBeHidden();
    await expect(page.getByText("Recovered “Untitled”")).toBeVisible();
    expect(await hook(page, (s) => s.doc().components[s.doc().project.root]!.layers.map((l) => l.name))).toEqual(["Hero Card"]);
    expect(await hook(page, (s) => ({ dirty: s.session.document.getState().dirty, path: s.session.document.getState().projectPath }))).toEqual({ dirty: true, path: null });

    // Still unsaved, so it's kept again; this time discard it.
    await page.reload();
    await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3);
    await expect(welcome).toBeVisible();
    await welcome.getByRole("button", { name: "Discard Untitled" }).click();
    const confirm = page.getByRole("dialog", { name: "Discard “Untitled”?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Discard" }).click();
    await expect(welcome.getByRole("region", { name: "Recovered" })).toHaveCount(0);
    expect(await hook(page, (s) => s.session.recoverableDrafts().then((list) => list.length))).toBe(0);
    expect(problems).toEqual([]);
  });

  test("starts a lesson from the learning path", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const mod = await modKey(page);
    await blurFields(page);
    await page.keyboard.press(`${mod}+n`);
    const welcome = page.getByRole("dialog", { name: "Start something new" });
    await welcome.locator(".sb-welcome__stop-button").filter({ hasText: "Spring feel" }).click();
    await expect(welcome).toBeHidden();
    const learn = page.getByRole("complementary", { name: "Learn" });
    await expect(learn.getByRole("heading", { name: "Spring feel" })).toBeVisible();
    await expect(learn.getByRole("button", { name: "Start lesson" })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
