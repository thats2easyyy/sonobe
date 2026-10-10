/**
 * A prototype where nothing moves runs no frames (ARCHITECTURE.md §5.2), and anything that can
 * change a frame starts them again: a tap in the Viewer, an edit, a knob, a restart.
 */

import { expect, test, type Page } from "@playwright/test";
import { centerOf, collectConsoleProblems, hook, openEditor } from "./helpers.ts";

const frame = (page: Page) => hook(page, (s) => s.frame());
const atRest = (page: Page) => expect.poll(() => hook(page, (s) => s.resting()), { timeout: 10_000 }).toBe(true);
const readout = (page: Page) => page.locator("#sb-hud .sb-hudx__stat");

test.describe("rest", () => {
  test("the demo rests, and a tap, an edit, a knob and a restart each wake it", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);

    // Nothing moves in the demo until it is tapped: no frames run, and the readout says so.
    await atRest(page);
    const rested = await frame(page);
    await page.waitForTimeout(500);
    expect(await frame(page)).toBe(rested);
    expect(await hook(page, (s) => s.playing())).toBe(true);
    await expect(readout(page)).toHaveText("At rest");
    await expect(page.locator("#sb-viewer .sb-vw__pill[data-static]")).toHaveText("Live");

    // A tap on the photo: frames run while it springs, the tap lands, and it rests again.
    const photo = await centerOf(page.locator('#sb-viewer [data-layer="photo"]').first());
    await page.mouse.click(photo.x, photo.y);
    await expect.poll(() => hook(page, (s) => s.getValue("zoomed.on"))).toBe(true);
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number), { timeout: 5000 }).toBeCloseTo(1.18, 2);
    await atRest(page);
    const afterTap = await frame(page);
    expect(afterTap).toBeGreaterThan(rested + 5);
    await expect(readout(page)).toHaveText("At rest");

    // An edit reaches the running prototype.
    await hook(page, (s) => s.apply([{ op: "setInput", target: "photo_scale.end", value: 1.3 }], "Bigger"));
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number)).toBeCloseTo(1.3, 3);
    await atRest(page);
    const afterEdit = await frame(page);
    expect(afterEdit).toBeGreaterThan(afterTap);

    // A knob tune does too.
    await hook(page, (s) =>
      s.apply(
        [
          { op: "addKnob", knob: { id: "zoom", name: "Zoom", type: "number", value: 1.3 } },
          { op: "setInput", target: "photo_scale.end", value: { link: "$knob.zoom" } },
        ],
        "Knob",
      ),
    );
    await atRest(page);
    await hook(page, (s) => s.apply([{ op: "setKnobValue", id: "zoom", value: 1.25 }], "Tune"));
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number)).toBeCloseTo(1.25, 3);
    await atRest(page);
    expect(await frame(page)).toBeGreaterThan(afterEdit);

    // Restart starts over from frame 0, and the fresh prototype rests too.
    await page.locator(".sb-toolbar").getByRole("button", { name: "Restart prototype" }).click();
    await expect.poll(() => hook(page, (s) => s.getValue("zoomed.on"))).toBe(false);
    await atRest(page);
    expect(await frame(page)).toBeLessThan(10);
    expect(problems).toEqual([]);
  });

  test("with the Viewer hidden the prototype still rests, and an edit still reaches it", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    await hook(page, (s) => s.layout().toggleCollapsed("viewer", true));
    await expect(page.locator("#sb-viewer")).toHaveCount(0);
    await atRest(page);
    const rested = await frame(page);
    await page.waitForTimeout(300);
    expect(await frame(page)).toBe(rested);

    await hook(page, (s) => s.apply([{ op: "setInput", target: "photo_scale.start", value: 1.1 }], "Start bigger"));
    await expect.poll(() => hook(page, (s) => s.getValue("@photo.scale") as number)).toBeCloseTo(1.1, 3);
    await atRest(page);
    expect(await frame(page)).toBeGreaterThan(rested);
    expect(problems).toEqual([]);
  });

  test("a prototype that keeps moving shows its frame rate, not At rest", async ({ page }) => {
    await openEditor(page);
    await atRest(page);
    const clock = await hook(page, (s) =>
      s.apply(
        [
          { op: "addPatch", patch: { id: "e2e_clock", type: "time", ui: { x: 40, y: 600 } } },
          { op: "setInput", target: "@photo.rotation", value: { link: "e2e_clock.time" } },
        ],
        "Clock",
      ),
    );
    expect(clock.ok).toBe(true);
    const before = await frame(page);
    await expect(readout(page)).toHaveText(/^\d+ fps$/, { timeout: 5000 });
    expect(await hook(page, (s) => s.resting())).toBe(false);
    // Frames keep coming; how many have run by the time the readout shows a rate depends on the machine.
    await expect.poll(() => frame(page)).toBeGreaterThan(before + 10);
    // Unplugging the clock lets it rest again.
    await hook(page, (s) => void s.session.document.getState().undo());
    await atRest(page);
    await expect(readout(page)).toHaveText("At rest");
  });
});
