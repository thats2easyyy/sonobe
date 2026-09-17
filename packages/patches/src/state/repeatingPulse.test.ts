import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import type { PatchHarness } from "../infra/index.ts";
import { repeatingPulsePatch } from "./repeatingPulse.ts";

/** Frame numbers that ticked over `frames` steps. */
function ticks(h: PatchHarness, frames: number, inputs?: Record<string, unknown>): number[] {
  const out: number[] = [];
  for (let i = 0; i < frames; i++) {
    const frame = h.step(i === 0 && inputs ? { inputs } : {});
    if (frame.pulses.has("tick")) out.push(frame.frame);
  }
  return out;
}

describe("repeatingPulse", () => {
  it("ticks every Interval, starting one interval after it begins", () => {
    const h = createPatchHarness(repeatingPulsePatch);
    const frame0 = h.step();
    expect(frame0.pulses.size).toBe(0);
    expect(frame0.requestedNextFrame).toBe(true);
    expect(ticks(h, 180)).toEqual([60, 120, 180]);
  });

  it("gives the same rhythm at 120 fps", () => {
    const h = createPatchHarness(repeatingPulsePatch, { fps: 120, inputs: { interval: 0.5 } });
    expect(ticks(h, 241)).toEqual([60, 120, 180, 240]);
  });

  it("ticks every active frame after the first for tiny or zero intervals", () => {
    expect(ticks(createPatchHarness(repeatingPulsePatch, { inputs: { interval: 0 } }), 4)).toEqual([1, 2, 3]);
    expect(ticks(createPatchHarness(repeatingPulsePatch, { inputs: { interval: 0.001 } }), 3)).toEqual([1, 2]);
  });

  it("pauses while disabled and resumes mid-interval without counting the enabling frame", () => {
    const h = createPatchHarness(repeatingPulsePatch, { inputs: { interval: 0.1 } });
    expect(ticks(h, 4)).toEqual([]);
    const paused = h.step({ inputs: { enabled: false } });
    expect(paused.requestedNextFrame).toBe(false);
    expect(ticks(h, 30)).toEqual([]);
    // 3 frames accrued before pausing; frame 35 re-enables without accruing, so 3 more frames tick on 38.
    expect(ticks(h, 4, { enabled: true })).toEqual([38]);
  });

  it("restarts the countdown on Reset and suppresses that frame's tick", () => {
    const h = createPatchHarness(repeatingPulsePatch, { inputs: { interval: 0.1 } });
    h.run(5);
    expect(h.step({ pulses: ["reset"] }).pulses.size).toBe(0);
    expect(ticks(h, 7)).toEqual([11]);
  });

  it("warns once for a non-finite interval and ticks every frame", () => {
    const h = createPatchHarness(repeatingPulsePatch, { inputs: { interval: Number.NaN } });
    expect(ticks(h, 3)).toEqual([1, 2]);
    expect(h.logs.map((l) => l.level)).toEqual(["warn"]);
  });

  it("keeps a metronome per loop index", () => {
    const h = createPatchHarness(repeatingPulsePatch, { inputs: { interval: loopOf([0.05, 0.1]) } });
    h.step();
    const items = Array.from({ length: 6 }, () => h.step().pulseItems.tick ?? [false, false]);
    expect(items).toEqual([
      [false, false],
      [false, false],
      [true, false],
      [false, false],
      [false, false],
      [true, true],
    ]);
  });

  it("starts over on restart", () => {
    const h = createPatchHarness(repeatingPulsePatch, { inputs: { interval: 0.05 } });
    h.run(2);
    h.restart();
    expect(ticks(h, 4)).toEqual([3]);
  });
});
