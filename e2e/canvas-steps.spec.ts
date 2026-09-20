import { expect, test, type Page } from "@playwright/test";
import { blurFields, collectConsoleProblems, hook, openEditor } from "./helpers.ts";

/** A point on the canvas artboard (in prototype points) as a page point. */
async function artboardPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator(".sb-cv__artboard").boundingBox())!;
  const scale = box.width / (await hook(page, (s) => s.doc().components.main!.size![0]));
  return { x: box.x + x * scale, y: box.y + y * scale };
}

const topLayerIds = (page: Page) => hook(page, (s) => s.doc().components.main!.layers.map((l) => l.id));
const historyLabels = (page: Page) => hook(page, (s) => s.session.document.getState().historyEntries().map((e) => e.label));

// These canvas gestures apply a provisional step, then fold it into the final edit. Ids removed in
// earlier steps are retired, so the fold must keep the new layer's id rather than skip past it.
test.describe("canvas gestures that end as one undo step", () => {
  test("inserting a text layer and typing its text keeps the new layer's id", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const before = await historyLabels(page);
    const empty = await artboardPoint(page, 40, 830);
    await page.mouse.click(empty.x, empty.y);
    await blurFields(page);
    await page.keyboard.press("t");
    await page.mouse.click(empty.x, empty.y);
    await expect.poll(() => hook(page, (s) => s.selection().layers.length)).toBe(1);
    const inserted = await hook(page, (s) => s.selection().layers[0]!);
    const editor = page.locator(".sb-cv__text-editor");
    await expect(editor).toBeFocused();
    await page.keyboard.type("Hello");
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
    expect(await hook(page, (s) => s.selection().layers)).toEqual([inserted]);
    const text = await hook(
      page,
      (s, id) => {
        type Node = { id: string; props: Record<string, unknown>; children?: Node[] };
        const find = (layers: Node[]): Node | undefined => layers.map((l) => (l.id === id ? l : find(l.children ?? []))).find(Boolean);
        return find(s.doc().components.main!.layers as Node[])?.props.text;
      },
      inserted,
    );
    expect(text).toBe("Hello");
    expect(await historyLabels(page)).toEqual(["Insert Text", ...before]);
    expect(problems).toEqual([]);
  });

  test("⌥-dragging a layer duplicates it in one step", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const before = await topLayerIds(page);
    const history = await historyLabels(page);
    const card = await artboardPoint(page, 200, 520);
    await page.mouse.click(card.x, card.y);
    await expect.poll(() => hook(page, (s) => s.selection().layers)).toEqual(["card"]);
    const position = await hook(page, (s) => s.doc().components.main!.layers.find((l) => l.id === "card")!.props.position);
    await page.keyboard.down("Alt");
    await page.mouse.move(card.x, card.y);
    await page.mouse.down();
    await page.mouse.move(card.x + 40, card.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await topLayerIds(page)).length).toBe(before.length + 1);
    const copy = await hook(page, (s) => s.selection().layers[0]!);
    expect(before).not.toContain(copy);
    expect(await topLayerIds(page)).toContain(copy);
    expect(await hook(page, (s) => s.doc().components.main!.layers.find((l) => l.id === "card")!.props.position)).toEqual(position);
    expect(await historyLabels(page)).toEqual(["Duplicate Event Card", ...history]);
    expect(problems).toEqual([]);
  });
});
