import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { pointUnpack } from "./pointUnpack.ts";

describe("pointUnpack", () => {
  it("splits a point into X and Y, starting at 0, 0", () => {
    const h = createPatchHarness(pointUnpack);
    expect(h.step().outputs).toEqual({ x: 0, y: 0 });
    expect(h.step({ inputs: { value: [201, -30] } }).outputs).toEqual({ x: 201, y: -30 });
  });

  it("reads a number as [n, n] and a size as two numbers", () => {
    const h = createPatchHarness(pointUnpack, { inputs: { value: 5 } });
    expect(h.step().outputs).toEqual({ x: 5, y: 5 });
    h.set({ value: { width: 100, height: 50 } });
    expect(h.step().outputs).toEqual({ x: 100, y: 50 });
  });

  it("turns a loop of points into two loops of numbers with the same length and order", () => {
    const h = createPatchHarness(pointUnpack, { inputs: { value: loopOf([[1, 2], [3, 4], [5, 6]]) } });
    expect(h.step().outputs).toEqual({ x: loopOf([1, 3, 5]), y: loopOf([2, 4, 6]) });
  });

  it("outputs 0 for a non-finite component and warns once per index", () => {
    const h = createPatchHarness(pointUnpack, { id: "touch_xy", inputs: { value: loopOf([[Number.NaN, 2], [3, Number.POSITIVE_INFINITY]]) } });
    expect(h.step().outputs).toEqual({ x: loopOf([0, 3]), y: loopOf([2, 0]) });
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual([
      "touch_xy got a value that isn't a finite number and used 0",
      "touch_xy got a value that isn't a finite number and used 0",
    ]);
  });
});
