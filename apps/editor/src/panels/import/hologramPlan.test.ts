import type { SonobeDocument } from "@sonobe/core";
import { buildDoc, createTestRuntime } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { buildCanvasIndex } from "../canvas/sceneIndex.ts";
import { clippedRadii, collectHoloLayers, HOLO, holoFrameAt, holoShapeOf, planHologram, radiiOf, sweepCurve, sweepProgressAt, sweepScale, textLines, traceProgress, type HoloLayer } from "./hologramPlan.ts";
import { laserLead, pointerEndsHologram, visibleRegion } from "./HologramBuild.tsx";
import { scanLaserAt, scannerFrame, SCAN_SWEEP_MS } from "./HologramScanner.tsx";

function indexFor(doc: SonobeDocument) {
  const rt = createTestRuntime(doc);
  const scene = rt.step();
  const index = buildCanvasIndex(doc.components[doc.project.root], scene);
  rt.dispose();
  return index;
}

const screenDoc = () =>
  buildDoc({
    layers: [
      { id: "old", type: "rectangle", props: { position: [0, 0], size: [402, 874] } },
      {
        id: "screen",
        type: "group",
        props: { position: [0, 0], size: [402, 874], clip: true },
        children: [
          { id: "fill", type: "colorFill", props: { color: "#FFFFFFFF" } },
          { id: "header", type: "rectangle", props: { position: [0, 0], size: [402, 120], cornerRadius: 0 } },
          {
            id: "card",
            type: "group",
            props: { position: [16, 140], size: [370, 300], cornerRadius: 24, clip: true },
            children: [
              { id: "avatar", type: "image", props: { position: [20, 20], size: [80, 80], cornerRadius: 40 } },
              { id: "name", type: "text", props: { position: [20, 110], size: [200, 28], text: "Ava Chen", fontSize: 24 } },
              { id: "bio", type: "text", props: { position: [20, 150], size: [300, 66], text: "Designer\nmaking tools\nfor prototyping", fontSize: 15, lineHeight: 22 } },
              { id: "clipped", type: "rectangle", props: { position: [20, 400], size: [100, 40] } },
              { id: "badge", type: "oval", props: { position: [320, 20], size: [30, 30] } },
            ],
          },
          { id: "hairline", type: "rectangle", props: { position: [0, 460], size: [402, 1] } },
          { id: "hidden", type: "rectangle", props: { position: [0, 500], size: [100, 100], enabled: false } },
          { id: "tap", type: "hitArea", props: { position: [0, 600], size: [100, 100] } },
          { id: "offscreen", type: "rectangle", props: { position: [0, 900], size: [100, 100] } },
          { id: "tabs", type: "group", props: { position: [0, 790], size: [402, 84] }, children: [{ id: "home", type: "image", props: { position: [40, 10], size: [28, 28] } }] },
        ],
      },
    ],
  });

describe("collectHoloLayers", () => {
  it("wireframes the screen's visible layers in document order, parents before children", () => {
    const collected = collectHoloLayers(indexFor(screenDoc()), "screen")!;
    expect(collected.screen).toEqual({ x: 0, y: 0, width: 402, height: 874 });
    // Fills, tap targets, hidden and hairline layers draw nothing; clipped and offscreen ones aren't seen.
    expect(collected.layers.map((l) => l.id)).toEqual(["header", "card", "avatar", "name", "bio", "badge", "tabs", "home"]);
    const byId = Object.fromEntries(collected.layers.map((l) => [l.id, l]));
    expect(byId.card).toMatchObject({ shape: "box", depth: 1, parent: null, radii: [24, 24, 24, 24], rect: { x: 16, y: 140, width: 370, height: 300 } });
    expect(byId.avatar).toMatchObject({ shape: "image", depth: 2, parent: "card", radii: [40, 40, 40, 40] });
    expect(byId.name).toMatchObject({ shape: "text", lines: 1 });
    expect(byId.bio).toMatchObject({ shape: "text", lines: 3 });
    expect(byId.badge!.shape).toBe("oval");
    expect(byId.home).toMatchObject({ parent: "tabs", depth: 2 });
  });

  it("keeps the largest layers when there are too many, in document order, with parents that are kept", () => {
    const index = indexFor(screenDoc());
    expect(collectHoloLayers(index, "screen", { maxPieces: 3 })!.layers.map((l) => l.id)).toEqual(["header", "card", "tabs"]);
    const five = collectHoloLayers(index, "screen", { maxPieces: 5 })!.layers;
    expect(five.map((l) => [l.id, l.parent])).toEqual([
      ["header", null],
      ["card", null],
      ["avatar", "card"],
      ["bio", "card"],
      ["tabs", null],
    ]);
    // A small wrapper that's left out hands its children to the nearest kept ancestor.
    const doc = buildDoc({
      layers: [
        {
          id: "screen",
          type: "group",
          props: { position: [0, 0], size: [400, 800] },
          children: [
            { id: "panel", type: "rectangle", props: { position: [0, 0], size: [400, 400] } },
            { id: "outer", type: "group", props: { position: [0, 400], size: [400, 400] }, children: [{ id: "wrap", type: "group", props: { position: [0, 0], size: [10, 10] }, children: [{ id: "big", type: "rectangle", props: { position: [0, 20], size: [300, 300] } }] }] },
          ],
        },
      ],
    });
    const kept = collectHoloLayers(indexFor(doc), "screen", { maxPieces: 3 })!.layers;
    expect(kept.map((l) => [l.id, l.parent])).toEqual([
      ["panel", null],
      ["outer", null],
      ["big", "outer"],
    ]);
  });

  it("samples equal layers across the screen instead of keeping the first rows", () => {
    const cards = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, type: "rectangle", props: { position: [0, i * 20], size: [50, 18] } }));
    const doc = buildDoc({ layers: [{ id: "screen", type: "group", props: { position: [0, 0], size: [100, 800] }, children: cards }] });
    const kept = collectHoloLayers(indexFor(doc), "screen", { maxPieces: 10 })!.layers;
    expect(kept).toHaveLength(10);
    expect(Math.max(...kept.map((l) => l.rect.y))).toBeGreaterThan(400);
    expect(kept.map((l) => l.rect.y)).toEqual([...kept.map((l) => l.rect.y)].sort((a, b) => a - b));
  });

  it("samples a grid whose cells differ by a hair across every column (18.94 and 18.95 pt)", () => {
    // A 20-column `1fr` grid: every fifth column comes out a hundredth of a point narrower.
    const cols = 20;
    const cells = Array.from({ length: cols * 30 }, (_, i) => {
      const col = i % cols;
      const width = col % 5 === 4 ? 18.94 : 18.95;
      return { id: `c${i}`, type: "rectangle", props: { position: [2 + col * 19.95, 2 + Math.floor(i / cols) * 19], size: [width, 18] } };
    });
    const doc = buildDoc({ layers: [{ id: "screen", type: "group", props: { position: [0, 0], size: [402, 874] }, children: cells }] });
    const kept = collectHoloLayers(indexFor(doc), "screen", { maxPieces: 300 })!.layers;
    expect(kept).toHaveLength(300);
    const perColumn = Array.from({ length: cols }, (_, col) => kept.filter((l) => Number(l.id.slice(1)) % cols === col).length);
    // Every column keeps a fair share, not all or nothing.
    for (const n of perColumn) expect(n).toBeGreaterThan(5);
    expect(Math.max(...kept.map((l) => l.rect.y))).toBeGreaterThan(400);
  });

  it("ranks layers by size before it samples near-equals", () => {
    const layers = [
      { id: "big", type: "rectangle", props: { position: [0, 700], size: [300, 100] } },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, type: "rectangle", props: { position: [0, i * 60], size: [50 + i * 0.01, 50] } })),
    ];
    const doc = buildDoc({ layers: [{ id: "screen", type: "group", props: { position: [0, 0], size: [402, 874] }, children: layers }] });
    const kept = collectHoloLayers(indexFor(doc), "screen", { maxPieces: 4 })!.layers;
    expect(kept.map((l) => l.id)).toContain("big");
    expect(kept).toHaveLength(4);
  });

  it("skips everything inside a transparent layer", () => {
    const doc = buildDoc({
      layers: [
        {
          id: "screen",
          type: "group",
          props: { position: [0, 0], size: [402, 874] },
          children: [
            { id: "later", type: "group", props: { position: [0, 400], size: [402, 300], opacity: 0 }, children: [{ id: "inside", type: "rectangle", props: { position: [20, 20], size: [100, 100] } }] },
            { id: "shown", type: "rectangle", props: { position: [0, 0], size: [402, 100] } },
          ],
        },
      ],
    });
    expect(collectHoloLayers(indexFor(doc), "screen")!.layers.map((l) => l.id)).toEqual(["shown"]);
  });

  it("rounds a layer's corners where a rounded clipping ancestor cuts them", () => {
    const doc = buildDoc({
      layers: [
        {
          id: "screen",
          type: "group",
          props: { position: [0, 0], size: [402, 874] },
          children: [
            // An imported avatar: a round clipping frame with a square photo inset by 4 pt.
            { id: "avatar", type: "group", props: { position: [20, 20], size: [88, 88], cornerRadius: 44, clip: true }, children: [{ id: "photo", type: "image", props: { position: [4, 4], size: [80, 80] } }] },
            {
              id: "card",
              type: "group",
              props: { position: [16, 140], size: [370, 300], cornerRadius: 24, clip: true },
              children: [
                { id: "cover", type: "image", props: { position: [0, 0], size: [370, 120] } },
                { id: "icon", type: "rectangle", props: { position: [16, 16], size: [24, 24], cornerRadius: 4 } },
              ],
            },
          ],
        },
      ],
    });
    const byId = Object.fromEntries(collectHoloLayers(indexFor(doc), "screen")!.layers.map((l) => [l.id, l]));
    // Concentric with the circle: a circle too.
    expect(byId.photo!.radii).toEqual([40, 40, 40, 40]);
    // Across the card's top: its top corners only.
    expect(byId.cover!.radii).toEqual([24, 24, 0, 0]);
    // Inside the card's corner curve already: its own corners.
    expect(byId.icon!.radii).toEqual([4, 4, 4, 4]);
  });

  it("reads per-corner radii the way the renderer does", () => {
    expect(radiiOf({ cornerRadius: 12 })).toEqual([12, 12, 12, 12]);
    expect(radiiOf({ cornerRadius: 12, cornerRadii: [0, 0, 0, 0] })).toEqual([12, 12, 12, 12]);
    expect(radiiOf({ cornerRadius: 12, cornerRadii: [16, 16, 0, 0] })).toEqual([16, 16, 0, 0]);
    expect(clippedRadii({ x: 0, y: 0, width: 10, height: 40 }, [30, 30, 30, 30], null)).toEqual([5, 5, 5, 5]);
  });

  it("returns null for a screen that isn't drawn", () => {
    const index = indexFor(screenDoc());
    expect(collectHoloLayers(index, "missing")).toBeNull();
    expect(collectHoloLayers(index, "hidden")).toBeNull();
  });

  it("names the wireframe for each layer type", () => {
    expect(["group", "rectangle", "shape", "textField", "componentInstance"].map(holoShapeOf)).toEqual(["box", "box", "box", "box", "box"]);
    expect(["image", "video", "lottie"].map(holoShapeOf)).toEqual(["image", "image", "image"]);
    expect(holoShapeOf("colorFill")).toBeNull();
    expect(holoShapeOf("hitArea")).toBeNull();
    expect([textLines(20, 17, 0), textLines(44, 17, 22), textLines(400, 17, 0)]).toEqual([1, 2, 3]);
  });
});

const layer = (id: string, y: number, parent: string | null = null, extra: Partial<HoloLayer> = {}): HoloLayer => ({ id, shape: "box", rect: { x: 0, y, width: 100, height: 40 }, depth: parent ? 2 : 1, parent, radii: [0, 0, 0, 0], lines: 0, ...extra });
const SCREEN = { x: 0, y: 0, width: 402, height: 874 };

describe("planHologram", () => {
  it("starts each outline as the laser passes its top edge", () => {
    const plan = planHologram(SCREEN, [layer("top", 0), layer("middle", 437), layer("bottom", 830)]);
    const at = Object.fromEntries(plan.pieces.map((p) => [p.id, p.at]));
    expect(at.top).toBe(HOLO.powerMs);
    expect(at.middle).toBeCloseTo(HOLO.powerMs + HOLO.downMs * sweepProgressAt(0.5), -1);
    expect(at.bottom).toBeGreaterThan(at.middle!);
    expect(at.bottom).toBeLessThanOrEqual(plan.timeline.downEnd);
  });

  it("draws children after their parents, even when they share a top edge", () => {
    const plan = planHologram(SCREEN, [layer("card", 100), layer("inner", 100, "card"), layer("deeper", 100, "inner")]);
    const [card, inner, deeper] = plan.pieces;
    expect(inner!.at - card!.at).toBeGreaterThanOrEqual(HOLO.childDelayMs);
    expect(deeper!.at - inner!.at).toBeGreaterThanOrEqual(HOLO.childDelayMs);
  });

  it("staggers a row of siblings div by div, but a sibling higher up doesn't wait for one below", () => {
    const row = planHologram(SCREEN, [layer("a", 300), layer("b", 300), layer("c", 300)]).pieces.map((p) => p.at);
    expect(row[1]! - row[0]!).toBeGreaterThan(0);
    expect(row[2]! - row[1]!).toBeGreaterThan(0);
    const [grid, card] = planHologram(SCREEN, [layer("grid", 600), layer("card", 120)]).pieces;
    expect(card!.at).toBeLessThan(grid!.at);
    // A long row keeps up with the laser.
    const long = planHologram(SCREEN, Array.from({ length: 30 }, (_, i) => layer(`r${i}`, 300))).pieces;
    expect(long.at(-1)!.at - long[0]!.at).toBeLessThan(200);
  });

  it("never starts an outline long after the down sweep, and never before its parent", () => {
    const chain = Array.from({ length: 12 }, (_, i) => layer(`l${i}`, 860, i ? `l${i - 1}` : null));
    const plan = planHologram(SCREEN, chain);
    for (const [i, piece] of plan.pieces.entries()) {
      expect(piece.at).toBeLessThanOrEqual(plan.timeline.downEnd + HOLO.tailMs);
      if (i) expect(piece.at).toBeGreaterThanOrEqual(plan.pieces[i - 1]!.at);
    }
  });

  it("runs about 3–4 s for a phone screen, scales for tall pages, and stays near 5 s", () => {
    const phone = planHologram(SCREEN, [layer("a", 0)]).timeline;
    expect(phone.downEnd - phone.downStart).toBeGreaterThanOrEqual(1400);
    expect(phone.downEnd - phone.downStart).toBeLessThanOrEqual(1800);
    expect(phone.upEnd - phone.upStart).toBeGreaterThanOrEqual(1200);
    expect(phone.upEnd - phone.upStart).toBeLessThanOrEqual(1500);
    expect(phone.end - phone.upEnd).toBe(HOLO.glowMs);
    expect(phone.end).toBeGreaterThanOrEqual(3000);
    expect(phone.end).toBeLessThanOrEqual(4000);
    const tall = planHologram({ ...SCREEN, height: 6000 }, [layer("a", 5990)]).timeline;
    expect(tall.end).toBeGreaterThan(phone.end);
    expect(tall.end).toBeLessThanOrEqual(5300);
    expect(sweepScale(100)).toBe(HOLO.minScale);
    expect(sweepScale(100_000)).toBe(HOLO.maxScale);
  });

  it("with reduced motion, shows the whole wireframe at once and crossfades in 300 ms", () => {
    const plan = planHologram(SCREEN, [layer("a", 0), layer("b", 800)], { reduced: true });
    expect(plan.pieces.map((p) => p.at)).toEqual([0, 0]);
    expect(plan.timeline.end).toBe(300);
    expect(holoFrameAt(plan, 0)).toMatchObject({ phase: "fade", laser: null, alpha: 1, veil: 1 });
    expect(holoFrameAt(plan, 150).alpha).toBeLessThan(0.5);
    expect(holoFrameAt(plan, 300).phase).toBe("done");
    expect(traceProgress(plan.pieces[1]!, 0, true)).toBe(1);
  });
});

describe("holoFrameAt", () => {
  const plan = planHologram(SCREEN, [layer("a", 0), layer("b", 800)]);
  const { downStart, downEnd, upStart, upEnd, end } = plan.timeline;

  it("powers on, sweeps down, holds, sweeps up revealing the design, glows and ends", () => {
    expect(holoFrameAt(plan, 0)).toMatchObject({ phase: "power", laser: null, veil: 1, frame: 0 });
    expect(holoFrameAt(plan, downStart / 2).frame).toBeCloseTo(0.5);
    const down = holoFrameAt(plan, (downStart + downEnd) / 2);
    expect(down).toMatchObject({ phase: "down", direction: 1, veil: 1 });
    expect(down.laser).toBeCloseTo(0.5, 1);
    expect(holoFrameAt(plan, downEnd + 1)).toMatchObject({ phase: "hold", laser: 1 });
    const up = holoFrameAt(plan, (upStart + upEnd) / 2);
    expect(up).toMatchObject({ phase: "up", direction: -1 });
    // The veil covers only what the laser hasn't passed on its way up.
    expect(up.veil).toBe(up.laser);
    const glow = holoFrameAt(plan, upEnd + (end - upEnd) * 0.3);
    expect(glow).toMatchObject({ phase: "glow", laser: null, veil: 0 });
    expect(glow.glow).toBeCloseTo(1);
    expect(holoFrameAt(plan, end - 1).alpha).toBeLessThan(0.05);
    expect(holoFrameAt(plan, end).phase).toBe("done");
  });

  it("traces an outline in 180 ms", () => {
    const piece = plan.pieces[1]!;
    expect(traceProgress(piece, piece.at - 1)).toBe(0);
    expect(traceProgress(piece, piece.at + HOLO.traceMs / 2)).toBeCloseTo(0.5);
    expect(traceProgress(piece, piece.at + HOLO.traceMs)).toBe(1);
  });
});

describe("sweep curve", () => {
  it("runs from top to bottom, steadily, and inverts", () => {
    expect(sweepCurve(0)).toBe(0);
    expect(sweepCurve(1)).toBe(1);
    let last = -1;
    for (let u = 0; u <= 1; u += 0.05) {
      expect(sweepCurve(u)).toBeGreaterThan(last);
      last = sweepCurve(u);
      expect(sweepCurve(sweepProgressAt(sweepCurve(u)))).toBeCloseTo(sweepCurve(u), 4);
    }
  });
});

describe("canvas build", () => {
  it("covers only the screen's visible part, plus a margin, on whole pixels", () => {
    expect(visibleRegion({ x: 100.4, y: 50.6, width: 200, height: 400 }, 1000, 800, 48)).toEqual({ x: 52, y: 2, width: 297, height: 497 });
    // Partly off the canvas body: clipped to it.
    expect(visibleRegion({ x: -300, y: 600, width: 402, height: 874 }, 1000, 800, 48)).toEqual({ x: 0, y: 552, width: 150, height: 248 });
    // Scrolled away: nothing to draw.
    expect(visibleRegion({ x: 2000, y: 0, width: 402, height: 874 }, 1000, 800, 48).width).toBe(0);
  });

  it("lets the wireframe run only a few pixels below the laser on its way down", () => {
    expect(laserLead({ x: 0, y: 0, width: 402, height: 874 })).toBe(10);
    expect(laserLead({ x: 0, y: 0, width: 40, height: 184 })).toBe(3);
  });

  it("keeps playing through a pan: a middle-button drag or a drag with Space held", () => {
    expect(pointerEndsHologram({ button: 0 }, false)).toBe(true);
    expect(pointerEndsHologram({ button: 2 }, false)).toBe(true);
    expect(pointerEndsHologram({ button: 1 }, false)).toBe(false);
    expect(pointerEndsHologram({ button: 0 }, true)).toBe(false);
  });
});

describe("dialog scanner", () => {
  it("sweeps down in about 2.75 s and back up", () => {
    expect(SCAN_SWEEP_MS).toBeGreaterThanOrEqual(2500);
    expect(SCAN_SWEEP_MS).toBeLessThanOrEqual(3000);
    expect(scanLaserAt(0)).toEqual({ y: 0, direction: 1 });
    expect(scanLaserAt(SCAN_SWEEP_MS / 2).y).toBeCloseTo(0.5, 1);
    expect(scanLaserAt(SCAN_SWEEP_MS * 1.5)).toMatchObject({ direction: -1 });
    expect(scanLaserAt(SCAN_SWEEP_MS * 1.5).y).toBeCloseTo(0.5, 1);
    expect(scanLaserAt(SCAN_SWEEP_MS * 2).y).toBe(0);
  });

  it("fits a frame with the import's proportions", () => {
    expect(scannerFrame([402, 874], { width: 300, height: 500 })).toEqual({ width: 193, height: 420 });
    expect(scannerFrame([402, 874], { width: 300, height: 200 })).toEqual({ width: 91, height: 200 });
    expect(scannerFrame([1440, 900], { width: 240, height: 400 })).toEqual({ width: 240, height: 150 });
  });
});
