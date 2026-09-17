import type { Loop } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { velocity } from "./velocity.ts";

describe("velocity", () => {
  it("outputs 0 on the first frame, then units per second", () => {
    const h = createPatchHarness(velocity, { inputs: { value: 100 } });
    expect(h.step().outputs.velocity).toBe(0);
    expect(h.step({ inputs: { value: 101 } }).outputs.velocity as number).toBeCloseTo(60, 9);
    expect(h.step({ inputs: { value: 99 } }).outputs.velocity as number).toBeCloseTo(-120, 9);
  });

  it("drops to 0 on the frame after Value stops changing", () => {
    const h = createPatchHarness(velocity, { inputs: { value: 0 } });
    h.step();
    h.step({ inputs: { value: 5 } });
    expect(h.step().outputs.velocity).toBe(0);
  });

  it("measures the same motion the same at 60 and 120 fps", () => {
    const at = (fps: 60 | 120) => {
      const h = createPatchHarness(velocity, { fps, inputs: { value: 0 } });
      h.step();
      let x = 0;
      for (let i = 0; i < fps / 2; i++) h.step({ inputs: { value: (x += 30 / fps) } });
      return h.output("velocity") as number;
    };
    expect(at(60)).toBeCloseTo(30, 9);
    expect(at(120)).toBeCloseTo(30, 9);
  });

  it("measures each component of a point", () => {
    const h = createPatchHarness(velocity, { typeParam: "point", inputs: { value: [0, 0] } });
    expect(h.step().outputs.velocity).toEqual([0, 0]);
    const v = h.step({ inputs: { value: [3, -6] } }).outputs.velocity as number[];
    expect(v[0]).toBeCloseTo(180, 9);
    expect(v[1]).toBeCloseTo(-360, 9);
  });

  it("outputs 0 for a non-finite Value, keeps the last finite value, and warns once", () => {
    const h = createPatchHarness(velocity, { inputs: { value: 0 } });
    h.step();
    expect(h.step({ inputs: { value: Number.NaN } }).outputs.velocity).toBe(0);
    expect(h.step({ inputs: { value: Number.NaN } }).outputs.velocity).toBe(0);
    expect(h.step({ inputs: { value: 2 } }).outputs.velocity as number).toBeCloseTo(120, 9);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("keeps per-index history, and new indices start at 0", () => {
    const h = createPatchHarness(velocity, { inputs: { value: loopOf([0, 0]) } });
    h.step();
    const items = (h.step({ inputs: { value: loopOf([1, 2, 50]) } }).outputs.velocity as Loop<number>).items;
    expect(items[0]).toBeCloseTo(60, 9);
    expect(items[1]).toBeCloseTo(120, 9);
    expect(items[2]).toBe(0);
  });

  it("outputs 0 while muted instead of passing the position through", () => {
    const result = runPatch(velocity, [{ value: 5 }, { value: 10 }], { muted: true });
    expect(result.frames.map((f) => f.outputs.velocity)).toEqual([0, 0]);
  });

  it("holds its last velocity on frames with no time step", () => {
    const h = createPatchHarness(velocity, { inputs: { value: 0 } });
    h.step();
    h.step({ inputs: { value: 1 } });
    expect(h.step({ inputs: { value: 4 }, dt: 0 }).outputs.velocity as number).toBeCloseTo(60, 9);
    expect(h.step({ inputs: { value: 5 } }).outputs.velocity as number).toBeCloseTo(240, 9);
  });
});
