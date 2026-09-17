import { expect, test } from "@playwright/test";
import { blurFields, collectConsoleProblems, hook, modKey, openEditor, runCommand, screenshot } from "./helpers.ts";

test.describe("command palette and app commands", () => {
  test("lists categories in menu order, then panels", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const mod = await modKey(page);
    await blurFields(page);
    await page.keyboard.press(`${mod}+k`);
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    const groups = await palette.locator(".sb-searchlist__group").allTextContents();
    const order = ["File", "Edit", "View", "Layer", "Prototype", "Help"];
    const positions = order.map((g) => groups.indexOf(g));
    expect(positions.every((p) => p >= 0), `groups: ${groups.join(", ")}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const panel of ["Viewer", "Canvas", "Patches"]) {
      const index = groups.indexOf(panel);
      if (index >= 0) expect(index, panel).toBeGreaterThan(groups.indexOf("Help"));
    }
    expect(groups[0]).toBe("File");
    await screenshot(page, "app-15-palette-order");
    await page.keyboard.press("Escape");
    expect(problems).toEqual([]);
  });

  test("Insert Layer, Use as Mask, and Rename", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);

    // Insert Layer picks a type and selects the new layer.
    await runCommand(page, "Insert Layer");
    const picker = page.getByRole("dialog", { name: "Insert Layer" });
    await expect(picker).toBeVisible();
    await page.keyboard.type("Oval");
    await screenshot(page, "app-14-insert-layer");
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();
    await expect.poll(() => hook(page, (s) => s.selection().layers.length)).toBe(1);
    const inserted = await hook(page, (s) => s.selection().layers[0]!);
    expect(await hook(page, (s, id) => s.doc().components.main!.layers.find((l) => l.id === id)?.type, inserted)).toBe("oval");

    // Use as Mask turns clipping off and on for the Sun's parent group, Photo.
    const photoClip = () => hook(page, (s) => (s.doc().components.main!.layers.find((l) => l.id === "card")!.children!.find((l) => l.id === "photo")!.props.clip as boolean | undefined) ?? false);
    expect(await photoClip()).toBe(true);
    await hook(page, (s) => s.session.selection.getState().select({ layers: ["sun"] }));
    await runCommand(page, "Use as Mask");
    await expect.poll(photoClip).toBe(false);
    await runCommand(page, "Use as Mask");
    await expect.poll(photoClip).toBe(true);

    // Rename (Shift+Return) through a dialog.
    await hook(page, (s) => s.session.selection.getState().select({ layers: ["title"] }));
    await blurFields(page);
    await page.keyboard.press("Shift+Enter");
    const rename = page.getByRole("dialog", { name: "Rename layer" });
    await expect(rename).toBeVisible();
    await rename.getByRole("textbox", { name: "Name" }).fill("Headline");
    await page.keyboard.press("Enter");
    await expect(rename).toBeHidden();
    await expect.poll(() => hook(page, (s) => s.doc().components.main!.layers.find((l) => l.id === "title")?.name)).toBe("Headline");
    expect(problems).toEqual([]);
  });
});
