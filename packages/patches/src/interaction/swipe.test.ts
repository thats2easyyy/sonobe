import { describe, expect, it } from "vitest";
import { drag, idle, pointerEvent, sequence, tap } from "@sonobe/engine/testing";
import type { InputEvent } from "@sonobe/engine";
import { swipe } from "./swipe.ts";
import { createInteractionRig } from "./testing.ts";

function rig(inputs: Record<string, unknown> = {}) {
  return createInteractionRig(swipe, { inputs: { layer: { layerId: "card" }, ...inputs }, layers: [{ id: "card", rect: [0, 0, 390, 400] }] });
}

function fired(frames: { pulses: ReadonlySet<string> }[]): string[][] {
  return frames.map((f) => [...f.pulses].sort()).filter((p) => p.length > 0);
}

/** Drag slowly, hold still long enough for the velocity to decay, then release. */
function slowDrag(from: [number, number], to: [number, number]): InputEvent[][] {
  return sequence(drag(from, to, { frames: 20, release: false }), idle(15), [[pointerEvent("up", to[0], to[1])]]);
}

describe("swipe", () => {
  it("fires Swiped and one direction on the release frame of a flick", () => {
    const r = rig();
    r.step();
    const frames = r.script(drag([300, 200], [220, 200], { frames: 4 }));
    expect(fired(frames.slice(0, -1))).toEqual([]);
    expect([...frames.at(-1)!.pulses].sort()).toEqual(["swiped", "swipedLeft"]);
    expect(r.step().pulses.size).toBe(0);
  });

  it("judges slow drags by distance", () => {
    const far = rig();
    far.step();
    expect(fired(far.script(slowDrag([50, 200], [200, 200])))).toEqual([["swiped", "swipedRight"]]);
    const near = rig();
    near.step();
    expect(fired(near.script(slowDrag([50, 200], [110, 200])))).toEqual([]);
  });

  it("uses y-down directions and the axis with more travel", () => {
    const r = rig();
    r.step();
    expect(fired(r.script(drag([200, 300], [190, 150], { frames: 4 })))).toEqual([["swiped", "swipedUp"]]);
    expect(fired(r.script(drag([200, 100], [205, 250], { frames: 4 })))).toEqual([["swiped", "swipedDown"]]);
  });

  it("lets a flick's velocity decide the direction", () => {
    const r = rig();
    r.step();
    const script = sequence(drag([50, 200], [250, 200], { frames: 20, release: false }), idle(15), [[pointerEvent("move", 180, 200)], [pointerEvent("move", 110, 200)], [pointerEvent("up", 110, 200)]]);
    expect(fired(r.script(script))).toEqual([["swiped", "swipedLeft"]]);
  });

  it("never swipes a tap, even with no thresholds", () => {
    const r = rig({ minDistance: 0, minVelocity: 0 });
    r.step();
    expect(fired(r.script(tap(100, 100)))).toEqual([]);
    expect(fired(r.script(drag([100, 100], [106, 100], { frames: 2 })))).toEqual([]);
    expect(fired(r.script(drag([100, 100], [115, 100], { frames: 2 })))).toEqual([["swiped", "swipedRight"]]);
  });

  it("judges only the chosen axis", () => {
    const r = rig({ axis: "vertical" });
    r.step();
    expect(fired(r.script(drag([300, 200], [100, 205], { frames: 4 })))).toEqual([]);
    expect(fired(r.script(drag([300, 300], [250, 100], { frames: 4 })))).toEqual([["swiped", "swipedUp"]]);
  });

  it("accepts releases off the layer but not presses that start off it", () => {
    const r = rig();
    r.step();
    expect(fired(r.script(drag([300, 200], [-50, 600], { frames: 4 })))).toEqual([["swiped", "swipedDown"]]);
    expect(fired(r.script(drag([300, 500], [100, 500], { frames: 4 })))).toEqual([]);
  });

  it("never swipes a cancelled press", () => {
    const r = rig();
    r.step();
    const cancelled = sequence(drag([300, 200], [100, 200], { frames: 4, release: false }), [[pointerEvent("cancel", 100, 200)]]);
    expect(fired(r.script(cancelled))).toEqual([]);
    expect(fired(r.script(drag([300, 200], [100, 200], { frames: 4 })))).toEqual([["swiped", "swipedLeft"]]);
  });

  it("treats negative thresholds as 0", () => {
    const r = rig({ minDistance: -5, minVelocity: -5 });
    r.step();
    expect(fired(r.script(slowDrag([50, 200], [70, 200])))).toEqual([["swiped", "swipedRight"]]);
  });

  it("fires nothing while disabled, and ignores a press that overlapped a disabled frame", () => {
    const r = rig({ enabled: false });
    r.step();
    expect(fired(r.script(drag([300, 200], [100, 200], { frames: 4 })))).toEqual([]);
    r.step({ events: [pointerEvent("down", 300, 200)] });
    r.step({ inputs: { enabled: true }, events: [pointerEvent("move", 200, 200)] });
    const up = r.step({ events: [pointerEvent("up", 100, 200)] });
    expect(up.pulses.size).toBe(0);
    expect(fired(r.script(drag([300, 200], [100, 200], { frames: 4 })))).toEqual([["swiped", "swipedLeft"]]);
  });
});
