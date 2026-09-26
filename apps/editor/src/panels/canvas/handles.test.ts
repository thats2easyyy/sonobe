import { buildDoc, createTestRuntime } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { hitChrome, resizeCursor, selectionChrome } from "./handles.ts";
import { buildCanvasIndex } from "./sceneIndex.ts";

const doc = buildDoc({
  layers: [
    { id: "card", type: "rectangle", props: { position: [10, 20], size: [100, 50] } },
    { id: "tilted", type: "rectangle", props: { position: [200, 200], size: [60, 60], rotation: 90 } },
    { id: "tiny", type: "rectangle", props: { position: [300, 300], size: [8, 8] } },
    { id: "dotA", type: "rectangle", props: { position: [400, 400], size: [6, 6] } },
    { id: "dotB", type: "rectangle", props: { position: [410, 400], size: [6, 6] } },
  ],
});
const rt = createTestRuntime(doc);
const index = buildCanvasIndex(doc.components.main, rt.step());
const vp = { x: 40, y: 30, zoom: 2 };

describe("selectionChrome", () => {
  it("frames a single layer in screen space with 8 handles and a knob", () => {
    const chrome = selectionChrome(index, ["card"], vp, { resizable: true, rotatable: true })!;
    expect(chrome.single).toBe("card");
    expect(chrome.quad).toEqual([[60, 70], [260, 70], [260, 170], [60, 170]]);
    expect(chrome.handles).toHaveLength(8);
    expect(chrome.handles.find((h) => h.handle === "e")!.point).toEqual([260, 120]);
    expect(chrome.knob).toEqual({ base: [160, 70], point: [160, 48] });
    expect(chrome.sizeLabel).toBe("100 × 50");
  });

  it("shows only corners for small layers and hides handles when locked", () => {
    expect(selectionChrome(index, ["tiny"], vp, { resizable: true, rotatable: true })!.handles.map((h) => h.handle)).toEqual(["nw", "ne", "se", "sw"]);
    const locked = selectionChrome(index, ["card"], vp, { resizable: false, rotatable: false })!;
    expect(locked.handles).toEqual([]);
    expect(locked.knob).toBeNull();
  });

  it("thins the chrome as the layer shrinks on screen: outline, corners, all eight, then the knob", () => {
    const at = (zoom: number, ids: string[] = ["card"]) => selectionChrome(index, ids, { x: 0, y: 0, zoom }, { resizable: true, rotatable: true })!;
    // The card is 50 pt on its short side.
    const sizes = [0.2, 0.3, 0.5, 0.8, 1].map((zoom) => ({ side: 50 * zoom, handles: at(zoom).handles.length, knob: at(zoom).knob !== null }));
    expect(sizes).toEqual([
      { side: 10, handles: 0, knob: false },
      { side: 15, handles: 4, knob: false },
      { side: 25, handles: 4, knob: false },
      { side: 40, handles: 8, knob: true },
      { side: 50, handles: 8, knob: true },
    ]);
    expect(at(0.2).minSide).toBe(10);
  });

  it("gives a multi-selection the same tiers", () => {
    const at = (zoom: number) => selectionChrome(index, ["dotA", "dotB"], { x: 0, y: 0, zoom }, { resizable: true, rotatable: true })!;
    // Together they are 16 × 6 pt: the short side decides.
    expect(at(1).handles).toHaveLength(0);
    expect(at(3).handles.map((h) => h.handle)).toEqual(["nw", "ne", "se", "sw"]);
    expect(at(6).handles).toHaveLength(8);
    expect(at(6).knob).toBeNull();
  });

  it("frames a multi-selection with its bounds", () => {
    const chrome = selectionChrome(index, ["card", "tiny"], { x: 0, y: 0, zoom: 1 }, { resizable: true, rotatable: true })!;
    expect(chrome.single).toBeNull();
    expect(chrome.bounds).toEqual({ x: 10, y: 20, width: 298, height: 288 });
    expect(chrome.knob).toBeNull();
    expect(chrome.handles).toHaveLength(8);
  });

  it("reports on-screen rotation", () => {
    const chrome = selectionChrome(index, ["tilted"], { x: 0, y: 0, zoom: 1 }, { resizable: true, rotatable: true })!;
    expect(chrome.angle).toBeCloseTo(90);
    // Rotated 90° about its center (230, 230), the top edge faces right (x = 260); the knob sits 22px past it.
    expect(chrome.knob!.point[0]).toBeCloseTo(282);
    expect(chrome.knob!.point[1]).toBeCloseTo(230);
  });
});

describe("hitChrome", () => {
  const chrome = selectionChrome(index, ["card"], vp, { resizable: true, rotatable: true })!;

  it("finds handles, the knob, and the rotate zones outside corners", () => {
    expect(hitChrome(chrome, [262, 118])).toEqual({ kind: "resize", handle: "e" });
    expect(hitChrome(chrome, [160, 49])).toEqual({ kind: "rotate" });
    expect(hitChrome(chrome, [270, 180])).toEqual({ kind: "rotate" });
    // Inside the box near a corner is not a rotate zone.
    expect(hitChrome(chrome, [250, 160])).toBeNull();
    expect(hitChrome(chrome, [160, 120])).toBeNull();
  });

  it("reaches less far on a small selection, and finds no rotate zones without a knob", () => {
    const small = selectionChrome(index, ["card"], { x: 0, y: 0, zoom: 0.3 }, { resizable: true, rotatable: true })!;
    // 30 × 15 px: corners only, and a reach of a third of the short side (5 px, not 6).
    expect(small.minSide).toBe(15);
    expect(hitChrome(small, [3 + 4.9, 6])).toEqual({ kind: "resize", handle: "nw" });
    expect(hitChrome(small, [3 + 5.5, 6])).toBeNull();
    expect(hitChrome(small, [3 - 8, 6 - 8])).toBeNull();
  });
});

describe("resizeCursor", () => {
  it("turns with the layer", () => {
    expect(resizeCursor("e", 0)).toBe("ew-resize");
    expect(resizeCursor("se", 0)).toBe("nwse-resize");
    expect(resizeCursor("ne", 0)).toBe("nesw-resize");
    expect(resizeCursor("e", 90)).toBe("ns-resize");
    expect(resizeCursor("n", 45)).toBe("nesw-resize");
  });
});
