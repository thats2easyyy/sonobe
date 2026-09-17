import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { lineShape } from "./lineShape.ts";

const path = (h: { output(key: string): unknown }) => (h.output("shape") as { path: string }).path;

describe("lineShape", () => {
  it("draws the default horizontal line from Start Point to End Point", () => {
    const h = createPatchHarness(lineShape);
    h.step();
    expect(path(h)).toBe("M0 50 L100 50");
  });

  it("draws through Points when it has 2 or more valid points", () => {
    const h = createPatchHarness(lineShape, { inputs: { points: [[0, 80], [60, 20], [120, 50]] } });
    h.step();
    expect(path(h)).toBe("M0 80 L60 20 L120 50");
    h.set({ points: [{ x: 0, y: "10" }, { x: "5.5", y: 6 }] });
    h.step();
    expect(path(h)).toBe("M0 10 L5.5 6");
    expect(h.logs).toEqual([]);
  });

  it("parses JSON text", () => {
    const h = createPatchHarness(lineShape, { inputs: { points: "[[0,0],[10,10]]" } });
    h.step();
    expect(path(h)).toBe("M0 0 L10 10");
  });

  it("skips invalid items with one warning", () => {
    const h = createPatchHarness(lineShape, { inputs: { points: [[0, 0], "nope", [1], [10, 10]] } });
    h.run(3);
    expect(path(h)).toBe("M0 0 L10 10");
    expect(h.logs.map((l) => l.message)).toEqual(['Line Shape: some items in Points were skipped; make each one [x, y] or { "x": 10, "y": 20 } with numbers.']);
  });

  it("falls back to Start Point and End Point with fewer than 2 valid points", () => {
    const h = createPatchHarness(lineShape, { inputs: { points: [[5, 5]], startPoint: [1, 2], endPoint: [3, 4] } });
    h.step();
    expect(path(h)).toBe("M1 2 L3 4");
    h.set({ points: [] });
    h.step();
    expect(path(h)).toBe("M1 2 L3 4");
    h.set({ points: null });
    h.step();
    h.set({ points: "   " });
    h.step();
    expect(path(h)).toBe("M1 2 L3 4");
    expect(h.logs).toEqual([]);
  });

  it("warns once for text that isn't JSON and for values that aren't lists", () => {
    const h = createPatchHarness(lineShape, { inputs: { points: "not json" } });
    h.run(2);
    expect(path(h)).toBe("M0 50 L100 50");
    h.set({ points: { x: 1, y: 2 } });
    h.run(2);
    expect(path(h)).toBe("M0 50 L100 50");
    expect(h.logs.map((l) => l.message)).toEqual([
      "Line Shape: Points isn't valid JSON, so Start Point and End Point are used.",
      "Line Shape: Points isn't a list of points, so Start Point and End Point are used.",
    ]);
  });

  it("draws at most 10,000 points and warns once", () => {
    const points = Array.from({ length: 10_001 }, (_, i) => [i, 0]);
    const h = createPatchHarness(lineShape, { inputs: { points } });
    h.run(2);
    const text = path(h);
    expect(text.endsWith(" L9999 0")).toBe(true);
    expect(text.split(" L")).toHaveLength(10_000);
    expect(h.logs.map((l) => l.message)).toEqual(["Line Shape: Points has more than 10,000 items; only the first 10,000 are drawn."]);
  });

  it("joins the last point back to the first when Closed", () => {
    const h = createPatchHarness(lineShape, { inputs: { points: [[0, 0], [10, 0], [10, 10]], closed: true } });
    h.step();
    expect(path(h)).toBe("M0 0 L10 0 L10 10 L0 0 Z");
  });

  it("smooths with Catmull-Rom curves scaled by Smoothing", () => {
    const h = createPatchHarness(lineShape, { inputs: { points: [[0, 80], [60, 20], [120, 50]], smoothing: 1 } });
    h.step();
    expect(path(h)).toBe("M0 80 C10 70 40 25 60 20 C80 15 110 45 120 50");
    h.set({ smoothing: 0.5 });
    h.step();
    expect(path(h)).toBe("M0 80 C5 75 50 22.5 60 20 C70 17.5 115 47.5 120 50");
    h.set({ smoothing: 7 });
    h.step();
    expect(path(h)).toBe("M0 80 C10 70 40 25 60 20 C80 15 110 45 120 50");
  });

  it("keeps a two-point line straight at any smoothing", () => {
    const h = createPatchHarness(lineShape, { inputs: { startPoint: [0, 0], endPoint: [60, 0], smoothing: 1 } });
    h.step();
    expect(path(h)).toBe("M0 0 C10 0 50 0 60 0");
  });

  it("wraps neighbors around a closed smoothed line", () => {
    const h = createPatchHarness(lineShape, { inputs: { points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true, smoothing: 1 } });
    h.step();
    expect(path(h).startsWith("M0 0 C1.667 -1.667 8.333 -1.667 10 0 ")).toBe(true);
    expect(path(h).endsWith(" C-1.667 8.333 -1.667 1.667 0 0 Z")).toBe(true);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(lineShape, { inputs: { endPoint: loopOf([[10, 0], [0, 10]]), startPoint: [0, 0] } });
    expect(h.step().outputs.shape).toEqual(loopOf([{ path: "M0 0 L10 0" }, { path: "M0 0 L0 10" }]));
  });
});
