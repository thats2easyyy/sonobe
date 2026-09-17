import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { waitPatch } from "./wait.ts";

describe("wait", () => {
  it("is idle until started", () => {
    const h = createPatchHarness(waitPatch);
    const frame = h.run(5);
    expect(frame.outputs).toEqual({ done: false, progress: 0 });
    expect(frame.requestedNextFrame).toBe(false);
  });

  it("completes exactly Duration after Start, latching Done and pulsing Finished once", () => {
    const h = createPatchHarness(waitPatch);
    const start = h.step({ pulses: ["start"] });
    expect(start.outputs).toEqual({ done: false, progress: 0 });
    expect(start.requestedNextFrame).toBe(true);
    const frames = Array.from({ length: 62 }, () => h.step());
    expect(frames[29]!.outputs.progress).toBeCloseTo(0.5, 9);
    expect(frames[58]!.outputs.done).toBe(false);
    expect(frames[59]!.frame).toBe(60);
    expect(frames[59]!.outputs).toEqual({ done: true, progress: 1 });
    expect(frames.map((f) => f.pulses.has("finished")).filter(Boolean)).toHaveLength(1);
    expect(frames[59]!.pulses.has("finished")).toBe(true);
    expect(frames[61]!.outputs).toEqual({ done: true, progress: 1 });
    expect(frames[61]!.requestedNextFrame).toBe(false);
  });

  it("gives the same timing at 120 fps", () => {
    const h = createPatchHarness(waitPatch, { fps: 120 });
    h.step({ pulses: ["start"] });
    const frames = Array.from({ length: 121 }, () => h.step());
    expect(frames.findIndex((f) => f.outputs.done === true)).toBe(119);
  });

  it("lets Reset beat Start and never start the timer", () => {
    const h = createPatchHarness(waitPatch, { inputs: { duration: 0.1 } });
    h.step({ pulses: ["start", "reset"] });
    expect(h.run(20).outputs).toEqual({ done: false, progress: 0 });
    h.step({ pulses: ["start"] });
    h.run(3);
    expect(h.step({ pulses: ["reset"] }).outputs).toEqual({ done: false, progress: 0 });
    expect(h.run(20).outputs.done).toBe(false);
  });

  it("restarts from 0 on Start while running, with no Finished for the interrupted run", () => {
    const h = createPatchHarness(waitPatch, { inputs: { duration: 0.1 } });
    h.step({ pulses: ["start"] });
    h.run(4);
    h.step({ pulses: ["start"] });
    const frames = Array.from({ length: 6 }, () => h.step());
    expect(frames.map((f) => f.outputs.done)).toEqual([false, false, false, false, false, true]);
  });

  it("clears Done on Start after completion", () => {
    const h = createPatchHarness(waitPatch, { inputs: { duration: 0.05 } });
    h.step({ pulses: ["start"] });
    h.run(3);
    expect(h.output("done")).toBe(true);
    expect(h.step({ pulses: ["start"] }).outputs).toEqual({ done: false, progress: 0 });
  });

  it("reads Duration every frame while running", () => {
    const h = createPatchHarness(waitPatch, { inputs: { duration: 1 } });
    h.step({ pulses: ["start"] });
    h.run(12);
    const shortened = h.step({ inputs: { duration: 0.1 } });
    expect(shortened.outputs.done).toBe(true);
    expect(shortened.pulses.has("finished")).toBe(true);
    expect(h.step({ inputs: { duration: 5 } }).outputs).toEqual({ done: true, progress: 1 });
  });

  it("finishes on the Start frame when Duration is 0 or negative, and warns for non-finite durations", () => {
    for (const duration of [0, -1]) {
      const frame = createPatchHarness(waitPatch, { inputs: { duration } }).step({ pulses: ["start"] });
      expect(frame.outputs).toEqual({ done: true, progress: 1 });
      expect(frame.pulses.has("finished")).toBe(true);
    }
    const h = createPatchHarness(waitPatch, { inputs: { duration: Number.NaN } });
    expect(h.step({ pulses: ["start"] }).outputs.done).toBe(true);
    expect(h.logs.map((l) => l.level)).toEqual(["warn"]);
  });

  it("keeps a timer per loop index", () => {
    const h = createPatchHarness(waitPatch, { inputs: { duration: loopOf([0.05, 0.1]) } });
    h.step({ pulses: ["start"] });
    expect(h.run(3).outputs.done).toEqual(loopOf([true, false]));
    expect(h.run(3).outputs.done).toEqual(loopOf([true, true]));
  });

  it("returns to idle on restart", () => {
    const h = createPatchHarness(waitPatch, { inputs: { duration: 0 } });
    h.step({ pulses: ["start"] });
    h.restart();
    expect(h.step().outputs).toEqual({ done: false, progress: 0 });
  });

  it("outputs idle values while muted", () => {
    const result = runPatch(waitPatch, [{ start: true, duration: 0 }, {}], { muted: true });
    expect(result.frames.map((f) => [f.outputs.done, f.outputs.progress, f.pulses])).toEqual([
      [false, 0, []],
      [false, 0, []],
    ]);
  });
});
