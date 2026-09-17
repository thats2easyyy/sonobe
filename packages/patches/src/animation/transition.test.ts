import type { Color } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { transition } from "./transition.ts";

const frame = (inputs: Record<string, unknown>, typeParam?: string) => {
  const h = createPatchHarness(transition, { inputs, ...(typeParam ? { typeParam } : {}) });
  return { output: h.step().outputs.output, logs: h.logs };
};

describe("transition", () => {
  it("blends Start to End without clamping", () => {
    expect(frame({ progress: 0.25, start: 10, end: 20 }).output).toBe(12.5);
    expect(frame({ progress: 1.5, start: 10, end: 20 }).output).toBe(25);
    expect(frame({ progress: -1, start: 10, end: 20 }).output).toBe(0);
  });

  it("is exact at Progress 0 and 1", () => {
    expect(frame({ progress: 0, start: 0.1, end: 0.7 }).output).toBe(0.1);
    expect(frame({ progress: 1, start: 0.1, end: 0.7 }).output).toBe(0.7);
  });

  it("defaults to a 0 → 1 range", () => {
    expect(frame({ progress: 0.3 }).output).toBe(0.3);
  });

  it("uses per-variant defaults", () => {
    expect(frame({ progress: 0.5 }, "point").output).toEqual([50, 50]);
    expect(frame({ progress: 0.5 }, "size").output).toEqual([150, 150]);
    expect(frame({ progress: 0.5 }, "color").output).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  });

  it("clamps color channels but not other variants", () => {
    const color = frame({ progress: 2 }, "color").output as Color;
    expect(color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(frame({ progress: 2 }, "point").output).toEqual([200, 200]);
    expect(frame({ progress: 2, start: [0, 0], end: [-10, 10] }, "size").output).toEqual([-20, 20]);
  });

  it("outputs Start for a non-finite Progress and warns once", () => {
    const h = createPatchHarness(transition, { inputs: { progress: Number.NaN, start: 3, end: 9 } });
    expect(h.step().outputs.output).toBe(3);
    h.run(3);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("outputs 0 for non-finite Start or End components", () => {
    const result = frame({ progress: 0.5, start: [0, Number.NaN], end: [10, 10] }, "point");
    expect(result.output).toEqual([5, 0]);
    expect(result.logs).toHaveLength(1);
  });

  it("broadcasts loops", () => {
    expect(frame({ progress: loopOf([0, 0.5, 1]), start: 0, end: loopOf([10, 20]) }).output).toEqual(loopOf([0, 10, 10]));
  });

  it("passes Start through while muted, even for the number variant", () => {
    const result = runPatch(transition, [{ progress: 0.7, start: 3, end: 9 }], { muted: true });
    expect(result.frames[0]!.outputs.output).toBe(3);
  });
});
