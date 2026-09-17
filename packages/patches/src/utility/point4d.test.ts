import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { point4d } from "./point4d.ts";

describe("point4d", () => {
  it("packs X, Y, Z, and W in order, starting at zeros", () => {
    const h = createPatchHarness(point4d);
    expect(h.step().outputs.output).toEqual([0, 0, 0, 0]);
    expect(h.step({ inputs: { x: 0.6, y: 0, z: 0.94, w: 32 } }).outputs.output).toEqual([0.6, 0, 0.94, 32]);
  });

  it("never clamps, even when the output is meant for a color", () => {
    const h = createPatchHarness(point4d, { inputs: { x: 2, y: -1, z: 0.5, w: 300 } });
    expect(h.step().outputs.output).toEqual([2, -1, 0.5, 300]);
  });

  it("evaluates per loop index with wrap-around", () => {
    const h = createPatchHarness(point4d, { inputs: { x: loopOf([1, 2, 3]), w: loopOf([7, 8]) } });
    expect(h.step().outputs.output).toEqual(loopOf([[1, 0, 0, 7], [2, 0, 0, 8], [3, 0, 0, 7]]));
  });

  it("uses 0 for a non-finite component and warns once", () => {
    const h = createPatchHarness(point4d, { id: "look", inputs: { w: Number.NaN } });
    expect(h.step().outputs.output).toEqual([0, 0, 0, 0]);
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["look: a component isn't a finite number, so Point 4D uses 0 for it"]);
  });
});
