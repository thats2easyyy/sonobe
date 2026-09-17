import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { circleShape } from "./circleShape.ts";
import { ovalShape } from "./ovalShape.ts";

describe("ovalShape", () => {
  it("draws the default oval (a circle filling a 100 × 100 layer)", () => {
    const h = createPatchHarness(ovalShape);
    expect(h.step().outputs.shape).toEqual({ path: "M50 0 A50 50 0 0 1 100 50 A50 50 0 0 1 50 100 A50 50 0 0 1 0 50 A50 50 0 0 1 50 0 Z" });
  });

  it("draws elliptical quarter arcs clockwise from the top center", () => {
    const h = createPatchHarness(ovalShape, { inputs: { size: [100, 60] } });
    expect(h.step().outputs.shape).toEqual({ path: "M50 20 A50 30 0 0 1 100 50 A50 30 0 0 1 50 80 A50 30 0 0 1 0 50 A50 30 0 0 1 50 20 Z" });
  });

  it("matches Circle Shape's text for equal width and height at the same center", () => {
    const inputs = { position: [30, 40], anchor: [0.2, 0.7] };
    const oval = createPatchHarness(ovalShape, { inputs: { ...inputs, size: [20, 20] } });
    const circle = createPatchHarness(circleShape, { inputs: { ...inputs, radius: 10 } });
    expect(oval.step().outputs.shape).toEqual(circle.step().outputs.shape);
  });

  it("uses Position as the top-left corner with Anchor [0, 0]", () => {
    const h = createPatchHarness(ovalShape, { inputs: { position: [0, 0], size: [40, 20], anchor: [0, 0] } });
    expect(h.step().outputs.shape).toEqual({ path: "M20 0 A20 10 0 0 1 40 10 A20 10 0 0 1 20 20 A20 10 0 0 1 0 10 A20 10 0 0 1 20 0 Z" });
  });

  it("outputs the empty shape for a zero or negative size component", () => {
    const h = createPatchHarness(ovalShape, { inputs: { size: [100, 0] } });
    expect(h.step().outputs.shape).toEqual({ path: "" });
    h.set({ size: [-5, 10] });
    expect(h.step().outputs.shape).toEqual({ path: "" });
    expect(h.logs).toEqual([]);
  });

  it("reads a non-finite position as 0 and warns once", () => {
    const h = createPatchHarness(ovalShape, { inputs: { position: [Number.NaN, 50] } });
    h.run(2);
    expect(h.output("shape")).toEqual({ path: "M0 0 A50 50 0 0 1 50 50 A50 50 0 0 1 0 100 A50 50 0 0 1 -50 50 A50 50 0 0 1 0 0 Z" });
    expect(h.logs.map((l) => l.message)).toEqual(["Oval Shape: Position isn't a finite number; using 0."]);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(ovalShape, { inputs: { size: loopOf([[20, 10], [0, 0], [10, 10]]), position: [10, 10] } });
    const frame = h.step();
    expect(frame.loopCount).toBe(3);
    expect(frame.outputs.shape).toEqual(
      loopOf([
        { path: "M10 5 A10 5 0 0 1 20 10 A10 5 0 0 1 10 15 A10 5 0 0 1 0 10 A10 5 0 0 1 10 5 Z" },
        { path: "" },
        { path: "M10 5 A5 5 0 0 1 15 10 A5 5 0 0 1 10 15 A5 5 0 0 1 5 10 A5 5 0 0 1 10 5 Z" },
      ]),
    );
  });
});
