import { buildDoc, createTestRuntime } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { hitChrome, resizeCursor, selectionChrome } from "./handles.ts";
import { buildCanvasIndex } from "./sceneIndex.ts";

const doc = buildDoc({
  layers: [
    { id: "card", type: "rectangle", props: { position: [10, 20], size: [100, 50] } },
    { id: "tilted", type: "rectangle", props: { position: [200, 200], size: [60, 60], rotation: 90 } },
    { id: "tiny", type: "rectangle", props: { position: [300, 300], size: [8, 8] } },
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
