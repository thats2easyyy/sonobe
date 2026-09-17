import type { LayerRef } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import type { PatchDefinition, PixelReading } from "@sonobe/engine";
import { createPatchHarness } from "../infra/index.ts";
import { objectDetectionPatch } from "./objectDetection.ts";
import { SALIENCY_GRID, grayGrid, saliencyMap, saliencyRegions } from "./saliency.ts";

/** The definition with a switch for `ctx.muted`, so a test can mute a running patch. */
function muteSwitch<S>(definition: PatchDefinition<S>) {
  let muted = false;
  const switched: PatchDefinition<S> = { ...definition, evaluate: (ctx) => definition.evaluate(Object.create(ctx, { muted: { get: () => muted } })) };
  return { definition: switched, mute: (on: boolean) => void (muted = on) };
}

/** An RGBA picture: black with white rectangles [x, y, w, h]. */
function picture(width: number, height: number, rects: [number, number, number, number][] = [], fill = 0): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh);
      const v = inside ? 255 : fill;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** A deterministic textured gray picture with bright discs [cx, cy, radius]. */
function textured(width: number, height: number, discs: [number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 3;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 70 + 50 * Math.sin(x / 5) * Math.sin(y / 7) + 30 * rand();
      for (const [cx, cy, r] of discs) if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) v = 250;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("saliency", () => {
  it("area-averages pixels into a 64 × 64 luma grid composited onto black", () => {
    const white = grayGrid({ width: 128, height: 128, data: picture(128, 128, [], 255) });
    expect(white).toHaveLength(SALIENCY_GRID * SALIENCY_GRID);
    expect(white.every((v) => Math.abs(v - 1) < 1e-9)).toBe(true);
    const transparent = new Uint8ClampedArray(16 * 16 * 4).fill(255);
    for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0;
    expect(grayGrid({ width: 16, height: 16, data: transparent }).every((v) => v === 0)).toBe(true);
    const halves = grayGrid({ width: 2, height: 1, data: picture(2, 1, [[0, 0, 1, 1]]) });
    expect(halves[0]).toBeCloseTo(1, 9);
    expect(halves[63]).toBeCloseTo(0, 9);
    expect(grayGrid({ width: 10, height: 10, data: new Uint8ClampedArray(3) }).every((v) => v === 0)).toBe(true);
  });

  it("a flat picture gives no objects and the whole picture for attention", () => {
    const map = saliencyMap(grayGrid({ width: 64, height: 64, data: picture(64, 64, [], 90) }));
    expect(map.every((v) => v === 0)).toBe(true);
    expect(saliencyRegions(map, "objects", [640, 480])).toEqual([]);
    expect(saliencyRegions(map, "attention", [640, 480])).toEqual([[0, 0, 640, 480]]);
  });

  it("finds standout discs on a textured background", () => {
    const center = ([x, y, w, h]: number[]) => [x! + w! / 2, y! + h! / 2];
    const one = saliencyMap(grayGrid({ width: 256, height: 256, data: textured(256, 256, [[184, 64, 14]]) }));
    expect(Math.max(...one)).toBeCloseTo(1, 9);
    const objects = saliencyRegions(one, "objects", [256, 256]);
    expect(objects).toHaveLength(1);
    const [cx, cy] = center(objects[0]!);
    expect(Math.abs(cx! - 184)).toBeLessThan(8);
    expect(Math.abs(cy! - 64)).toBeLessThan(8);

    const two = saliencyMap(grayGrid({ width: 256, height: 256, data: textured(256, 256, [[184, 64, 14], [60, 190, 10]]) }));
    const found = saliencyRegions(two, "objects", [256, 256]).map(center);
    expect(found).toHaveLength(2);
    expect(found.some(([x, y]) => Math.abs(x! - 184) < 8 && Math.abs(y! - 64) < 8)).toBe(true);
    expect(found.some(([x, y]) => Math.abs(x! - 60) < 8 && Math.abs(y! - 190) < 8)).toBe(true);
    const [ax, ay, aw, ah] = saliencyRegions(two, "attention", [256, 256])[0]!;
    expect(ax).toBeLessThanOrEqual(50);
    expect(ay).toBeLessThanOrEqual(50);
    expect(ax + aw).toBeGreaterThanOrEqual(198);
    expect(ay + ah).toBeGreaterThanOrEqual(200);
    expect(saliencyRegions(one, "objects", [0, 256])).toEqual([]);
  });

  it("is deterministic for the same pixels", () => {
    const px = { width: 100, height: 80, data: picture(100, 80, [[10, 10, 20, 20], [60, 40, 25, 30]]) };
    expect(saliencyRegions(saliencyMap(grayGrid(px)), "objects", [100, 80])).toEqual(saliencyRegions(saliencyMap(grayGrid(px)), "objects", [100, 80]));
  });
});

function pixels(frameId: number): PixelReading {
  return { width: 64, height: 64, data: picture(64, 64, [[40, 8, 16, 16]]), frameId, contentSize: [640, 640], contentRect: [0, 0, 320, 320] };
}

describe("objectDetection", () => {
  it("reports Available false and an error where the host can't read pixels", () => {
    const h = createPatchHarness(objectDetectionPatch, { inputs: { layer: { layerId: "photo" } } });
    expect(h.run(2).outputs).toEqual({ regionDetected: false, count: 0, position: { __loop: true, items: [] }, size: { __loop: true, items: [] }, available: false, error: true, errorMessage: "This host can't read pixels." });
    expect(h.logs.filter((l) => l.level === "log")).toHaveLength(1);
  });

  it("finds regions and maps them into the layer's parent space with previous-frame geometry", () => {
    let reading: PixelReading | undefined = pixels(1);
    const reads: LayerRef[] = [];
    const h = createPatchHarness(objectDetectionPatch, {
      inputs: { layer: { layerId: "photo" }, mode: "attention" },
      services: {
        platform: { media: { close: () => {}, startRecording: () => {}, stopRecording: async () => null, readPixels: (layer: LayerRef) => (reads.push(layer), reading) } } as never,
        layerInfo: () => ({ type: "image", enabled: true, position: [100, 200], size: [320, 320], scale: [2, 2], anchor: [0.5, 0.5], parent: null, worldTransform: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, -220, -120, 0, 1], contentSize: [320, 320] }),
      },
    });
    const f = h.step({ dt: 0.05 });
    expect(f.outputs.available).toBe(true);
    expect(f.outputs.count).toBe(1);
    const [x, y] = (f.outputs.position as { items: number[][] }).items[0]!;
    const [w, hh] = (f.outputs.size as { items: number[][] }).items[0]!;
    // origin = position − anchor × size × scale = [100 − 320, 200 − 320]; picture pixels scale by 320 / 640 × 2 = 1.
    expect(x).toBeGreaterThanOrEqual(-220);
    expect(y).toBeGreaterThanOrEqual(-120);
    expect(x + w).toBeLessThanOrEqual(-220 + 640 + 1e-9);
    expect(y + hh).toBeLessThanOrEqual(-120 + 640 + 1e-9);
    expect(w).toBeGreaterThan(0);

    h.step({ dt: 0.05 });
    expect(reads).toHaveLength(1);
    h.step({ dt: 0.05 });
    expect(reads).toHaveLength(2);
    reading = undefined;
    h.step({ dt: 0.1 });
    const blocked = h.step({ dt: 0.1 });
    expect(blocked.outputs).toMatchObject({ error: true, count: 1, errorMessage: "The layer's pixels can't be read yet, or the media blocks reading (CORS)." });
    const off = h.step({ inputs: { enabled: false } });
    expect(off.outputs).toMatchObject({ count: 0, available: true, error: false, errorMessage: "" });
  });

  it("reruns on a Mode change and warns once for layers that aren't pictures", () => {
    const runs: number[] = [];
    const h = createPatchHarness(objectDetectionPatch, {
      inputs: { layer: { layerId: "photo" } },
      services: { platform: { media: { close: () => {}, startRecording: () => {}, stopRecording: async () => null, readPixels: () => (runs.push(1), pixels(7)) } } as never },
    });
    const objects = h.step({ dt: 0.2 });
    h.step({ dt: 0.2 });
    const attention = h.step({ dt: 0.2, inputs: { mode: "attention" } });
    expect(attention.outputs.count).toBe(1);
    expect(objects.outputs.count as number).toBeLessThanOrEqual(3);
    expect(runs.length).toBe(3);

    const wrong = createPatchHarness(objectDetectionPatch, {
      inputs: { layer: { layerId: "box" } },
      services: { platform: { media: { close: () => {}, startRecording: () => {}, stopRecording: async () => null, readPixels: () => pixels(1) } } as never, layerInfo: () => ({ type: "text" }) as never },
    });
    expect(wrong.run(3).outputs).toMatchObject({ count: 0, available: true });
    expect(wrong.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("outputs idle values while muted", () => {
    const { definition, mute } = muteSwitch(objectDetectionPatch);
    const h = createPatchHarness(definition, { inputs: { layer: { layerId: "photo" } }, services: { platform: { media: { close: () => {}, startRecording: () => {}, stopRecording: async () => null, readPixels: () => pixels(1) } } as never } });
    mute(true);
    expect(h.step().outputs).toMatchObject({ regionDetected: false, count: 0, available: true, error: false });
  });
});
