import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, ease, loopOf } from "../infra/index.ts";
import { remap, remapProgress } from "./remap.ts";

describe("remap", () => {
  it("maps linearly and extrapolates unless clamped", () => {
    const h = createPatchHarness(remap, { inputs: { value: 0, fromStart: 0, fromEnd: 100, toStart: 10, toEnd: 20 } });
    expect(h.step().outputs.output).toBe(10);
    expect(h.step({ inputs: { value: 50 } }).outputs.output).toBe(15);
    expect(h.step({ inputs: { value: 200 } }).outputs.output).toBe(30);
    expect(h.step({ inputs: { clampToRange: true } }).outputs.output).toBe(20);
  });

  it("handles reversed ranges without special cases", () => {
    expect(createPatchHarness(remap, { inputs: { value: 25, fromStart: 100, fromEnd: 0 } }).step().outputs.output).toBe(0.75);
    expect(createPatchHarness(remap, { inputs: { value: 0.25, toStart: 1, toEnd: 0 } }).step().outputs.output).toBe(0.75);
  });

  it("acts as a step for a zero-width range", () => {
    expect(remapProgress(5, 5, 5, false, "linear")).toBe(1);
    expect(remapProgress(4.9, 5, 5, false, "cubicIn")).toBe(0);
  });

  it("eases inside the range and extrapolates straight outside it", () => {
    expect(remapProgress(0.5, 0, 1, false, "quadraticIn")).toBe(0.25);
    expect(remapProgress(0.3, 0, 1, false, "sinusoidalInOut")).toBeCloseTo(ease("sinusoidalInOut", 0.3), 12);
    expect(remapProgress(2, 0, 1, false, "quadraticIn")).toBe(2);
    expect(remapProgress(-1, 0, 1, false, "cubicOut")).toBe(-1);
  });

  it("interpolates vectors with variant defaults and colors clamped to 0–1", () => {
    expect(createPatchHarness(remap, { typeParam: "point", inputs: { value: 0.25 } }).step().outputs.output).toEqual([25, 25]);
    const color = createPatchHarness(remap, { typeParam: "color", inputs: { value: 0.5 } });
    expect(color.step().outputs.output).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
    expect(color.step({ inputs: { value: 2 } }).outputs.output).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(runPatch(remap, [{ value: 0.5 }], { typeParam: "size" }).frames[0]!.outputs.output).toEqual([150, 150]);
  });

  it("evaluates once per loop index", () => {
    expect(createPatchHarness(remap, { inputs: { value: loopOf([0, 0.5, 1]), toEnd: 10 } }).step().outputs.output).toEqual(loopOf([0, 5, 10]));
  });

  it("outputs 0 for a non-finite result and warns once", () => {
    const h = createPatchHarness(remap, { inputs: { value: 1e308, fromStart: 0, fromEnd: 1e-300 } });
    expect(h.run(2).outputs.output).toBe(0);
    expect(h.logs).toHaveLength(1);
  });
});
