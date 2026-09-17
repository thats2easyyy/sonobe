import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { point4dUnpack } from "./point4dUnpack.ts";

describe("point4dUnpack", () => {
  it("splits a 4D point into X, Y, Z, and W, starting at zeros", () => {
    const h = createPatchHarness(point4dUnpack);
    expect(h.step().outputs).toEqual({ x: 0, y: 0, z: 0, w: 0 });
    expect(h.step({ inputs: { value: [0.08, 4, 1, 20] } }).outputs).toEqual({ x: 0.08, y: 4, z: 1, w: 20 });
  });

  it("splits a color into straight RGBA channels from 0 to 1", () => {
    const h = createPatchHarness(point4dUnpack, { inputs: { value: { r: 1, g: 0.5, b: 0, a: 0.25 } } });
    expect(h.step().outputs).toEqual({ x: 1, y: 0.5, z: 0, w: 0.25 });
  });

  it("broadcasts a number to all four", () => {
    const h = createPatchHarness(point4dUnpack, { inputs: { value: 3 } });
    expect(h.step().outputs).toEqual({ x: 3, y: 3, z: 3, w: 3 });
  });

  it("turns a loop of 4D points into four loops", () => {
    const h = createPatchHarness(point4dUnpack, { inputs: { value: loopOf([[1, 2, 3, 4], [5, 6, 7, 8]]) } });
    expect(h.step().outputs).toEqual({ x: loopOf([1, 5]), y: loopOf([2, 6]), z: loopOf([3, 7]), w: loopOf([4, 8]) });
  });

  it("outputs 0 for a non-finite component and warns once", () => {
    const h = createPatchHarness(point4dUnpack, { id: "lift", inputs: { value: [1, 2, 3, Number.NEGATIVE_INFINITY] } });
    expect(h.step().outputs).toEqual({ x: 1, y: 2, z: 3, w: 0 });
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["lift: Value has a component that isn't a finite number, so it outputs 0"]);
  });
});
