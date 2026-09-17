import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { arcTransition } from "./arcTransition.ts";

const arc = (inputs: Record<string, unknown>, typeParam?: string) =>
  createPatchHarness(arcTransition, { inputs, ...(typeParam ? { typeParam } : {}) }).step().outputs.output;

describe("arcTransition", () => {
  it.each([
    [0, 1, 0, 0.25, 0.75],
    [0, 1, 0, 0.5, 1],
    [0, 1, 0, 1, 0],
    [1, 1.3, 1, 0.25, 1.225],
    [0, 1, 1, 0.75, 1.125],
    [0, 1, 0, 1.5, -3],
  ])("start %d, middle %d, end %d at %d → %d", (start, middle, end, progress, expected) => {
    expect(arc({ start, middle, end, progress }) as number).toBeCloseTo(expected, 12);
  });

  it("is exact at Progress 0 and 1", () => {
    expect(arc({ start: 0.3, middle: 9, end: 0.7, progress: 0 })).toBe(0.3);
    expect(arc({ start: 0.3, middle: 9, end: 0.7, progress: 1 })).toBe(0.7);
  });

  it("uses per-variant defaults", () => {
    expect(arc({ progress: 0.5 }, "point")).toEqual([100, -100]);
    expect(arc({ progress: 0.5 }, "size")).toEqual([140, 140]);
    expect(arc({ progress: 0.5 }, "color")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("clamps color channels", () => {
    expect(arc({ progress: 1.5 }, "color")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(arc({ progress: 1.5, start: "#000000FF", middle: "#FFFFFFFF", end: "#000000FF" }, "color")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("outputs 0 for non-finite parts and warns", () => {
    const h = createPatchHarness(arcTransition, { inputs: { progress: Number.NaN } });
    expect(h.step().outputs.output).toBe(0);
    expect(h.logs).toHaveLength(1);
  });

  it("evaluates loops per index", () => {
    expect(arc({ progress: loopOf([0, 0.5, 1]) })).toEqual(loopOf([0, 1, 0]));
  });

  it("passes Start through while muted", () => {
    expect(runPatch(arcTransition, [{ progress: 0.5, start: 4, middle: 8, end: 4 }], { muted: true }).frames[0]!.outputs.output).toBe(4);
  });
});
