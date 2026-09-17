import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { equals, withinTolerance } from "./equals.ts";

describe("equals", () => {
  it("compares numbers within an inclusive tolerance", () => {
    const h = createPatchHarness(equals);
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 2.1, value2: 2, tolerance: 0.1 } }).outputs.output).toBe(true);
    expect(h.step({ inputs: { value1: 2.2 } }).outputs.output).toBe(false);
    expect(h.step({ inputs: { tolerance: -0.2 } }).outputs.output).toBe(true);
  });

  it("absorbs floating-point error with no tolerance", () => {
    const h = createPatchHarness(equals, { inputs: { value1: 0.1 + 0.2, value2: 0.3, tolerance: 0 } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { value2: 0.3001 } }).outputs.output).toBe(false);
    expect(withinTolerance([1e12 + 0.0001], [1e12], 0)).toBe(true);
  });

  it("uses Euclidean distance for vector variants", () => {
    const h = createPatchHarness(equals, { typeParam: "point", inputs: { value1: [0, 0], value2: [6, 8], tolerance: 10 } });
    expect(h.step().outputs.output).toBe(true);
    expect(h.step({ inputs: { tolerance: 9.99 } }).outputs.output).toBe(false);
    const p3 = createPatchHarness(equals, { typeParam: "point3d", inputs: { value1: [1, 2, 3], value2: [1, 2, 3.05], tolerance: 0.05 } });
    expect(p3.step().outputs.output).toBe(true);
  });

  it("evaluates once per loop index", () => {
    const h = createPatchHarness(equals, { inputs: { value1: loopOf([1, 2, 3]), value2: 2, tolerance: 0.5 } });
    expect(h.step().outputs.output).toEqual(loopOf([false, true, false]));
  });

  it("outputs false while muted", () => {
    expect(runPatch(equals, [{ value1: 1, value2: 1 }], { muted: true }).frames[0]!.outputs.output).toBe(false);
  });
});
