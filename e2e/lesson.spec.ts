import { expect, test } from "@playwright/test";
import { blurFields, centerOf, collectConsoleProblems, connectNewPatch, dragCable, fitPatches, flowNode, handle, hook, openEditor, screenshot, storedInput, touchLayer } from "./helpers.ts";

test.describe("interactive lessons", () => {
  test("completes lesson 1, Your first prototype, through the UI", async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    const problems = collectConsoleProblems(page);
    await openEditor(page);

    // Learn opens on the lessons.
    await page.getByRole("button", { name: "Learn", exact: true }).click();
    const learn = page.getByRole("complementary", { name: "Learn" });
    await expect(learn).toBeVisible();
    await expect(learn.getByRole("radio", { name: "Lessons" })).toBeChecked();
    await learn.locator(".sb-lessoncard").filter({ hasText: "Your first prototype" }).click();
    await expect(learn.getByRole("heading", { name: "Your first prototype" })).toBeVisible();
    await learn.getByRole("button", { name: "Start lesson" }).click();

    // The practice prototype replaces the demo, and the drawer docks beside the panels.
    await expect.poll(() => hook(page, (s) => s.doc().project.name)).toBe("Your First Prototype");
    await expect(page.locator(".sb-shell__main")).toHaveAttribute("data-drawer-docked");
    const step = (title: string) => learn.locator('.sb-lesson__step[aria-current="step"]').filter({ hasText: title });
    await expect(step("Make the photo listen for taps")).toBeVisible();
    await expect(page.locator("[data-lesson-spotlight]")).toBeVisible();
    await page.getByRole("radio", { name: "Patches only" }).click();
    await page.waitForTimeout(300);
    await screenshot(page, "lesson-01-first-step");

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

    // 5. Select Photo Scale and set End in the inspector.
    await flowNode(page, "photo_scale").click({ position: { x: 48, y: 10 } });
    await expect.poll(() => hook(page, (s) => s.selection().patches)).toEqual(["photo_scale"]);
    await expect(learn.getByText("End is still 1")).toBeVisible();
    const end = page.locator("#sb-inspector").getByRole("spinbutton", { name: "End", exact: true });
    await end.click();
    await end.fill("1.2");
    await end.press("Enter");
    await expect.poll(() => storedInput(page, "photo_scale.end")).toBe(1.2);
    await blurFields(page);
    await expect(step("Tap the photo")).toBeVisible();

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
    expect(problems).toEqual([]);
  });
});
