import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { progress } from "./progress.ts";

const measure = (inputs: Record<string, unknown>) => createPatchHarness(progress, { inputs }).step().outputs.progress;

describe("progress", () => {
  it("measures where Value sits between Start and End, unclamped", () => {
    expect(measure({ value: 150, start: 100, end: 200 })).toBe(0.5);
    expect(measure({ value: 250, start: 100, end: 200 })).toBe(1.5);
    expect(measure({ value: 0, start: 100, end: 200 })).toBe(-1);
  });

  it("reverses for a reversed range", () => {
    expect(measure({ value: 0, start: 100, end: 0 })).toBe(1);
    expect(measure({ value: 25, start: 100, end: 0 })).toBe(0.75);
  });

  it("acts as a step for a zero-width range", () => {
    expect(measure({ value: 5, start: 5, end: 5 })).toBe(1);
    expect(measure({ value: 4.9, start: 5, end: 5 })).toBe(0);
  });

  it("clamps to 0–1 with Clamp to Range", () => {
    expect(measure({ value: 250, start: 100, end: 200, clampToRange: true })).toBe(1);
    expect(measure({ value: -3, start: 100, end: 200, clampToRange: true })).toBe(0);
  });

  it("outputs 0 for non-finite inputs and warns once", () => {
    const h = createPatchHarness(progress, { inputs: { value: Number.POSITIVE_INFINITY, start: 0, end: 1 } });
    expect(h.step().outputs.progress).toBe(0);
    h.run(2);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("broadcasts loops", () => {
    expect(measure({ value: loopOf([0, 5, 10]), start: 0, end: 10 })).toEqual(loopOf([0, 0.5, 1]));
  });

  it("passes Value through while muted", () => {
    expect(runPatch(progress, [{ value: 42, start: 0, end: 100 }], { muted: true }).frames[0]!.outputs.progress).toBe(42);
  });
});
