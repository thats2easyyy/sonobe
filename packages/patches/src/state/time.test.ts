import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { timePatch } from "./time.ts";

describe("time", () => {
  it("follows the prototype clock from 0", () => {
    const h = createPatchHarness(timePatch);
    const frame0 = h.step();
    expect(frame0.outputs).toEqual({ time: 0, frame: 0 });
    expect(frame0.requestedNextFrame).toBe(true);
    const later = h.run(90);
    expect(later.outputs.frame).toBe(90);
    expect(later.outputs.time).toBeCloseTo(1.5, 9);
  });

  it("holds while disabled and jumps to the clock when re-enabled", () => {
    const h = createPatchHarness(timePatch, { inputs: { enabled: false } });
    expect(h.run(10).outputs).toEqual({ time: 0, frame: 0 });
    h.step({ inputs: { enabled: true } });
    expect(h.output("frame")).toBe(10);
    const held = h.step({ inputs: { enabled: false } });
    expect(held.requestedNextFrame).toBe(false);
    expect(h.run(20).outputs.frame).toBe(10);
    expect(h.step({ inputs: { enabled: true } }).outputs.frame).toBe(32);
  });

  it("holds a pair per loop index", () => {
    const h = createPatchHarness(timePatch, { inputs: { enabled: loopOf([true, false]) } });
    h.run(3);
    expect(h.output("frame")).toEqual(loopOf([2, 0]));
  });

  it("returns to 0 on restart and outputs 0 while muted", () => {
    const h = createPatchHarness(timePatch);
    h.run(5);
    h.restart();
    expect(h.step().outputs).toEqual({ time: 0, frame: 0 });
    const muted = runPatch(timePatch, [{}, {}, {}], { muted: true });
    expect(muted.frames[2]!.outputs).toEqual({ time: 0, frame: 0 });
  });
});
