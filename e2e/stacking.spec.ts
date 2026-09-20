/** zPosition stacking in the live viewer: what draws in front is what takes the touch, inside the device frame, without moving elements. */

import { expect, test, type Page } from "@playwright/test";
import { collectConsoleProblems, hook, openEditor } from "./helpers.ts";

/** RGB of the page at a CSS pixel (a 1×1 screenshot decoded in the page). */
async function pixelAt(page: Page, point: { x: number; y: number }): Promise<[number, number, number]> {
  const png = await page.screenshot({ clip: { x: Math.round(point.x), y: Math.round(point.y), width: 1, height: 1 }, animations: "disabled", caret: "hide" });
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!] as [number, number, number];
  }, png.toString("base64"));
}

const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 80 && b! < 80;
const isBlack = ([r, g, b]: number[]) => r! < 40 && g! < 40 && b! < 40;

/** Apply ops to the root component and return the ids their refs got. */
async function build(page: Page, ops: unknown[]): Promise<Record<string, string>> {
  const result = await hook(page, (s, list) => s.apply(list as never, "Stacking test"), ops);
  expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  return result.idMap as Record<string, string>;
}

/** Root layer elements in the viewer, in DOM order, with the z-index each draws with. */
const rootLayers = (page: Page) =>
  page.locator("#sb-viewer .sonobe-stage > .sonobe-layer").evaluateAll((els) => els.map((e) => ({ id: (e as HTMLElement).dataset.layer!, z: Number(getComputedStyle(e).zIndex) || 0 })));

/** Where a prototype point inside a layer lands on screen, from the layer element's on-screen box. */
async function screenPoint(page: Page, layerId: string, size: [number, number], local: [number, number]): Promise<{ x: number; y: number }> {
  const el = page.locator(`#sb-viewer [data-layer="${layerId}"]`).first();
  await expect(el).toBeVisible();
  const box = (await el.boundingBox())!;
  return { x: box.x + (local[0] / size[0]) * box.width, y: box.y + (local[1] / size[1]) * box.height };
}

test.describe("zPosition stacking", () => {
  test("the viewer draws a lifted first sibling in front, and a tap there lands on it", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const ids = await build(page, [
      { op: "addLayer", layer: { ref: "red", type: "rectangle", name: "Lifted Red", props: { position: [60, 300], size: [200, 200], color: "#FF0000FF", zPosition: 10 } } },
      { op: "addLayer", layer: { ref: "blue", type: "rectangle", name: "Later Blue", props: { position: [160, 400], size: [200, 200], color: "#0000FFFF" } } },
      { op: "addPatch", patch: { ref: "tap", type: "interaction", name: "Tap Red", inputs: { layer: { layer: "$red" } } } },
      { op: "addPatch", patch: { ref: "tapped", type: "switch", name: "Red Tapped", inputs: { turnOn: { link: "$tap.tap" } } } },
    ]);
    // The overlap is 150 pt into the red square, where the blue one (later in the list) also sits.
    const overlap = await screenPoint(page, ids.red!, [200, 200], [150, 150]);
    await expect.poll(() => pixelAt(page, overlap).then(isRed)).toBe(true);
    const blueOnly = await screenPoint(page, ids.blue!, [200, 200], [150, 150]);
    const blue = await pixelAt(page, blueOnly);
    expect(blue[2] > 200 && blue[0] < 80).toBe(true);
    // Nothing moved in the DOM: the lifted layer is still before the blue one, ranked above it with z-index.
    const roots = await rootLayers(page);
    const red = roots.findIndex((l) => l.id === ids.red);
    const later = roots.findIndex((l) => l.id === ids.blue);
    expect(red).toBeLessThan(later);
    expect(roots[red]!.z).toBeGreaterThan(roots[later]!.z);

    await page.mouse.click(overlap.x, overlap.y);
    await expect.poll(() => hook(page, (s, id) => s.getValue(`${id}.on`), ids.tapped!)).toBe(true);
    expect(problems).toEqual([]);
  });

  test("ranked root layers stay under the device frame's Dynamic Island", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const island = page.locator("#sb-viewer .sonobe-device-cutout[data-kind='island']");
    await expect(island).toBeVisible();
    await build(page, [
      { op: "addLayer", layer: { ref: "cover", type: "rectangle", name: "Red Cover", props: { position: [0, 0], size: [402, 200], color: "#FF0000FF", zPosition: 5 } } },
      { op: "addLayer", layer: { ref: "strip", type: "rectangle", name: "Later Strip", props: { position: [0, 600], size: [402, 40], color: "#FFFFFFFF" } } },
    ]);
    const stage = page.locator("#sb-viewer .sonobe-stage");
    await expect.poll(() => stage.evaluate((el) => getComputedStyle(el).isolation)).toBe("isolate");
    const box = (await island.boundingBox())!;
    // Left of center: the camera dot sits near the island's right end.
    const inside = { x: box.x + box.width * 0.35, y: box.y + box.height / 2 };
    expect(isBlack(await pixelAt(page, inside))).toBe(true);
    // Just below the island, the lifted cover is what shows.
    expect(isRed(await pixelAt(page, { x: inside.x, y: box.y + box.height + 12 }))).toBe(true);
    expect(problems).toEqual([]);
  });

  test("a focused text field keeps focus when a zPosition change reorders it", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await openEditor(page);
    const ids = await build(page, [
      { op: "addLayer", layer: { ref: "field", type: "textField", name: "Name Field", props: { position: [40, 300], size: [320, 50], placeholder: "Name" } } },
      { op: "addLayer", layer: { ref: "cover", type: "rectangle", name: "Half Cover", props: { position: [200, 280], size: [180, 90], color: "#0000FFFF" } } },
    ]);
    const field = await screenPoint(page, ids.field!, [320, 50], [60, 25]);
    await page.mouse.click(field.x, field.y);
    const input = page.locator(`#sb-viewer [data-layer="${ids.field}"] .sonobe-input`);
    await expect(input).toBeFocused();
    await page.keyboard.type("Ada");

    const order = async () => (await rootLayers(page)).map((l) => l.id);
    const before = await order();
    await build(page, [{ op: "updateLayer", id: ids.field, props: { zPosition: 5 } }]);
    const rankOf = async (id: string) => (await rootLayers(page)).find((l) => l.id === id)!.z;
    await expect.poll(async () => (await rankOf(ids.field!)) > (await rankOf(ids.cover!))).toBe(true);
    expect(await order()).toEqual(before);
    await expect(input).toBeFocused();
    await page.keyboard.type(" Lovelace");
    await expect(input).toHaveValue("Ada Lovelace");
    expect(problems).toEqual([]);
  });
});
