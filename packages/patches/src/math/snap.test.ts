import { DECELERATION_FAST, DECELERATION_NORMAL, decayFinalPosition } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { snap, snapItem } from "./snap.ts";

describe("snap", () => {
  it("snaps to the nearest step, with halves rounding away from the offset", () => {
    const h = createPatchHarness(snap, { inputs: { value: 130 } });
    expect(h.step().outputs).toEqual({ output: 100, index: 1, projected: 130 });
    expect(h.step({ inputs: { value: 150 } }).outputs).toEqual({ output: 200, index: 2, projected: 150 });
    expect(h.step({ inputs: { value: -150 } }).outputs).toEqual({ output: -200, index: -2, projected: -150 });
    expect(h.step({ inputs: { value: 130, offset: 20 } }).outputs.output).toBe(120);
    expect(h.step({ inputs: { step: -100, offset: 0 } }).outputs.output).toBe(100);
  });

  it("projects along the velocity with the engine's POP decay", () => {
    const normal = createPatchHarness(snap, { inputs: { value: 0, velocity: 1000 } }).step().outputs;
    expect(normal.projected).toBe(decayFinalPosition(0, 1000, DECELERATION_NORMAL));
    expect(normal.projected).toBeCloseTo(499, 9);
    expect(normal).toMatchObject({ output: 500, index: 5 });
    const fast = createPatchHarness(snap, { inputs: { value: 0, velocity: 1000, deceleration: "fast" } }).step().outputs;
    expect(fast.projected).toBe(decayFinalPosition(0, 1000, DECELERATION_FAST));
    expect(fast.output).toBe(100);
  });

  it("leaves an axis free when its step is 0", () => {
    expect(createPatchHarness(snap, { typeParam: "point", inputs: { value: [130, 42], step: [100, 0] } }).step().outputs).toEqual({ output: [100, 42], index: 1, projected: [130, 42] });
    expect(snapItem([42], [0], "step", [0], [0], [], "normal").index).toBe(0);
  });

  it("snaps to the nearest point, ties going to the lowest index", () => {
    const h = createPatchHarness(snap, { inputs: { value: 130, mode: "points" } });
    expect(h.step().outputs).toEqual({ output: 100, index: 1, projected: 130 });
    expect(h.step({ inputs: { value: 150 } }).outputs.index).toBe(1);
    const points = createPatchHarness(snap, { typeParam: "point", inputs: { value: [70, 60], mode: "points", points: loopOf([[0, 0], [100, 100]]) } });
    expect(points.step().outputs).toEqual({ output: [100, 100], index: 1, projected: [70, 60] });
    const empty = createPatchHarness(snap, { inputs: { value: 130, mode: "points", points: loopOf([]) } });
    expect(empty.step().outputs).toEqual({ output: 130, index: -1, projected: 130 });
  });

  it("uses the default points in a real runtime when Points isn't connected", () => {
    expect(runPatch(snap, [{ value: 180, mode: "points" }]).frames[0]!.outputs).toEqual({ output: 200, index: 2, projected: 180 });
  });

  it("zips looped inputs and snaps every item against the whole Points loop", () => {
    const h = createPatchHarness(snap, { inputs: { value: loopOf([30, 170, 260]), mode: loopOf(["step", "points", "step"]) } });
    expect(h.step().outputs).toEqual({ output: loopOf([0, 200, 300]), index: loopOf([0, 2, 3]), projected: loopOf([30, 170, 260]) });
    expect(createPatchHarness(snap, { inputs: { value: loopOf([]) } }).step().outputs).toEqual({ output: loopOf([]), index: loopOf([]), projected: loopOf([]) });
  });

  it("outputs 0 for a non-finite projection and warns once", () => {
    const h = createPatchHarness(snap, { inputs: { value: 1.5e308, velocity: 1e308 } });
    expect(h.run(2).outputs).toEqual({ output: 0, index: 0, projected: 0 });
    expect(h.logs).toHaveLength(1);
  });

  it("passes Value through while muted", () => {
    expect(runPatch(snap, [{ value: 130 }], { muted: true }).frames[0]!.outputs).toEqual({ output: 130, index: 0, projected: 130 });
  });
});
