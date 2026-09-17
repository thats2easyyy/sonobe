import type { Loop } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { smoothValue } from "./smoothValue.ts";

describe("smoothValue", () => {
  it("seeds with the first Value, so nothing glides from 0", () => {
    const frame = createPatchHarness(smoothValue, { inputs: { value: 10 } }).step();
    expect(frame.outputs.output).toBe(10);
    expect(frame.requestedNextFrame).toBe(false);
  });

  it("follows the per-frame formula at 60 fps", () => {
    const h = createPatchHarness(smoothValue, { inputs: { value: 0 } });
    h.step();
    expect(h.step({ inputs: { value: 1 } }).outputs.output as number).toBeCloseTo(0.6, 12);
    const second = h.step();
    expect(second.outputs.output as number).toBeCloseTo(0.84, 12);
    expect(second.requestedNextFrame).toBe(true);
  });

  it("smooths the same per second at 120 fps", () => {
    const after = (fps: 60 | 120) => {
      const h = createPatchHarness(smoothValue, { fps, inputs: { value: 0, risingHysteresis: 0.9 } });
      h.step();
      return h.run(fps / 4, { inputs: { value: 100 } }).outputs.output as number;
    };
    expect(after(60)).toBeCloseTo(after(120), 9);
  });

  it("uses Falling Hysteresis on the way down, and Rising when it's negative", () => {
    const fall = (fallingHysteresis: number) => {
      const h = createPatchHarness(smoothValue, { inputs: { value: 1, risingHysteresis: 0.5, fallingHysteresis } });
      h.step();
      return h.step({ inputs: { value: 0 } }).outputs.output as number;
    };
    expect(fall(0.9)).toBeCloseTo(0.9, 12);
    expect(fall(-1)).toBeCloseTo(0.5, 12);
    expect(fall(0)).toBe(0);
  });

  it("passes Value through at hysteresis 0 and freezes at 1", () => {
    const h0 = createPatchHarness(smoothValue, { inputs: { value: 0, risingHysteresis: 0 } });
    h0.step();
    expect(h0.step({ inputs: { value: 7 } }).outputs.output).toBe(7);
    const h1 = createPatchHarness(smoothValue, { inputs: { value: 0, risingHysteresis: 1 } });
    h1.step();
    expect(h1.run(30, { inputs: { value: 7 } }).outputs.output).toBe(0);
  });

  it("jumps to Value on Reset", () => {
    const h = createPatchHarness(smoothValue, { inputs: { value: 0, risingHysteresis: 0.95 } });
    h.step();
    h.run(3, { inputs: { value: 50 } });
    expect(h.step({ pulses: ["reset"] }).outputs.output).toBe(50);
  });

  it("snaps once converged and stops requesting frames", () => {
    const h = createPatchHarness(smoothValue, { inputs: { value: 0 } });
    h.step();
    const frame = h.run(60, { inputs: { value: 1 } });
    expect(frame.outputs.output).toBe(1);
    expect(frame.requestedNextFrame).toBe(false);
  });

  it("holds its output for a non-finite Value and warns once", () => {
    const h = createPatchHarness(smoothValue, { inputs: { value: 4 } });
    h.step();
    expect(h.run(3, { inputs: { value: Number.NaN } }).outputs.output).toBe(4);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    expect(createPatchHarness(smoothValue, { inputs: { value: Number.NaN } }).step().outputs.output).toBe(0);
  });

  it("keeps per-index state for loops", () => {
    const h = createPatchHarness(smoothValue, { inputs: { value: loopOf([0, 10]) } });
    h.step();
    const items = (h.step({ inputs: { value: loopOf([1, 10, 3]) } }).outputs.output as Loop<number>).items;
    expect(items[0]).toBeCloseTo(0.6, 12);
    expect(items[1]).toBe(10);
    expect(items[2]).toBe(3);
  });
});
