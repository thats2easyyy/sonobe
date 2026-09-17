import type { Loop } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { repeatingAnimation } from "./repeatingAnimation.ts";

const linear = { duration: 1, curve: "linear" };

describe("repeatingAnimation", () => {
  it("swings 0 → 1 → 0 when mirrored", () => {
    const h = createPatchHarness(repeatingAnimation, { inputs: linear });
    expect(h.step().outputs.progress).toBe(0);
    expect(h.run(30).outputs.progress as number).toBeCloseTo(0.5, 9);
    expect(h.run(30).outputs.progress as number).toBeCloseTo(1, 9);
    expect(h.run(30).outputs.progress as number).toBeCloseTo(0.5, 9);
    expect(h.run(30).outputs.progress as number).toBeCloseTo(0, 9);
  });

  it("jumps back to 0 after each trip when not mirrored", () => {
    const h = createPatchHarness(repeatingAnimation, { inputs: { ...linear, mirrored: false } });
    h.step();
    const values = Array.from({ length: 90 }, () => h.step().outputs.progress as number);
    expect(values[29]).toBeCloseTo(0.5, 9);
    const drops = values.map((v, i) => (i > 0 && v < values[i - 1]! - 0.5 ? i + 1 : -1)).filter((i) => i >= 0);
    expect(drops).toHaveLength(1);
    expect([60, 61]).toContain(drops[0]);
  });

  it("applies the curve to each trip, reversed on the way back", () => {
    const h = createPatchHarness(repeatingAnimation, { inputs: { duration: 1, curve: "quadraticIn" } });
    h.step();
    expect(h.run(15).outputs.progress as number).toBeCloseTo(0.0625, 9);
    expect(h.run(90).outputs.progress as number).toBeCloseTo(0.0625, 9);
  });

  it("holds while disabled and resets on a pulse even while disabled", () => {
    const h = createPatchHarness(repeatingAnimation, { inputs: linear });
    h.step();
    h.run(30);
    const paused = h.run(10, { inputs: { enabled: false } });
    expect(paused.outputs.progress as number).toBeCloseTo(0.5, 9);
    expect(paused.requestedNextFrame).toBe(false);
    expect(h.step({ pulses: ["reset"] }).outputs.progress).toBe(0);
    expect(h.run(10).outputs.progress).toBe(0);
    const resumed = h.run(15, { inputs: { enabled: true } });
    expect(resumed.outputs.progress as number).toBeCloseTo(15 / 60, 9);
    expect(resumed.requestedNextFrame).toBe(true);
  });

  it("offsets the cycle with Time Offset", () => {
    expect(createPatchHarness(repeatingAnimation, { inputs: { ...linear, timeOffset: 0.25 } }).step().outputs.progress).toBe(0.25);
    expect(createPatchHarness(repeatingAnimation, { inputs: { ...linear, timeOffset: loopOf([0, 0.5, 1.5]) } }).step().outputs.progress).toEqual(
      loopOf([0, 0.5, 0.5]),
    );
  });

  it("matches at 60 and 120 fps", () => {
    const at = (fps: 60 | 120) => {
      const h = createPatchHarness(repeatingAnimation, { fps, inputs: { duration: 0.8 } });
      h.step();
      return h.run(fps * 1.3).outputs.progress as number;
    };
    expect(at(60)).toBeCloseTo(at(120), 9);
  });

  it.each([0, -1, Number.NaN])("outputs 0 and warns once when Duration is %d", (duration) => {
    const h = createPatchHarness(repeatingAnimation, { inputs: { duration } });
    h.step();
    expect(h.run(5).outputs.progress).toBe(0);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("keeps a phase per loop index", () => {
    const h = createPatchHarness(repeatingAnimation, { inputs: { ...linear, duration: loopOf([1, 0.5]) } });
    h.step();
    const items = (h.run(15).outputs.progress as Loop<number>).items;
    expect(items[0]).toBeCloseTo(0.25, 9);
    expect(items[1]).toBeCloseTo(0.5, 9);
  });

  it("outputs 0 while muted", () => {
    const result = runPatch(repeatingAnimation, [{ duration: 1 }, {}, {}], { muted: true });
    expect(result.frames.map((f) => f.outputs.progress)).toEqual([0, 0, 0]);
  });
});
