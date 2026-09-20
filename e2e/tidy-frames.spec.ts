/**
 * Tidy Up with comment frames as sections (G1): tidying keeps every patch inside the frame it
 * belongs to, refits the frames, keeps their arrangement and pushes them apart; a selection tidies
 * within its frame; a comment's menu tidies just that frame.
 */

import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./helpers.ts";

const places = ["Mānoa Falls Trail", "Honolulu Museum of Art", "Rainbow Drive-In", "Leonard's Bakery"];

type Box = { x: number; y: number; width: number; height: number };

async function setup(page: Page) {
  await page.evaluate((placeItems) => {
    const s = window.__sonobe!;
    const root = s.doc().components[s.doc().project.root]!;
    const ops: unknown[] = [...Object.keys(root.patches).map((id) => ({ op: "removePatch", id })), ...root.comments.map((c) => ({ op: "removeComment", id: c.id }))];
    ops.push(
      { op: "addLayer", layer: { id: "deck_card", type: "rectangle", name: "Deck Card" } },
      { op: "addComment", comment: { id: "knobs", text: "KNOBS", rect: [0, 0, 380, 420], color: "yellow" } },
      { op: "addPatch", patch: { id: "k_resp", type: "splitter", typeParam: "number", name: "Spring Response (app: 0.3)", inputs: { value: 0.3 }, ui: { x: 20, y: 40 } } },
      { op: "addPatch", patch: { id: "k_damp", type: "splitter", typeParam: "number", name: "Spring Damping (app: 0.75)", inputs: { value: 0.75 }, ui: { x: 20, y: 130 } } },
      { op: "addPatch", patch: { id: "k_fly", type: "splitter", typeParam: "number", name: "Fly-Out Distance (app: 600)", inputs: { value: 600 }, ui: { x: 20, y: 220 } } },
      { op: "addComment", comment: { id: "deck", text: "THE DECK", rect: [440, 0, 1100, 420], color: "blue" } },
      { op: "addPatch", patch: { id: "drag", type: "gesture", name: "Drag Card", ui: { x: 460, y: 40 } } },
      { op: "addPatch", patch: { id: "feel", type: "springConverter", name: "App Spring Feel", ui: { x: 700, y: 40 }, inputs: { response: { link: "k_resp.output" }, dampingFraction: { link: "k_damp.output" } } } },
      { op: "addPatch", patch: { id: "fly", type: "multiply", name: "Fly-Out X", ui: { x: 700, y: 220 }, inputs: { value1: { link: "k_fly.output" }, value2: 1 } } },
      { op: "addPatch", patch: { id: "spring", type: "popAnimation", name: "Card Spring", ui: { x: 1180, y: 40 }, inputs: { number: { link: "fly.output" } } } },
      { op: "addComment", comment: { id: "places", text: "PLACES", rect: [440, 480, 330, 520], color: "green" } },
      { op: "addPatch", patch: { id: "names", type: "loopBuilder", typeParam: "text", inputCount: 4, name: "Place Names", inputs: placeItems, ui: { x: 460, y: 520 } } },
      { op: "addPatch", patch: { id: "count", type: "loopCount", name: "Card Count", ui: { x: 460, y: 680 }, inputs: { loop: { link: "names.loop" } } } },
      { op: "addPatch", patch: { id: "last", type: "subtract", name: "Last Index", ui: { x: 460, y: 780 }, inputs: { value1: { link: "count.count" }, value2: 1 } } },
      { op: "addComment", comment: { id: "chips", text: "CATEGORY CHIPS", rect: [820, 480, 400, 300], color: "gray" } },
      { op: "addPatch", patch: { id: "scroll", type: "scroll", name: "Scroll Categories", ui: { x: 840, y: 520 } } },
      { op: "addPatch", patch: { id: "loose", type: "popAnimation", name: "Next Card Rise", ui: { x: 1700, y: 600 }, inputs: { number: { link: "spring.output" } } } },
      { op: "connect", from: "spring.output", to: "@deck_card.scale" },
    );
    const r = s.apply(ops as never, "tidy setup");
    if (!r.ok) throw new Error(JSON.stringify(r.errors).slice(0, 600));
    s.session.selection.getState().clear();
  }, Object.fromEntries(places.map((v, i) => [`item${i}`, v])));
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Zoom to fit"]').first().click();
  await page.waitForTimeout(600);
}

/** Every node and frame as drawn, in screen space (overlap and containment don't depend on zoom). */
async function drawn(page: Page): Promise<{ nodes: Map<string, Box>; frames: Map<string, Box> }> {
  const all = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sb-pe .react-flow__node")].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.id!, x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  const nodes = new Map<string, Box>();
  const frames = new Map<string, Box>();
  for (const { id, ...box } of all) (id.startsWith("comment:") ? frames.set(id.slice("comment:".length), box) : nodes.set(id, box));
  return { nodes, frames };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (outer: Box, inner: Box) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

function overlapping(boxes: Map<string, Box>): string[] {
  const list = [...boxes];
  return list.flatMap(([a, r], i) => list.slice(i + 1).filter(([, s]) => overlaps(r, s)).map(([b]) => `${a}×${b}`));
}

async function tidyWith(page: Page, run: () => Promise<void>) {
  const before = await page.evaluate(() => window.__sonobe!.revision());
  await run();
  await page.waitForFunction((rev) => window.__sonobe!.revision() > rev, before, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

const SECTIONS: Record<string, string[]> = { knobs: ["k_resp", "k_damp", "k_fly"], deck: ["drag", "feel", "fly", "spring"], places: ["names", "count", "last"], chips: ["scroll"] };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 2600, height: 1600 });
  await openEditor(page);
  await page.evaluate(() => window.__sonobe!.layout().setViewMode("patches"));
  await setup(page);
});

test("Tidy Up keeps every patch in its section and the sections where they were", async ({ page }) => {
  await tidyWith(page, () => page.locator('[aria-label="Tidy up"]').first().click());
  const { nodes, frames } = await drawn(page);
  expect(overlapping(nodes)).toEqual([]);
  expect(overlapping(frames)).toEqual([]);
  for (const [frame, ids] of Object.entries(SECTIONS)) for (const id of ids) expect(inside(frames.get(frame)!, nodes.get(id)!), `${id} in ${frame}`).toBe(true);
  // No node straddles a frame edge: the loose patch stays clear, the layer node sits inside the deck like its driver.
  for (const [id, node] of nodes) for (const [frame, f] of frames) expect(overlaps(f, node) && !inside(f, node), `${id} straddles ${frame}`).toBe(false);
  for (const f of frames.values()) expect(overlaps(f, nodes.get("loose")!)).toBe(false);
  // Knobs stay left of the deck, and places and chips below it.
  expect(frames.get("knobs")!.x + frames.get("knobs")!.width).toBeLessThan(frames.get("deck")!.x);
  expect(frames.get("places")!.y).toBeGreaterThan(frames.get("deck")!.y + frames.get("deck")!.height);
  const doc = await page.evaluate(() => window.__sonobe!.doc().components.main!.comments.find((c) => c.id === "knobs")!.rect);
  expect(doc.slice(0, 2)).toEqual([0, 0]);
  // A second Tidy Up changes nothing, and one undo puts everything back.
  const revision = await page.evaluate(() => window.__sonobe!.revision());
  await page.locator('[aria-label="Tidy up"]').first().click();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__sonobe!.revision())).toBe(revision);
  await page.evaluate(() => window.__sonobe!.session.document.getState().undo());
  expect(await page.evaluate(() => window.__sonobe!.doc().components.main!.patches.names!.ui)).toMatchObject({ x: 460, y: 520 });
});

test("Tidy Up with a section's patches selected keeps them inside their frame", async ({ page }) => {
  await page.evaluate(() => window.__sonobe!.session.selection.getState().select({ patches: ["names", "count", "last"] }));
  await page.waitForTimeout(300);
  await tidyWith(page, () => page.locator('[aria-label="Tidy up"]').first().click());
  const { nodes, frames } = await drawn(page);
  for (const id of SECTIONS.places!) expect(inside(frames.get("places")!, nodes.get(id)!), id).toBe(true);
  expect(overlapping(frames)).toEqual([]);
  expect(inside(frames.get("chips")!, nodes.get("scroll")!)).toBe(true);
  expect(overlaps(frames.get("chips")!, nodes.get("count")!)).toBe(false);
});

test("Tidy Up Frame on a comment tidies just that frame", async ({ page }) => {
  const before = await page.evaluate(() => {
    const c = window.__sonobe!.doc().components.main!;
    return { drag: c.patches.drag!.ui, knobs: c.comments.find((m) => m.id === "knobs")!.rect };
  });
  await page.locator('.sb-pe .react-flow__node[data-id="comment:places"] .sb-pe-comment__title').click({ button: "right" });
  await tidyWith(page, () => page.getByRole("menuitem", { name: /Tidy Up Frame/ }).click());
  const { nodes, frames } = await drawn(page);
  for (const id of SECTIONS.places!) expect(inside(frames.get("places")!, nodes.get(id)!), id).toBe(true);
  expect(overlapping(frames)).toEqual([]);
  const after = await page.evaluate(() => {
    const c = window.__sonobe!.doc().components.main!;
    return { drag: c.patches.drag!.ui, knobs: c.comments.find((m) => m.id === "knobs")!.rect, label: window.__sonobe!.session.document.getState().undoLabel };
  });
  expect(after.drag).toEqual(before.drag);
  expect(after.knobs).toEqual(before.knobs);
  expect(after.label).toMatch(/Tidy up/);
});

test("Dragging a frame moves what belongs to it: a node grown past its edge, and a frame inside it", async ({ page }) => {
  // Card Count sticks out past PLACES' right edge, its title bar still inside; INNER sits in THE DECK and holds Fly-Out X.
  await page.evaluate(() => {
    const r = window.__sonobe!.apply([{ op: "updatePatch", id: "count", ui: { x: 700, y: 900 } }, { op: "addComment", comment: { id: "inner", text: "INNER", rect: [680, 180, 400, 200] } }] as never, "frame drag setup");
    if (!r.ok) throw new Error(JSON.stringify(r.errors).slice(0, 600));
  });
  await page.waitForTimeout(400);
  const read = () =>
    page.evaluate(() => {
      const c = window.__sonobe!.doc().components.main!;
      const at = (id: string) => c.comments.find((m) => m.id === id)!.rect.slice(0, 2);
      const ui = (id: string) => [c.patches[id]!.ui.x, c.patches[id]!.ui.y];
      return { places: at("places"), deck: at("deck"), inner: at("inner"), names: ui("names"), count: ui("count"), fly: ui("fly"), drag: ui("drag") };
    });
  const dragTitle = async (frame: string, dx: number, dy: number) => {
    const box = (await page.locator(`.sb-pe .react-flow__node[data-id="comment:${frame}"] .sb-pe-comment__title`).boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 30 + (dx * i) / 8, box.y + box.height / 2 + (dy * i) / 8);
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  const delta = (a: number[], b: number[]) => [b[0]! - a[0]!, b[1]! - a[1]!];

  const before = await read();
  await dragTitle("places", 0, 120);
  const moved = await read();
  const places = delta(before.places, moved.places);
  expect(places[1]).toBeGreaterThan(0);
  expect(delta(before.names, moved.names)).toEqual(places);
  expect(delta(before.count, moved.count), "Card Count, past the frame's edge").toEqual(places);

  await dragTitle("deck", 0, -80);
  const after = await read();
  const deck = delta(moved.deck, after.deck);
  expect(deck[1]).toBeLessThan(0);
  expect(delta(moved.drag, after.drag)).toEqual(deck);
  expect(delta(moved.inner, after.inner), "the frame inside").toEqual(deck);
  expect(delta(moved.fly, after.fly), "the inner frame's patch").toEqual(deck);
});
