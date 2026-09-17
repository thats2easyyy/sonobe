import { expect, test } from "@playwright/test";
import { blurFields, centerOf, collectConsoleProblems, connectNewPatch, dragCable, fitPatches, flowNode, handle, hook, modKey, newIds, openEditor, patchIds, patchesOfType, runCommand, screenshot, storedInput, touchLayer } from "./helpers.ts";

test.describe("building an interaction in the UI", () => {
  test("inserts a patch from the picker", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const before = await patchIds(page);

    await page.locator(".sb-pe").getByRole("button", { name: "Insert patch" }).click();
    const picker = page.getByRole("dialog", { name: "Insert patch" });
    await expect(picker).toBeVisible();
    await page.keyboard.type("counter");
    await expect(picker.getByText("Counter", { exact: true }).first()).toBeVisible();
    await screenshot(page, "app-02-patch-picker");
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();

    await expect.poll(async () => newIds(before, await patchIds(page)).length).toBe(1);
    const [counter] = newIds(before, await patchIds(page));
    expect(await patchesOfType(page, "counter")).toEqual([counter]);
    await expect(flowNode(page, counter!)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("Interaction → Switch → Pop Animation → Transition → @photo.scale, then a tap animates it", async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const mod = await modKey(page);
    await runCommand(page, "Patches Only");

    // Touch on the Photo layer row adds a pre-wired Interaction.
    const interaction = await touchLayer(page, "Photo");
    expect(await storedInput(page, `${interaction}.layer`)).toEqual({ layer: "photo" });

    // Link-drag search builds the rest of the chain.
    const toggle = await connectNewPatch(page, interaction, "tap", "Switch", "switch");
    const toggleInputs = await hook(page, (s, id) => s.doc().components[s.doc().project.root]!.patches[id]!.inputs, toggle);
    expect(Object.values(toggleInputs)).toContainEqual({ link: `${interaction}.tap` });

    const spring = await connectNewPatch(page, toggle, "on", "Pop Animation", "popAnimation");
    expect(await storedInput(page, `${spring}.number`)).toBe(`${toggle}.on`);

    const transition = await connectNewPatch(page, spring, "output", "Transition", "transition");
    expect(await storedInput(page, `${transition}.progress`)).toBe(`${spring}.output`);

    // Drop the Transition's output onto the Photo layer's Scale input (it replaces the demo's driver).
    expect(await storedInput(page, "@photo.scale")).toBe("photo_scale.output");
    await fitPatches(page);
    await dragCable(page, handle(page, transition, "out:output"), handle(page, "@photo", "in:scale"));
    await expect.poll(() => storedInput(page, "@photo.scale")).toBe(`${transition}.output`);

    // Undo and redo the connection from the keyboard.
    await blurFields(page);
    await page.keyboard.press(`${mod}+z`);
    await expect.poll(() => storedInput(page, "@photo.scale")).toBe("photo_scale.output");
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(() => storedInput(page, "@photo.scale")).toBe(`${transition}.output`);

    // Start at 1 and grow to 1.4 through the inspector.
    await flowNode(page, transition).click({ position: { x: 48, y: 10 } });
    await expect.poll(() => hook(page, (s) => s.selection().patches)).toEqual([transition]);
    const inspector = page.locator("#sb-inspector");
    for (const [name, value] of [["Start", "1"], ["End", "1.4"]] as const) {
      const field = inspector.getByRole("spinbutton", { name, exact: true });
      await field.click();
      await field.fill(value);
      await field.press("Enter");
    }
    await expect.poll(() => storedInput(page, `${transition}.start`)).toBe(1);
    await expect.poll(() => storedInput(page, `${transition}.end`)).toBe(1.4);
    await blurFields(page);
    await screenshot(page, "app-03-interaction-wired");

    // Tap the photo in the viewer: scale springs from 1 toward 1.4 over many frames.
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number)).toBeCloseTo(1, 3);
    // The device content layer captures input for the prototype, so tap at the photo's position on screen.
    const photoCenter = await centerOf(page.locator('#sb-viewer [data-layer="photo"]').first());
    await page.mouse.click(photoCenter.x, photoCenter.y);
    const samples: { frame: number; scale: number }[] = [];
    for (let i = 0; i < 24; i++) {
      samples.push(await hook(page, (s) => ({ frame: s.frame(), scale: s.getValue("@photo.scale") as number })));
      if (i === 6) await screenshot(page, "app-04-tap-animating");
      await page.waitForTimeout(40);
    }
    const frames = new Set(samples.map((s) => s.frame));
    const distinct = new Set(samples.map((s) => s.scale.toFixed(4)));
    expect(frames.size).toBeGreaterThan(8);
    expect(distinct.size).toBeGreaterThan(4);
    expect(samples.some((s) => s.scale > 1.01 && s.scale < 1.39)).toBe(true);
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number), { timeout: 5000 }).toBeGreaterThan(1.38);
    expect(problems).toEqual([]);
  });
});
