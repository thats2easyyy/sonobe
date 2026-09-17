import { describe, expect, it } from "vitest";
import { tap } from "@sonobe/engine/testing";
import { loopOf } from "../infra/index.ts";
import { doubleTap } from "./doubleTap.ts";
import { createInteractionRig } from "./testing.ts";

function pulsedFrames(frames: { frame: number; pulses: ReadonlySet<string> }[], key: string): number[] {
  return frames.filter((f) => f.pulses.has(key)).map((f) => f.frame);
}

describe("doubleTap", () => {
  it("fires Double Tap on the second tap within Interval", () => {
    const r = createInteractionRig(doubleTap, { inputs: { interval: 0.3 } });
    const frames = [r.step(), r.step({ pulses: ["tap"] }), ...Array.from({ length: 10 }, () => r.step()), r.step({ pulses: ["tap"] }), ...Array.from({ length: 30 }, () => r.step())];
    expect(pulsedFrames(frames, "doubleTap")).toEqual([12]);
    expect(pulsedFrames(frames, "singleTap")).toEqual([]);
  });

  it("fires Single Tap once Interval passes after a lone tap", () => {
    const r = createInteractionRig(doubleTap, { inputs: { interval: 0.3 } });
    const frames = [r.step(), r.step({ pulses: ["tap"] }), ...Array.from({ length: 30 }, () => r.step())];
    expect(pulsedFrames(frames, "singleTap")).toEqual([19]);
    expect(frames[1]!.requestedNextFrame).toBe(true);
  });

  it("counts taps on consecutive frames", () => {
    const r = createInteractionRig(doubleTap);
    const frames = [r.step(), r.step({ pulses: ["tap"] }), r.step({ pulses: ["tap"] })];
    expect(pulsedFrames(frames, "doubleTap")).toEqual([2]);
  });

  it("turns three quick taps into a Double Tap and then a Single Tap", () => {
    const r = createInteractionRig(doubleTap);
    const frames = [r.step(), r.step({ pulses: ["tap"] }), r.step(), r.step({ pulses: ["tap"] }), r.step(), r.step({ pulses: ["tap"] }), ...Array.from({ length: 30 }, () => r.step())];
    expect(pulsedFrames(frames, "doubleTap")).toEqual([3]);
    expect(pulsedFrames(frames, "singleTap")).toEqual([23]);
  });

  it("pulses Single Tap on every tap when Interval is 0 or negative", () => {
    const r = createInteractionRig(doubleTap, { inputs: { interval: -1 } });
    const frames = [r.step({ pulses: ["tap"] }), r.step({ pulses: ["tap"] }), r.step()];
    expect(pulsedFrames(frames, "singleTap")).toEqual([0, 1]);
    expect(pulsedFrames(frames, "doubleTap")).toEqual([]);
  });

  it("closes an old wait and starts a new one when frames drop", () => {
    const r = createInteractionRig(doubleTap, { inputs: { interval: 0.3 } });
    r.step();
    r.step({ pulses: ["tap"] });
    const late = r.step({ pulses: ["tap"], dt: 0.5 });
    expect([...late.pulses]).toEqual(["singleTap"]);
    expect(r.harness.state()!.pending).toBe(true);
  });

  it("discards a waiting tap while disabled", () => {
    const r = createInteractionRig(doubleTap);
    r.step();
    r.step({ pulses: ["tap"] });
    r.step({ inputs: { enabled: false } });
    const frames = Array.from({ length: 30 }, (_, i) => r.step(i === 0 ? { inputs: { enabled: true } } : {}));
    expect(pulsedFrames(frames, "singleTap")).toEqual([]);
  });

  it("moves the deadline when Interval changes mid-wait", () => {
    const r = createInteractionRig(doubleTap, { inputs: { interval: 1 } });
    r.step();
    r.step({ pulses: ["tap"] });
    r.run(5);
    expect(r.step({ inputs: { interval: 0.05 } }).pulses.has("singleTap")).toBe(true);
  });

  it("watches Layer for taps when Tap isn't connected", () => {
    const r = createInteractionRig(doubleTap, { inputs: { layer: { layerId: "heart" } }, layers: [{ id: "heart", rect: [0, 0, 100, 100] }] });
    r.step();
    const frames = [...r.script(tap(50, 50)), ...r.script(tap(60, 40)), r.step()];
    expect(pulsedFrames(frames, "doubleTap")).toEqual([4]);
    const missed = r.script([...tap(300, 300), [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []]);
    expect(pulsedFrames(missed, "singleTap")).toEqual([]);
  });

  it("keeps per-index state for a looped Tap", () => {
    const r = createInteractionRig(doubleTap);
    r.step();
    r.step({ inputs: { tap: loopOf([true, false]) } });
    r.step({ inputs: { tap: loopOf([false, false]) } });
    const second = r.step({ inputs: { tap: loopOf([true, true]) } });
    expect(second.pulseItems.doubleTap).toEqual([true, false]);
    expect(r.harness.state(1)!.pending).toBe(true);
  });
});
