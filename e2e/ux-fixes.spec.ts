import { expect, test } from "@playwright/test";
import { blurFields, collectConsoleProblems, flowNode, hook, modKey, newIds, openEditor, patchIds, runCommand } from "./helpers.ts";

test.describe("patch editor: align keys, publishing ports, and variables", () => {
  test("⌘[ ⌘] ⇧⌘[ ⇧⌘] align left, right, top, and bottom", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const mod = await modKey(page);
    await runCommand(page, "Patches Only");
    await expect(flowNode(page, "tap_photo")).toBeVisible();
    await hook(page, (s) => s.session.selection.getState().select({ patches: ["tap_photo", "like_spring"], layers: [], comments: [] }));
    const pane = page.locator(".sb-pe .react-flow__pane");
    const box = (await pane.boundingBox())!;
    await page.mouse.move(box.x + box.width - 40, box.y + box.height - 40);
    await blurFields(page);

    const positions = () => hook(page, (s) => ["tap_photo", "like_spring"].map((id) => s.doc().components.main!.patches[id]!.ui));
    const undoLabel = () => hook(page, (s) => s.session.document.getState().undoLabel ?? "");
    const undo = () => hook(page, (s) => void s.session.document.getState().undo());
    const before = await positions();

    await page.keyboard.press(`${mod}+BracketLeft`);
    await expect.poll(undoLabel).toContain("items left");
    const left = await positions();
    expect(left[0]!.x).toBe(left[1]!.x);
    await undo();

    await page.keyboard.press(`${mod}+BracketRight`);
    await expect.poll(undoLabel).toContain("items right");
    await undo();

    await page.keyboard.press(`${mod}+Shift+BracketLeft`);
    await expect.poll(undoLabel).toContain("items to top");
    const top = await positions();
    expect(top[0]!.y).toBe(top[1]!.y);
    await undo();

    await page.keyboard.press(`${mod}+Shift+BracketRight`);
    await expect.poll(undoLabel).toContain("items to bottom");
    await undo();

    expect(await positions()).toEqual(before);
    expect(problems).toEqual([]);
  });

  test("⌥P publishes a port inside a component, and the component patch shows it as a property", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    await runCommand(page, "Patches Only");
    expect(await hook(page, (s) => s.apply([{ op: "createComponent", component: "main", name: "Heart Logic", patchIds: ["liked", "like_spring"] }], "Group").ok)).toBe(true);
    await hook(page, (s) => s.session.selection.getState().enterComponent("heart_logic"));

    const bounciness = flowNode(page, "like_spring").locator(".sb-pe-port--in", { hasText: "Bounciness" });
    await expect(bounciness).toBeVisible();
    await blurFields(page);
    await bounciness.hover();
    await page.keyboard.press("Alt+KeyP");
    await expect.poll(() => hook(page, (s) => Object.keys(s.doc().components.heart_logic!.interface.inputs))).toContain("bounciness");

    await hook(page, (s) => {
      const selection = s.session.selection.getState();
      selection.setComponentPath(["main"]);
      const instance = Object.entries(s.doc().components.main!.patches).find(([, p]) => p.component === "heart_logic")![0];
      selection.select({ patches: [instance], layers: [], comments: [] });
    });
    await expect(page.locator(".sb-insp-panel .sb-insp-row__name", { hasText: "Bounciness" })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("W names a broadcaster, renaming it names the variable, and ⇧W reads its value", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    await runCommand(page, "Patches Only");
    const pane = page.locator(".sb-pe .react-flow__pane");
    const box = (await pane.boundingBox())!;

    const before = await patchIds(page);
    await blurFields(page);
    await page.mouse.move(box.x + box.width - 180, box.y + box.height - 140);
    await page.keyboard.press("w");
    await expect.poll(async () => newIds(before, await patchIds(page)).length).toBe(1);
    const [broadcaster] = newIds(before, await patchIds(page));
    expect(await hook(page, (s, id) => s.doc().components.main!.patches[id]!.settings, broadcaster!)).toEqual({ name: "Variable" });

    await page.keyboard.press("Enter");
    const title = page.getByRole("textbox", { name: "Patch name" });
    await expect(title).toBeVisible();
    await title.fill("isLiked");
    await page.keyboard.press("Enter");
    await expect.poll(() => hook(page, (s, id) => s.doc().components.main!.patches[id]!.settings?.name, broadcaster!)).toBe("isLiked");
    expect(await hook(page, (s, id) => s.apply([{ op: "setInput", target: `${id}.value`, value: 7 }], "Set value").ok, broadcaster!)).toBe(true);

    const middle = await patchIds(page);
    await blurFields(page);
    await page.mouse.move(box.x + box.width - 180, box.y + box.height - 300);
    await page.keyboard.press("Shift+W");
    await expect.poll(async () => newIds(middle, await patchIds(page)).length).toBe(1);
    const [receiver] = newIds(middle, await patchIds(page));
    expect(await hook(page, (s, id) => s.doc().components.main!.patches[id]!.settings?.name, receiver!)).toBe("isLiked");
    await expect.poll(() => hook(page, (s, id) => s.getValue(`${id}.output`), receiver!)).toBe(7);
    await expect(flowNode(page, receiver!)).toContainText("isLiked");
    expect(problems).toEqual([]);
  });
});
