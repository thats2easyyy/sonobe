import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, fitPatches, flowNode, hook, openEditor, screenshot } from "./helpers.ts";

/** Press the prototype where a viewer element is (the device content layer takes the pointer, not the element). */
async function pressInViewer(page: Page, selector: string): Promise<void> {
  const target = page.locator(`#sb-viewer ${selector}`).first();
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("one watched loop copy across the patch editor and the inspector", () => {
  test("a port's loop table sets the watched copy, the chip steps it, and the inspector reads the same copy", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const applied = await hook(page, (s) =>
      s.apply(
        [
          { op: "addPatch", patch: { id: "dot_rows", type: "loop", name: "Dot Rows", inputs: { count: 3 }, ui: { x: 40, y: 1200 } } },
          { op: "addPatch", patch: { id: "dot_grid", type: "gridLayout", inputs: { index: { link: "dot_rows.index" }, columns: 3, origin: [40, 700], width: 320, itemHeight: 40 }, ui: { x: 300, y: 1200 } } },
          { op: "addLayer", layer: { id: "dots", type: "oval", name: "Dots", props: { position: { link: "dot_grid.position" }, size: [24, 24], color: "#FF6F91FF" } } },
        ],
        "Add dots",
      ),
    );
    expect(applied.ok).toBe(true);
    await fitPatches(page);

    const index = flowNode(page, "dot_rows").locator(".sb-pe-port--out").filter({ hasText: "Index" });
    await expect(index.locator(".sb-pe-port__live")).toHaveText("×3 0…");
    const chip = page.getByRole("group", { name: "Watched loop copy" });
    await expect(chip).toContainText("3 copies");

    // Hover the port, then sweep onto the table: each row watches its copy.
    await index.hover();
    const card = page.getByRole("dialog", { name: "Index: live copies" });
    await expect(card).toBeVisible();
    const rows = card.getByRole("option");
    await expect(rows).toHaveCount(3);
    await rows.nth(1).hover();
    await rows.nth(2).hover();
    await expect(card).toBeVisible();
    await expect(rows.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(card).toContainText("Copy #2 of 3");
    await screenshot(page, "watched-copy-01-loop-table");

    await page.mouse.move(10, 10);
    await expect(card).toBeHidden();
    await expect(index.locator(".sb-pe-port__live")).toHaveText("#2 2");
    await expect(chip).toContainText("Copy #2 of 3");

    // The arrows wrap around the copies.
    await chip.getByRole("button", { name: "Watch the next copy" }).click();
    await expect(chip).toContainText("Copy #0 of 3");
    await chip.getByRole("button", { name: "Watch the previous copy" }).click();
    await expect(chip).toContainText("Copy #2 of 3");

    // The inspector's live outputs read the same copy.
    await hook(page, (s) => s.session.selection.getState().select({ patches: ["dot_rows"], layers: [], comments: [] }));
    const readout = page.locator(".sb-insp-live__text").filter({ hasText: "of 3" }).first();
    await expect(readout).toHaveText("#2 of 3 · 2");
    await screenshot(page, "watched-copy-02-inspector");

    await chip.getByRole("button", { name: "Show every copy" }).click();
    await expect(chip).toContainText("3 copies");
    await expect(index.locator(".sb-pe-port__live")).toHaveText("×3 0…");
    await expect(page.locator(".sb-insp-live__text").filter({ hasText: "×3" }).first()).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("inside a looped component instance, the live scope lists its copies and the watched copy picks one", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const applied = await hook(page, (s) =>
      s.apply(
        [
          { op: "addComponent", component: { id: "row", name: "Row", kind: "layerComponent" } },
          { op: "updateInterface", component: "row", inputs: { order: { name: "Order", type: "number" } } },
          { op: "addLayer", component: "row", layer: { id: "row_bg", type: "rectangle", name: "Row Background", props: { size: [200, 40] } } },
          { op: "addPatch", component: "row", patch: { id: "row_order", type: "splitter", typeParam: "number", name: "Row Order", inputs: { value: { link: "$in.order" } }, ui: { x: 40, y: 40 } } },
          { op: "addPatch", patch: { id: "rows", type: "loop", inputs: { count: 3 }, ui: { x: 40, y: 1200 } } },
          { op: "addPatch", patch: { id: "row_grid", type: "gridLayout", inputs: { index: { link: "rows.index" }, columns: 1, origin: [40, 640], width: 300, itemHeight: 44 }, ui: { x: 300, y: 1200 } } },
          { op: "addLayer", layer: { id: "list_row", type: "componentInstance", name: "List Row", component: "row", props: { position: { link: "row_grid.position" }, order: { link: "rows.index" } } } },
        ],
        "Add rows",
      ),
    );
    expect(applied.ok).toBe(true);
    await hook(page, (s) => s.session.selection.getState().enterComponent("row"));
    await fitPatches(page);

    const order = flowNode(page, "row_order").locator(".sb-pe-port--out").filter({ hasText: "Output" }).locator(".sb-pe-port__live");
    await expect(order).toHaveText("0");
    const chip = page.getByRole("group", { name: "Watched loop copy" });
    await expect(chip).toContainText("3 copies");

    await page.getByRole("button", { name: /^Live values from List Row #0/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("List Row has 3 copies");
    await menu.getByRole("menuitemcheckbox", { name: /List Row #2/ }).click();
    await expect(order).toHaveText("2");
    await expect(chip).toContainText("Copy #2 of 3");
    await screenshot(page, "watched-copy-03-instance-copy");

    await chip.getByRole("button", { name: "Watch the next copy" }).click();
    await expect(order).toHaveText("0");
    await chip.getByRole("button", { name: "Watch the next copy" }).click();
    await expect(order).toHaveText("1");
    await expect(page.getByRole("button", { name: /^Live values from List Row #1/ })).toBeVisible();

    // A press in the viewer inside one copy of the instance watches that copy.
    await pressInViewer(page, '[data-key="list_row#2/row_bg"]');
    await expect(chip).toContainText("Copy #2 of 3");
    await expect(order).toHaveText("2");
    expect(problems).toEqual([]);
  });

  test("inside a component instance that isn't looped, the chip steps through the component's own loops", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const applied = await hook(page, (s) =>
      s.apply(
        [
          { op: "addComponent", component: { id: "card", name: "Card", kind: "layerComponent" } },
          { op: "addLayer", component: "card", layer: { id: "card_bg", type: "rectangle", name: "Card Background", props: { size: [200, 40] } } },
          { op: "addPatch", component: "card", patch: { id: "card_items", type: "loop", name: "Card Items", inputs: { count: 5 }, ui: { x: 40, y: 40 } } },
          { op: "addLayer", layer: { id: "card_1", type: "componentInstance", name: "Card", component: "card", props: { position: [40, 640] } } },
        ],
        "Add card",
      ),
    );
    expect(applied.ok).toBe(true);
    await hook(page, (s) => s.session.selection.getState().enterComponent("card"));
    await fitPatches(page);

    const index = flowNode(page, "card_items").locator(".sb-pe-port--out").filter({ hasText: "Index" }).locator(".sb-pe-port__live");
    await expect(index).toHaveText("×5 0…");
    const chip = page.getByRole("group", { name: "Watched loop copy" });
    await expect(chip).toContainText("5 copies");
    await expect(page.locator(".sb-pe-live__name")).toHaveText("Card");
    await chip.getByRole("button", { name: "Watch the next copy" }).click();
    await chip.getByRole("button", { name: "Watch the next copy" }).click();
    await expect(chip).toContainText("Copy #1 of 5");
    await expect(index).toHaveText("#1 1");
    await expect(page.locator(".sb-pe-live__name")).toHaveText("Card");
    expect(problems).toEqual([]);
  });

  test("a press in the viewer on one copy of a looped layer watches that copy", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const applied = await hook(page, (s) =>
      s.apply(
        [
          { op: "addPatch", patch: { id: "dot_rows", type: "loop", name: "Dot Rows", inputs: { count: 3 }, ui: { x: 40, y: 1200 } } },
          { op: "addPatch", patch: { id: "dot_grid", type: "gridLayout", inputs: { index: { link: "dot_rows.index" }, columns: 3, origin: [40, 700], width: 320, itemHeight: 40 }, ui: { x: 300, y: 1200 } } },
          { op: "addLayer", layer: { id: "dots", type: "oval", name: "Dots", props: { position: { link: "dot_grid.position" }, size: [24, 24], color: "#FF6F91FF" } } },
        ],
        "Add dots",
      ),
    );
    expect(applied.ok).toBe(true);
    await fitPatches(page);
    const chip = page.getByRole("group", { name: "Watched loop copy" });
    await expect(chip).toContainText("3 copies");
    await pressInViewer(page, '[data-key="dots#2"]');
    await expect(chip).toContainText("Copy #2 of 3");
    const index = flowNode(page, "dot_rows").locator(".sb-pe-port--out").filter({ hasText: "Index" });
    await expect(index.locator(".sb-pe-port__live")).toHaveText("#2 2");
    await pressInViewer(page, '[data-key="dots#0"]');
    await expect(chip).toContainText("Copy #0 of 3");
    // A press on a layer that isn't a copy leaves the watched copy alone.
    await pressInViewer(page, '[data-layer="photo"]');
    await expect(chip).toContainText("Copy #0 of 3");
    await screenshot(page, "watched-copy-04-viewer-press");
    expect(problems).toEqual([]);
  });

  test("inside a looped component patch, the live scope lists its copies and the watched copy picks one", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const applied = await hook(page, (s) =>
      s.apply(
        [
          { op: "addComponent", component: { id: "echo", name: "Echo", kind: "patchComponent" } },
          { op: "updateInterface", component: "echo", inputs: { value: { name: "Value", type: "number" } } },
          { op: "addPatch", component: "echo", patch: { id: "echo_value", type: "splitter", typeParam: "number", name: "Echo Value", inputs: { value: { link: "$in.value" } }, ui: { x: 40, y: 40 } } },
          { op: "addPatch", patch: { id: "echo_rows", type: "loop", inputs: { count: 3 }, ui: { x: 40, y: 1200 } } },
          { op: "addPatch", patch: { id: "echo_1", type: "component", component: "echo", name: "Echo", inputs: { value: { link: "echo_rows.index" } }, ui: { x: 300, y: 1200 } } },
        ],
        "Add echo",
      ),
    );
    expect(applied.ok).toBe(true);
    await hook(page, (s) => s.session.selection.getState().enterComponent("echo"));
    await fitPatches(page);

    const value = flowNode(page, "echo_value").locator(".sb-pe-port--out").filter({ hasText: "Output" }).locator(".sb-pe-port__live");
    await expect(value).toHaveText("0");
    const chip = page.getByRole("group", { name: "Watched loop copy" });
    await expect(chip).toContainText("3 copies");
    await page.getByRole("button", { name: /^Live values from Echo #0/ }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText("Echo has 3 copies");
    await menu.getByRole("menuitemcheckbox", { name: /Echo #2/ }).click();
    await expect(value).toHaveText("2");
    await expect(chip).toContainText("Copy #2 of 3");
    await chip.getByRole("button", { name: "Watch the next copy" }).click();
    await expect(value).toHaveText("0");
    await screenshot(page, "watched-copy-05-patch-instance-copy");
    expect(problems).toEqual([]);
  });
});
