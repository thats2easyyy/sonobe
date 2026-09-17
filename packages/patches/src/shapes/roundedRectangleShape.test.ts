import { squirclePath } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { roundedRectangleShape } from "./roundedRectangleShape.ts";

describe("roundedRectangleShape", () => {
  it("draws the Rectangle layer's corner geometry for the defaults", () => {
    const h = createPatchHarness(roundedRectangleShape);
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(0, 0, 100, 100, [16, 16, 16, 16], 0) });
    expect((h.output("shape") as { path: string }).path.startsWith("M 84 0 ")).toBe(true);
  });

  it("measures Position from Anchor", () => {
    const h = createPatchHarness(roundedRectangleShape, { inputs: { position: [10, 5], size: [158, 46], cornerRadius: 23, anchor: [0, 0] } });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(10, 5, 158, 46, [23, 23, 23, 23], 0) });
  });

  it("caps large radii at half the shorter side (pill ends)", () => {
    const h = createPatchHarness(roundedRectangleShape, { inputs: { size: [100, 40], cornerRadius: 500 } });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(0, 30, 100, 40, [500, 500, 500, 500], 0) });
    expect((h.output("shape") as { path: string }).path).toContain("a 20 20 0 0 1");
  });

  it("passes smoothing through, clamped to 0–1", () => {
    const h = createPatchHarness(roundedRectangleShape, { inputs: { cornerSmoothing: 0.6 } });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(0, 0, 100, 100, [16, 16, 16, 16], 0.6) });
    h.set({ cornerSmoothing: 5 });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(0, 0, 100, 100, [16, 16, 16, 16], 1) });
    h.set({ cornerSmoothing: -1 });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(0, 0, 100, 100, [16, 16, 16, 16], 0) });
  });

  it("uses unconnected Corner Radii when any value is above 0", () => {
    const h = createPatchHarness(roundedRectangleShape, {
      inputs: { position: [50, 20], size: [100, 40], cornerRadii: [0, 30, 10, 0], cornerSmoothing: 1 },
      connected: [],
    });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(0, 0, 100, 40, [0, 30, 10, 0], 1) });
    h.set({ cornerRadii: [0, 0, 0, 0] });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(0, 0, 100, 40, [16, 16, 16, 16], 1) });
  });

  it("always uses connected Corner Radii, even at all zeros", () => {
    const h = createPatchHarness(roundedRectangleShape, { inputs: { cornerRadii: [0, 0, 0, 0] }, connected: ["cornerRadii"] });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(0, 0, 100, 100, [0, 0, 0, 0], 0) });
  });

  it("outputs the empty shape for a zero or negative size component", () => {
    const h = createPatchHarness(roundedRectangleShape, { inputs: { size: [0, 50] } });
    expect(h.step().outputs.shape).toEqual({ path: "" });
    h.set({ size: [50, -1] });
    expect(h.step().outputs.shape).toEqual({ path: "" });
  });

  it("clamps the rectangle's edges to ±1,000,000", () => {
    const h = createPatchHarness(roundedRectangleShape, { inputs: { position: [999_990, 50] } });
    expect(h.step().outputs.shape).toEqual({ path: squirclePath(999_940, 0, 60, 100, [16, 16, 16, 16], 0) });
    h.set({ position: [5e6, 50] });
    expect(h.step().outputs.shape).toEqual({ path: "" });
  });

  it("warns once for a non-finite corner radius", () => {
    const h = createPatchHarness(roundedRectangleShape, { inputs: { cornerRadius: Number.NaN } });
    h.run(2);
    expect(h.output("shape")).toEqual({ path: squirclePath(0, 0, 100, 100, [0, 0, 0, 0], 0) });
    expect(h.logs.map((l) => l.message)).toEqual(["Rounded Rectangle Shape: Corner Radius isn't a finite number; using 0."]);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(roundedRectangleShape, { inputs: { cornerRadius: loopOf([0, 50]) } });
    expect(h.step().outputs.shape).toEqual(
      loopOf([{ path: squirclePath(0, 0, 100, 100, [0, 0, 0, 0], 0) }, { path: squirclePath(0, 0, 100, 100, [50, 50, 50, 50], 0) }]),
    );
  });
});
