import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { cornerRadiiUnpack } from "./cornerRadiiUnpack.ts";

describe("cornerRadiiUnpack", () => {
  it("splits radii clockwise from the top left, starting at zeros", () => {
    const h = createPatchHarness(cornerRadiiUnpack);
    expect(h.step().outputs).toEqual({ topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 });
    expect(h.step({ inputs: { value: [32, 28, 6, 4] } }).outputs).toEqual({ topLeft: 32, topRight: 28, bottomRight: 6, bottomLeft: 4 });
  });

  it("broadcasts a number to every corner and passes negative radii through", () => {
    const h = createPatchHarness(cornerRadiiUnpack, { inputs: { value: 16 } });
    expect(h.step().outputs).toEqual({ topLeft: 16, topRight: 16, bottomRight: 16, bottomLeft: 16 });
    h.set({ value: [-2, 0, 0, 0] });
    expect(h.step().outputs.topLeft).toBe(-2);
  });

  it("turns a loop of radii into four loops", () => {
    const h = createPatchHarness(cornerRadiiUnpack, { inputs: { value: loopOf([[1, 2, 3, 4], [5, 6, 7, 8]]) } });
    expect(h.step().outputs).toEqual({ topLeft: loopOf([1, 5]), topRight: loopOf([2, 6]), bottomRight: loopOf([3, 7]), bottomLeft: loopOf([4, 8]) });
  });

  it("outputs 0 for a non-finite radius and warns once", () => {
    const h = createPatchHarness(cornerRadiiUnpack, { id: "outer", inputs: { value: [1, 2, Number.NaN, 4] } });
    expect(h.step().outputs).toEqual({ topLeft: 1, topRight: 2, bottomRight: 0, bottomLeft: 4 });
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["outer: Value has a radius that isn't a finite number, so it outputs 0"]);
  });
});
