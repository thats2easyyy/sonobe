import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { edgesUnpack } from "./edgesUnpack.ts";

describe("edgesUnpack", () => {
  it("splits an Edges value into top, right, bottom, and left, starting at zeros", () => {
    const h = createPatchHarness(edgesUnpack);
    expect(h.step().outputs).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(h.step({ inputs: { value: [59, 0, 34, 0] } }).outputs).toEqual({ top: 59, right: 0, bottom: 34, left: 0 });
  });

  it("broadcasts a number and never applies CSS shorthand expansion", () => {
    const h = createPatchHarness(edgesUnpack, { inputs: { value: 12 } });
    expect(h.step().outputs).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
    h.set({ value: [8, 16] });
    expect(h.step().outputs).toEqual({ top: 8, right: 16, bottom: 0, left: 0 });
  });

  it("passes negative sides through and loops per index", () => {
    const h = createPatchHarness(edgesUnpack, { inputs: { value: loopOf([[-1, 2, 3, 4], [5, 6, 7, 8]]) } });
    expect(h.step().outputs).toEqual({ top: loopOf([-1, 5]), right: loopOf([2, 6]), bottom: loopOf([3, 7]), left: loopOf([4, 8]) });
  });

  it("outputs 0 for a non-finite side and warns once", () => {
    const h = createPatchHarness(edgesUnpack, { id: "sides", inputs: { value: [Number.NaN, 2, 3, 4] } });
    expect(h.step().outputs).toEqual({ top: 0, right: 2, bottom: 3, left: 4 });
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["sides: Value has a side that isn't a finite number, so it outputs 0"]);
  });
});
