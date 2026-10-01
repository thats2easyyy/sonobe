import { expect, test } from "@playwright/test";
import { blurFields, centerOf, collectConsoleProblems, collectUiWarnings, connectNewPatch, dragCable, fitPatches, flowNode, handle, hook, modKey, openEditor, screenshot, storedInput, touchLayer } from "./helpers.ts";

test.describe("interactive lessons", () => {
  test("completes lesson 1, Your first prototype, through the UI", async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    const problems = collectConsoleProblems(page);
    const warnings = await collectUiWarnings(page);
    await openEditor(page);
    const inspector = page.locator("#sb-inspector");
    const center = page.locator(".sb-shell__center");
    const main = page.locator(".sb-shell__main");
    await expect(inspector).toBeVisible();
    await expect(center).toHaveAttribute("data-mode", "split");

    // Learn opens on the lessons.
    await page.getByRole("button", { name: "Learn", exact: true }).click();
    const learn = page.getByRole("complementary", { name: "Learn" });
    await expect(learn).toBeVisible();
    await expect(learn.getByRole("radio", { name: "Lessons" })).toBeChecked();
    await learn.locator(".sb-lessoncard").filter({ hasText: "Your first prototype" }).click();
    await expect(learn.getByRole("heading", { name: "Your first prototype" })).toBeVisible();
    await learn.getByRole("button", { name: "Start lesson" }).click();

    // The practice prototype replaces the demo. The drawer docks, the Inspector folds away, and the
    // patch editor gets the whole center.
    await expect.poll(() => hook(page, (s) => s.doc().project.name)).toBe("Your First Prototype");
    await expect(main).toHaveAttribute("data-drawer-docked");
    await expect(inspector).toHaveCount(0);
    await expect(center).toHaveAttribute("data-mode", "patches");
    const step = (title: string) => learn.locator('.sb-lesson__step[aria-current="step"]').filter({ hasText: title });
    await expect(step("Make the photo listen for taps")).toBeVisible();
    await expect(page.locator("[data-lesson-spotlight]")).toBeVisible();
    // The starter's Photo Scale patch and its Photo target both fit in the patch editor.
    await expect(flowNode(page, "photo_scale")).toBeInViewport();
    await expect(flowNode(page, "@photo")).toBeInViewport({ ratio: 1 });
    await page.waitForTimeout(300);
    await screenshot(page, "lesson-01-first-step");
    await screenshot(page, "stage4-lesson-01-layout");

    // 1. Touch → Tap on Photo.
    const interaction = await touchLayer(page, "Photo");
    expect(await storedInput(page, `${interaction}.layer`)).toEqual({ layer: "photo" });
    await expect(step("Remember the tap with a Switch")).toBeVisible();

    // 2. Tap → new Switch (Flip).
    const toggle = await connectNewPatch(page, interaction, "tap", "Switch", "switch");
    expect(await storedInput(page, `${toggle}.flip`)).toBe(`${interaction}.tap`);
    await expect(step("Animate it with a spring")).toBeVisible();

    // 3. On → new Pop Animation.
    const spring = await connectNewPatch(page, toggle, "on", "Pop Animation", "popAnimation");
    expect(await storedInput(page, `${spring}.number`)).toBe(`${toggle}.on`);
    await expect(step("Drive the photo's scale")).toBeVisible();
    await screenshot(page, "lesson-02-in-progress");

    // 4. Pop Animation output → Photo Scale's Progress.
    await fitPatches(page);
    await dragCable(page, handle(page, spring, "out:output"), handle(page, "photo_scale", "in:progress"));
    await expect.poll(() => storedInput(page, "photo_scale.progress")).toBe(`${spring}.output`);
    await expect(step("Choose how big it grows")).toBeVisible();

    // 5. Select Photo Scale. The step points at the Inspector, so it opens for this step.
    await flowNode(page, "photo_scale").click({ position: { x: 48, y: 10 } });
    await expect.poll(() => hook(page, (s) => s.selection().patches)).toEqual(["photo_scale"]);
    await expect(inspector).toBeVisible();
    await expect(learn.getByText("End is still 1")).toBeVisible();
    await page.waitForTimeout(300);
    await screenshot(page, "stage4-lesson-02-inspector-step");
    const end = inspector.getByRole("spinbutton", { name: "End", exact: true });
    await end.click();
    await end.fill("1.2");
    await end.press("Enter");
    await expect.poll(() => storedInput(page, "photo_scale.end")).toBe(1.2);
    await blurFields(page);
    await expect(step("Tap the photo")).toBeVisible();
    // The next step doesn't need the Inspector: it folds away again.
    await expect(inspector).toHaveCount(0);

    // 6. Tap the photo in the viewer.
    const photo = await centerOf(page.locator('#sb-viewer [data-layer="photo"]').first());
    await page.mouse.click(photo.x, photo.y);
    await expect(learn.getByRole("heading", { name: "You built a prototype" })).toBeVisible();
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number), { timeout: 5000 }).toBeGreaterThan(1.1);
    await expect(learn.getByRole("button", { name: /Next: States vs pulses/ })).toBeVisible();
    await page.waitForTimeout(500);
    await screenshot(page, "lesson-03-celebrate");

    // Progress persists.
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem("sonobe.lessons.v1") ?? "{}") as { completed?: Record<string, number> });
    expect(Object.keys(progress.completed ?? {})).toEqual(["first-prototype"]);
    await learn.getByRole("button", { name: "Close lesson" }).click();
    await expect(learn.locator(".sb-lessoncard").filter({ hasText: "Your first prototype" })).toContainText("Done");

    // Leaving the lesson brings back the layout from before it.
    await expect(main).not.toHaveAttribute("data-drawer-docked");
    await expect(inspector).toBeVisible();
    await expect(center).toHaveAttribute("data-mode", "split");
    expect(await page.evaluate(() => localStorage.getItem("sonobe.lessons.layout.v1"))).toBeNull();
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("lesson 1 fits the 1024x680 minimum window: the patch editor keeps room beside the drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 680 });
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const inspector = page.locator("#sb-inspector");
    const learn = page.getByRole("complementary", { name: "Learn" });
    const step = (title: string) => learn.locator('.sb-lesson__step[aria-current="step"]').filter({ hasText: title });
    // The patch editor's room, measured against the docked drawer's left edge: nothing of it hides under the drawer.
    // Polled where it's asserted: the panels fit themselves to the docked drawer a frame after it opens.
    const editorRoom = async () => {
      const editor = await page.locator(".sb-pe").boundingBox();
      const drawer = await learn.boundingBox();
      if (!editor || !drawer) throw new Error("The patch editor or the drawer isn't showing");
      return Math.min(editor.x + editor.width, drawer.x) - editor.x;
    };

    await page.getByRole("button", { name: "Learn", exact: true }).click();
    await learn.locator(".sb-lessoncard").filter({ hasText: "Your first prototype" }).click();
    await learn.getByRole("button", { name: "Start lesson" }).click();
    await expect(step("Make the photo listen for taps")).toBeVisible();
    await expect.poll(editorRoom).toBeGreaterThanOrEqual(320);
    await expect(flowNode(page, "photo_scale")).toBeInViewport({ ratio: 1 });
    await expect(page.locator("[data-lesson-spotlight]")).toBeVisible();

    // The Layers row's action button overlays the name, so hover its corner.
    const patchIds = () => hook(page, (s) => Object.keys(s.doc().components[s.doc().project.root]!.patches));
    const before = await patchIds();
    await page.locator("#sb-layers").getByText("Photo", { exact: true }).first().hover({ position: { x: 4, y: 4 } });
    await page.getByRole("button", { name: "Touch: add an interaction to Photo" }).click();
    await page.getByRole("menuitem", { name: /^Tap/ }).click();
    await expect.poll(async () => (await patchIds()).length).toBe(before.length + 1);
    const interaction = (await patchIds()).find((id) => !before.includes(id))!;
    const toggle = await connectNewPatch(page, interaction, "tap", "Switch", "switch");
    const spring = await connectNewPatch(page, toggle, "on", "Pop Animation", "popAnimation");
    await fitPatches(page);
    await dragCable(page, handle(page, spring, "out:output"), handle(page, "photo_scale", "in:progress"));
    await expect(step("Choose how big it grows")).toBeVisible();

    // The Inspector step folds Layers away, so the graph keeps its width beside the Inspector.
    await flowNode(page, "photo_scale").click({ position: { x: 48, y: 10 } });
    await expect(inspector).toBeVisible();
    await expect(page.locator("#sb-layers")).toHaveCount(0);
    await expect.poll(editorRoom).toBeGreaterThanOrEqual(320);
    await expect(flowNode(page, "photo_scale")).toBeInViewport({ ratio: 1 });

    // Resizing mid-step re-fits: a wide window keeps Layers, the narrow one folds it again.
    await page.setViewportSize({ width: 1680, height: 1050 });
    await expect(page.locator("#sb-layers")).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 680 });
    await expect(page.locator("#sb-layers")).toHaveCount(0);
    const end = inspector.getByRole("spinbutton", { name: "End", exact: true });
    await end.click();
    await end.fill("1.2");
    await end.press("Enter");
    await blurFields(page);

    // The last step points at the Viewer, which is a rail at this width: the ring is on the rail, and opening it works.
    await expect(step("Tap the photo")).toBeVisible();
    const rail = page.locator('.sb-rail[data-panel="viewer"]');
    await expect(rail).toBeVisible();
    await expect(page.locator("[data-lesson-spotlight]")).toBeVisible();
    await rail.getByRole("button").first().click();
    const photo = await centerOf(page.locator('#sb-viewer [data-layer="photo"]').first());
    await page.mouse.click(photo.x, photo.y);
    await expect(learn.getByRole("heading", { name: "You built a prototype" })).toBeVisible();

    // Closing the lesson puts Layers, the Inspector and the layout from before it back.
    await learn.getByRole("button", { name: "Close lesson" }).click();
    await expect(page.locator("#sb-layers")).toBeVisible();
    await expect(inspector).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("sonobe.lessons.layout.v1"))).toBeNull();
    expect(problems).toEqual([]);
  });

  test("resumes only on the lesson's practice prototype, and offers a restart otherwise", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const learn = page.getByRole("complementary", { name: "Learn" });
    const inspector = page.locator("#sb-inspector");
    const main = page.locator(".sb-shell__main");
    const offer = learn.getByText("Your practice prototype isn't open");

    await page.getByRole("button", { name: "Learn", exact: true }).click();
    await learn.locator(".sb-lessoncard").filter({ hasText: "States vs pulses" }).click();
    await learn.getByRole("button", { name: "Start lesson" }).click();
    await expect.poll(() => hook(page, (s) => s.doc().project.name)).toBe("States and Pulses");
    await expect(main).toHaveAttribute("data-drawer-docked");
    await expect(inspector).toHaveCount(0);

    // File → New replaces the practice prototype: the steps give way to a restart offer, and the
    // layout from before the lesson comes back.
    const mod = await modKey(page);
    await blurFields(page);
    await page.keyboard.press(`${mod}+n`);
    const welcome = page.getByRole("dialog", { name: "Start something new" });
    await welcome.getByRole("button", { name: "Create" }).click();
    await expect(welcome).toBeHidden();
    await expect.poll(() => hook(page, (s) => Object.keys(s.doc().components[s.doc().project.root]!.patches).length)).toBe(0);
    await expect(offer).toBeVisible();
    await expect(learn.locator(".sb-lesson__step")).toHaveCount(0);
    await expect(main).not.toHaveAttribute("data-drawer-docked");
    await expect(inspector).toBeVisible();
    await expect(page.locator(".sb-shell__center")).toHaveAttribute("data-mode", "split");
    await page.waitForTimeout(400);
    await screenshot(page, "stage4-lesson-03-restart-offer");

    // A reload keeps the offer: progress is saved, but it doesn't resume on another prototype.
    await page.reload();
    await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3, undefined, { timeout: 30_000 });
    await expect(offer).toBeVisible();
    await expect(inspector).toBeVisible();

    // Restart opens a fresh practice copy, and the lesson layout again.
    await learn.getByRole("button", { name: "Restart lesson" }).click();
    await expect.poll(() => hook(page, (s) => s.doc().project.name)).toBe("States and Pulses");
    await expect(learn.locator('.sb-lesson__step[aria-current="step"]')).toContainText("Listen for taps on the button");
    await expect(main).toHaveAttribute("data-drawer-docked");
    await expect(inspector).toHaveCount(0);

    await learn.getByRole("button", { name: "Exit lesson" }).click();
    await expect(inspector).toBeVisible();
    await expect(main).not.toHaveAttribute("data-drawer-docked");
    expect(problems).toEqual([]);
  });

  test("the lessons home only offers Continue while the practice prototype is open", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const learn = page.getByRole("complementary", { name: "Learn" });
    await page.getByRole("button", { name: "Learn", exact: true }).click();
    await expect(learn.getByRole("button", { name: "Start Your first prototype" })).toBeVisible();
    await expect(learn.getByText("0 of 5 done")).toBeVisible();

    // Saved progress on another prototype: the row offers a restart and says why, with no "In progress" badge.
    await page.evaluate(() => localStorage.setItem("sonobe.lessons.v1", JSON.stringify({ active: { id: "first-prototype", step: 3 }, completed: {} })));
    await page.reload();
    await page.waitForFunction(() => (window.__sonobe?.frame() ?? -1) > 3, undefined, { timeout: 30_000 });
    if (!(await learn.isVisible())) await page.getByRole("button", { name: "Learn", exact: true }).click();
    const suggested = learn.locator(".sb-lessoncard[data-expanded]");
    await expect(suggested).toContainText("Your practice prototype isn't open");
    await expect(suggested.getByRole("button", { name: "Restart Your first prototype" })).toBeVisible();
    await expect(learn.getByText("In progress")).toHaveCount(0);
    await expect(learn.getByText(/Step 4 of 6/)).toHaveCount(0);

    // Restart on the row opens a fresh practice copy straight away, then the row continues at step 1, and Exit drops it.
    await suggested.getByRole("button", { name: "Restart Your first prototype" }).click();
    await expect.poll(() => hook(page, (s) => s.doc().project.name)).toBe("Your First Prototype");
    await expect(learn.locator('.sb-lesson__step[aria-current="step"]')).toContainText("Make the photo listen for taps");
    await expect(learn.getByRole("heading", { name: "Your first prototype" })).toBeFocused();
    await learn.getByRole("button", { name: "Back" }).click();
    await expect(suggested).toContainText("Step 1 of 6");
    await expect(suggested.getByRole("button", { name: "Continue Your first prototype" })).toBeVisible();
    await suggested.getByRole("button", { name: "Continue Your first prototype" }).click();
    await learn.getByRole("button", { name: "Exit lesson" }).click();
    await expect(learn.getByRole("button", { name: "Start Your first prototype" })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
