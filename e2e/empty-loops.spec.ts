import { expect, test } from "@playwright/test";
import { collectConsoleProblems, hook, openEditor, screenshot } from "./helpers.ts";

test.describe("an empty loop in the live viewer", () => {
  test("the viewer says what has no copies, Why? shows the warning, and its fix brings the copies back", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    // Three dots on a grid whose opacity comes from a Loop Select that picks past the end of its 1-item loop.
    const applied = await hook(page, (s) =>
      s.apply(
        [
          { op: "addPatch", patch: { id: "dot_rows", type: "loop", inputs: { count: 3 }, ui: { x: 40, y: 1200 } } },
          { op: "addPatch", patch: { id: "dot_grid", type: "gridLayout", inputs: { index: { link: "dot_rows.index" }, columns: 3, origin: [40, 700], width: 320, itemHeight: 40 }, ui: { x: 260, y: 1200 } } },
          { op: "addPatch", patch: { id: "dot_pick", type: "loopSelect", name: "Dot Fade", typeParam: "number", inputs: { loop: { loop: [1] }, index: { loop: [2, 3] } }, ui: { x: 260, y: 1320 } } },
          { op: "addLayer", layer: { id: "dots", type: "oval", name: "Dots", props: { position: { link: "dot_grid.position" }, size: [24, 24], color: "#FF6F91FF", opacity: { link: "dot_pick.output" } } } },
        ],
        "Add dots",
      ),
    );
    expect(applied.ok).toBe(true);

    const notice = page.getByRole("status").filter({ hasText: "Dots has no copies" });
    await expect(notice).toBeVisible();
    await screenshot(page, "empty-loop-01-viewer-notice");
    await notice.getByRole("button", { name: "Why?" }).click();

    const warning = page.locator(".sb-problem").filter({ hasText: 'Layer "Dots" has 0 copies because "Dot Fade" (Loop Select) returned an empty loop' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("safe start value");
    expect(await hook(page, (s) => s.session.selection.getState().layers)).toEqual(["dots"]);
    await screenshot(page, "empty-loop-02-diagnostics");

    await warning.getByRole("button", { name: "Set Out of Range to Clamp" }).click();
    await expect.poll(() => hook(page, (s) => (s.doc().components.main!.patches.dot_pick!.inputs as Record<string, unknown>).outOfRange)).toBe("clamp");
    await expect(notice).toBeHidden();
    await expect(warning).toBeHidden();
    expect(problems).toEqual([]);
  });
});
