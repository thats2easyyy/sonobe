import { expect, test } from "@playwright/test";
import { blurFields, collectConsoleProblems, hook, modKey, openEditor, screenshot } from "./helpers.ts";

test.describe("documents, palette, and help", () => {
  test("renames, saves, and opens a prototype in browser storage", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const mod = await modKey(page);

    // Rename through the title menu.
    await page.getByRole("button", { name: /Photo Zoom/ }).click();
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    const nameInput = page.getByRole("textbox", { name: "Prototype name" });
    await nameInput.fill("Checkout Flow");
    await nameInput.press("Enter");
    await expect(page.getByRole("button", { name: /Checkout Flow/ })).toBeVisible();
    expect(await hook(page, (s) => s.doc().project.name)).toBe("Checkout Flow");
    expect(await hook(page, (s) => s.session.document.getState().dirty)).toBe(true);
    await expect(page.getByRole("img", { name: "Unsaved changes" })).toBeVisible();

    // Save: the browser host asks for a name in an app dialog.
    await blurFields(page);
    await page.keyboard.press(`${mod}+s`);
    const saveDialog = page.getByRole("dialog", { name: "Save prototype" });
    await expect(saveDialog).toBeVisible();
    await expect(saveDialog.getByRole("textbox", { name: "Prototype name" })).toHaveValue("Checkout Flow");
    await screenshot(page, "app-08-save-dialog");
    await saveDialog.getByRole("button", { name: "Save" }).click();
    await expect(saveDialog).toBeHidden();
    await expect.poll(() => hook(page, (s) => s.session.document.getState().projectPath)).toBe("browser:Checkout Flow");
    expect(await hook(page, (s) => s.session.document.getState().dirty)).toBe(false);
    await expect(page.getByRole("img", { name: "Unsaved changes" })).toBeHidden();

    // Reload the page: the demo comes back until a project is opened.
    await page.reload();
    await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3);
    expect(await hook(page, (s) => s.doc().project.name)).toBe("Photo Zoom");

    // Make an unsaved change, then Open: first the unsaved-changes prompt, then the picker.
    await page.getByRole("button", { name: /Photo Zoom/ }).dblclick();
    await page.getByRole("textbox", { name: "Prototype name" }).fill("Scratch");
    await page.keyboard.press("Enter");
    await blurFields(page);
    await page.keyboard.press(`${mod}+o`);
    const discard = page.getByRole("dialog", { name: /Save changes to “Scratch”/ });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Don’t Save" }).click();
    const openDialog = page.getByRole("dialog", { name: "Open prototype" });
    await expect(openDialog).toBeVisible();
    await expect(openDialog.getByText("Checkout Flow")).toBeVisible();
    await screenshot(page, "app-09-open-dialog");
    await openDialog.getByText("Checkout Flow").click();
    await expect(openDialog).toBeHidden();
    await expect(page.getByRole("button", { name: /Checkout Flow/ })).toBeVisible();
    await expect.poll(() => hook(page, (s) => s.session.document.getState().projectPath)).toBe("browser:Checkout Flow");
    expect(await hook(page, (s) => Object.keys(s.doc().components[s.doc().project.root]!.patches).length)).toBe(10);
    expect(await hook(page, (s) => s.session.document.getState().dirty)).toBe(false);
    expect(problems).toEqual([]);
  });

  test("another tab saving over the project shows the external change banner", async ({ context }) => {
    const mine = await context.newPage();
    const theirs = await context.newPage();
    const problems = [...collectConsoleProblems(mine), ...collectConsoleProblems(theirs)];
    await openEditor(theirs);
    await openEditor(mine);
    const mod = await modKey(theirs);

    // Their tab saves the prototype as "Shared".
    await blurFields(theirs);
    await theirs.keyboard.press(`${mod}+s`);
    const saveDialog = theirs.getByRole("dialog", { name: "Save prototype" });
    await saveDialog.getByRole("textbox", { name: "Prototype name" }).fill("Shared");
    await saveDialog.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => hook(theirs, (s) => s.session.document.getState().projectPath)).toBe("browser:Shared");

    // My tab opens it and makes an unsaved edit.
    await blurFields(mine);
    await mine.keyboard.press(`${mod}+o`);
    await mine.getByRole("dialog", { name: "Open prototype" }).getByText("Shared").click();
    await expect.poll(() => hook(mine, (s) => s.session.document.getState().projectPath)).toBe("browser:Shared");
    await mine.getByRole("button", { name: /Photo Zoom/ }).dblclick();
    await mine.getByRole("textbox", { name: "Prototype name" }).fill("My Edit");
    await mine.keyboard.press("Enter");

    // Their tab renames and saves over it.
    await theirs.getByRole("button", { name: /Photo Zoom/ }).dblclick();
    await theirs.getByRole("textbox", { name: "Prototype name" }).fill("Their Edit");
    await theirs.keyboard.press("Enter");
    await blurFields(theirs);
    await theirs.keyboard.press(`${mod}+s`);
    await expect.poll(() => hook(theirs, (s) => s.session.document.getState().dirty)).toBe(false);

    const banner = mine.getByRole("status").filter({ hasText: "changed outside Sonobe" });
    await expect(banner).toBeVisible();
    await screenshot(mine, "app-10-external-change");
    await banner.getByRole("button", { name: "Reload" }).click();
    await expect(banner).toBeHidden();
    await expect(mine.getByRole("button", { name: /Their Edit/ })).toBeVisible();
    expect(await hook(mine, (s) => s.session.document.getState().dirty)).toBe(false);
    expect(problems).toEqual([]);
  });

  test("command palette, Learn drawer, and Connect Claude", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const mod = await modKey(page);

    await page.keyboard.press(`${mod}+k`);
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").or(palette.getByRole("textbox")).first().fill("console");
    await expect(palette.getByText(/Show or Hide Console/).first()).toBeVisible();
    await palette.getByRole("combobox").or(palette.getByRole("textbox")).first().fill("");
    await screenshot(page, "app-05-command-palette");
    await palette.getByRole("combobox").or(palette.getByRole("textbox")).first().fill("patch reference");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    const learn = page.getByRole("complementary", { name: "Learn" });
    await expect(learn).toBeVisible();
    await page.waitForTimeout(300);
    await screenshot(page, "app-06-learn");
    await page.getByRole("button", { name: "Learn", exact: true }).click();
    await expect(learn).toBeHidden();

    await page.getByRole("button", { name: "Connect Claude" }).click();
    const connect = page.locator(".sb-connect-dialog");
    await expect(connect).toBeVisible();
    await page.waitForTimeout(300);
    await screenshot(page, "app-07-connect-claude");
    await page.keyboard.press("Escape");
    await expect(connect).toBeHidden();
    expect(problems).toEqual([]);
  });
});
