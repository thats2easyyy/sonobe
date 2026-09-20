/** Repeat in the editor: copies in the viewer, the Inspector's count row, the Layers panel badges, and the Z Position note on Bring to Front. */

import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, hook, openEditor, runCommand } from "./helpers.ts";

/** Apply ops to the root component and return the ids their refs got. */
async function build(page: Page, ops: unknown[]): Promise<Record<string, string>> {
  const result = await hook(page, (s, list) => s.apply(list as never, "Repeat test"), ops);
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  return result.idMap as Record<string, string>;
}

const layerRow = (page: Page, name: string) => page.locator(".sb-layerspanel .sb-tree__row", { has: page.locator(".sb-tree__label", { hasText: new RegExp(`^${name}$`) }) });

test.describe("Repeat", () => {
  test("a card linked to a loop repeats in the viewer, reads as copies in the Inspector, and gets a ×N badge", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const ids = await build(page, [
      { op: "addPatch", patch: { ref: "names", type: "loopBuilder", typeParam: "text", inputCount: 4, name: "Deck Names", inputs: { item0: "A", item1: "B", item2: "C", item3: "D" } } },
      {
        op: "addLayer",
        layer: { ref: "deck", type: "group", name: "Deck Card", props: { position: [40, 300], size: [300, 200], color: "#FFFFFFFF" }, children: [{ ref: "label", type: "text", name: "Deck Label" }] },
      },
      { op: "connect", from: "$names.loop", to: "@$label.text" },
      { op: "connect", from: "$names.loop", to: "@$deck.repeat" },
    ]);
    // One card per name, each with its own label.
    await expect.poll(() => page.locator(`#sb-viewer [data-layer="${ids.deck}"]`).count()).toBe(4);
    await expect.poll(() => page.locator(`#sb-viewer [data-layer="${ids.label}"]`).count()).toBe(4);

    const badge = layerRow(page, "Deck Card").locator('.sb-layerspanel__badge[data-kind="copies"]');
    await expect(badge).toHaveText("×4");
    await expect(badge.locator("svg")).toHaveCount(1);
    await expect(layerRow(page, "Deck Label").locator(".sb-layerspanel__badge")).toHaveCount(0);

    await hook(page, (s, id) => s.session.selection.getState().select({ layers: [id] }), ids.deck!);
    const repeat = page.locator(".sb-insp-row", { has: page.locator(".sb-insp-row__name", { hasText: /^Repeat$/ }) });
    await expect(repeat.locator(".sb-insp-chip")).toContainText("deck_names.loop");
    await expect(repeat.locator(".sb-insp-live__text")).toHaveText("4 copies");
    expect(problems).toEqual([]);
  });

  test("a typed count starts from Auto, and Bring to Front says when a sibling's Z Position still wins", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const ids = await build(page, [
      { op: "addLayer", layer: { ref: "blocker", type: "rectangle", name: "Front Blocker", props: { position: [40, 300], size: [120, 120], zPosition: 2 } } },
      { op: "addLayer", layer: { ref: "mover", type: "rectangle", name: "Mover", props: { position: [80, 340], size: [120, 120], color: "#FF0000FF" } } },
    ]);
    await expect(layerRow(page, "Front Blocker").locator('.sb-layerspanel__badge[data-kind="z"]')).toHaveText("z2");

    await hook(page, (s, id) => s.session.selection.getState().select({ layers: [id] }), ids.mover!);
    const field = page.locator('input[aria-label="Repeat"]');
    await expect(field).toHaveValue("");
    await expect(field).toHaveAttribute("placeholder", "Auto");
    await field.click();
    await field.fill("3");
    await field.press("Enter");
    await expect.poll(() => hook(page, (s, id) => s.doc().components.main!.layers.find((l) => l.id === id)?.props.repeat, ids.mover!)).toBe(3);
    await expect.poll(() => page.locator(`#sb-viewer [data-layer="${ids.mover}"]`).count()).toBe(3);
    await expect(layerRow(page, "Mover").locator('.sb-layerspanel__badge[data-kind="copies"]')).toHaveText("×3");

    await runCommand(page, "Bring to Front");
    await expect(page.locator(".sb-toast__title", { hasText: "“Front Blocker” still draws in front of “Mover”" })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
