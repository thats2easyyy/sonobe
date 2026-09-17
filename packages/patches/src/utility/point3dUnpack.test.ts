import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { point3dUnpack } from "./point3dUnpack.ts";

describe("point3dUnpack", () => {
  it("splits a 3D point into X, Y, and Z, starting at zeros", () => {
    const h = createPatchHarness(point3dUnpack);
    expect(h.step().outputs).toEqual({ x: 0, y: 0, z: 0 });
    expect(h.step({ inputs: { value: [20, -15, 4] } }).outputs).toEqual({ x: 20, y: -15, z: 4 });
  });

  it("broadcasts a number and reads JSON best-effort through core coercion", () => {
    const h = createPatchHarness(point3dUnpack, { inputs: { value: 5 } });
    expect(h.step().outputs).toEqual({ x: 5, y: 5, z: 5 });
    h.set({ value: { x: 1, y: 2, z: 3 } });
    expect(h.step().outputs).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("turns a loop of 3D points into three loops", () => {
    const h = createPatchHarness(point3dUnpack, { inputs: { value: loopOf([[1, 2, 3], [4, 5, 6]]) } });
    expect(h.step().outputs).toEqual({ x: loopOf([1, 4]), y: loopOf([2, 5]), z: loopOf([3, 6]) });
  });

  it("outputs 0 for a non-finite component and warns once", () => {
    const h = createPatchHarness(point3dUnpack, { id: "angles", inputs: { value: [1, Number.NaN, 3] } });
    expect(h.step().outputs).toEqual({ x: 1, y: 0, z: 3 });
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["angles: Value has a component that isn't a finite number, so it outputs 0"]);
  });
});
