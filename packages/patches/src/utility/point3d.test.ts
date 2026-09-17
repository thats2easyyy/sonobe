import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { point3d } from "./point3d.ts";

describe("point3d", () => {
  it("packs X, Y, and Z in order, starting at [0, 0, 0]", () => {
    const h = createPatchHarness(point3d);
    expect(h.step().outputs.output).toEqual([0, 0, 0]);
    expect(h.step({ inputs: { x: 1.12, y: 0.88, z: 1 } }).outputs.output).toEqual([1.12, 0.88, 1]);
  });

  it("reads wired values as numbers and never clamps", () => {
    const h = createPatchHarness(point3d, { inputs: { x: false, y: "-2.5", z: [9, 4] } });
    expect(h.step().outputs.output).toEqual([0, -2.5, 9]);
  });

  it("gives one point per index of the longest loop", () => {
    const h = createPatchHarness(point3d, { inputs: { x: loopOf([1, 2, 3]), y: 5, z: 6 } });
    expect(h.step().outputs.output).toEqual(loopOf([[1, 5, 6], [2, 5, 6], [3, 5, 6]]));
  });

  it("uses 0 for a non-finite component and warns once", () => {
    const h = createPatchHarness(point3d, { id: "squash", inputs: { z: Number.POSITIVE_INFINITY } });
    expect(h.step().outputs.output).toEqual([0, 0, 0]);
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["squash: a component isn't a finite number, so Point 3D uses 0 for it"]);
  });
});
