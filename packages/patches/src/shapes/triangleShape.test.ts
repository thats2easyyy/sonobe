import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { triangleShape } from "./triangleShape.ts";

describe("triangleShape", () => {
  it("draws the default upward triangle from First to Second to Third Point", () => {
    const h = createPatchHarness(triangleShape);
    expect(h.step().outputs.shape).toEqual({ path: "M50 0 L100 100 L0 100 Z" });
  });

  it("follows the point order and rounds coordinates", () => {
    const h = createPatchHarness(triangleShape, { inputs: { firstPoint: [5, 12], secondPoint: [19, 12], thirdPoint: [12.00049, 17.5] } });
    expect(h.step().outputs.shape).toEqual({ path: "M5 12 L19 12 L12 17.5 Z" });
  });

  it("still outputs degenerate triangles", () => {
    const h = createPatchHarness(triangleShape, { inputs: { firstPoint: [0, 0], secondPoint: [50, 0], thirdPoint: [100, 0] } });
    expect(h.step().outputs.shape).toEqual({ path: "M0 0 L50 0 L100 0 Z" });
    h.set({ secondPoint: [0, 0], thirdPoint: [0, 0] });
    expect(h.step().outputs.shape).toEqual({ path: "M0 0 L0 0 L0 0 Z" });
  });

  it("reads non-finite points as 0 and warns once", () => {
    const h = createPatchHarness(triangleShape, { inputs: { thirdPoint: [Number.NaN, 100] } });
    h.run(3);
    expect(h.output("shape")).toEqual({ path: "M50 0 L100 100 L0 100 Z" });
    expect(h.logs.map((l) => l.message)).toEqual(["Triangle Shape: Third Point isn't a finite number; using 0."]);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(triangleShape, { inputs: { thirdPoint: loopOf([[0, 100], [100, 0]]) } });
    expect(h.step().outputs.shape).toEqual(loopOf([{ path: "M50 0 L100 100 L0 100 Z" }, { path: "M50 0 L100 100 L100 0 Z" }]));
  });
});
