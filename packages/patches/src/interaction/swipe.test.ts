import { describe, expect, it } from "vitest";
import { DECELERATION_FAST, DECELERATION_NORMAL } from "@sonobe/engine";
import { drag, idle, pointerEvent, sequence, tap } from "@sonobe/engine/testing";
import type { InputEvent } from "@sonobe/engine";
import { loopOf } from "../infra/index.ts";
import { snapItem } from "../math/snap.ts";
import { gesture } from "./gesture.ts";
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

describe("swipe lookahead", () => {
  const card = { axis: "horizontal", minDistance: 95, minVelocity: 800 };
  /** 60 pt right in 100 ms: about 600 pt/s at release, short of both thresholds. */
  const quickFlick = () => drag([100, 200], [160, 200], { frames: 6 });
  const started = (inputs: Record<string, unknown> = {}) => {
    const r = rig(inputs);
    r.step();
    return r;
  };
  const projected = (frame: { outputs: Record<string, unknown> }) => frame.outputs.projected as number[];

  it("judges exactly as before at Lookahead 0, frame by frame", () => {
    const scripts: [InputEvent[][], Record<string, unknown>][] = [
      [drag([300, 200], [220, 200], { frames: 4 }), {}],
      [slowDrag([50, 200], [200, 200]), {}],
      [slowDrag([50, 200], [110, 200]), {}],
      [drag([200, 300], [190, 150], { frames: 4 }), {}],
      [sequence(drag([50, 200], [250, 200], { frames: 20, release: false }), idle(15), [[pointerEvent("move", 180, 200)], [pointerEvent("move", 110, 200)], [pointerEvent("up", 110, 200)]]), {}],
      [tap(100, 100), { minDistance: 0, minVelocity: 0 }],
      [drag([300, 200], [100, 205], { frames: 4 }), { axis: "vertical" }],
      [quickFlick(), card],
      [drag([100, 200], [160, 200], { frames: 30 }), card],
    ];
    for (const [script, inputs] of scripts) {
      const unset = started(inputs).script(script).map((f) => [...f.pulses].sort().join(","));
      const zero = started({ ...inputs, lookahead: 0 }).script(script);
      expect(zero.map((f) => [...f.pulses].sort().join(","))).toEqual(unset);
    }
  });

  it("throws a quick short flick at Lookahead 0.2, left or right, that springs back at 0", () => {
    expect(fired(started(card).script(quickFlick()))).toEqual([]);
    expect(fired(started({ ...card, lookahead: 0.2 }).script(quickFlick()))).toEqual([["swiped", "swipedRight"]]);
    expect(fired(started({ ...card, lookahead: 0.2 }).script(drag([200, 200], [130, 200], { frames: 6 })))).toEqual([["swiped", "swipedLeft"]]);
  });

  it("still springs back a slow 60 pt drag at Lookahead 0.2", () => {
    expect(fired(started({ ...card, lookahead: 0.2 }).script(drag([100, 200], [160, 200], { frames: 30 })))).toEqual([]);
  });

  it("outputs Gesture's Translation + Velocity × Lookahead every frame, kept on the release frame, then 0,0", () => {
    const script = sequence(drag([100, 200], [180, 230], { frames: 8 }), idle(3));
    const g = createInteractionRig(gesture, { inputs: { layer: { layerId: "card" } }, layers: [{ id: "card", rect: [0, 0, 390, 400] }] });
    g.step();
    const moves = g.script(script);
    const frames = started({ lookahead: 0.25 }).script(script);
    const travel = started().script(script);
    frames.forEach((f, i) => {
      const t = moves[i]!.outputs.translation as number[];
      const v = moves[i]!.outputs.velocity as number[];
      expect(projected(f)[0]).toBeCloseTo(t[0]! + v[0]! * 0.25, 9);
      expect(projected(f)[1]).toBeCloseTo(t[1]! + v[1]! * 0.25, 9);
      expect(projected(travel[i]!)).toEqual(t); // Lookahead 0: just the travel
    });
    const release = frames.findIndex((f) => f.pulses.has("swiped"));
    expect(release).toBeGreaterThan(0);
    expect(projected(frames[release]!)[0]).toBeGreaterThan(80);
    expect(projected(frames[release + 1]!)).toEqual([0, 0]);
  });

  it("matches Snap's projection: Lookahead r / (1000(1 − r)) s for Normal and Fast", () => {
    const script = drag([100, 200], [175, 200], { frames: 5 });
    for (const [rate, deceleration] of [[DECELERATION_NORMAL, "normal"], [DECELERATION_FAST, "fast"]] as const) {
      const g = createInteractionRig(gesture, { inputs: { layer: { layerId: "card" } }, layers: [{ id: "card", rect: [0, 0, 390, 400] }] });
      g.step();
      const end = g.script(script).at(-1)!;
      const snapped = snapItem(end.outputs.translation as number[], end.outputs.velocity as number[], "step", [0, 0], [0, 0], [], deceleration);
      const swiped = started({ lookahead: rate / (1000 * (1 - rate)) }).script(script).at(-1)!;
      expect(projected(swiped)[0]).toBeCloseTo(snapped.projected[0]!, 6);
    }
  });

  it("picks the Any Direction axis from where the press is heading", () => {
    // 30 pt down slowly, then a quick 20 pt sideways flick: the travel is mostly vertical, the heading horizontal.
    const script = sequence(drag([200, 100], [200, 130], { frames: 20, release: false }), idle(15), [[pointerEvent("move", 210, 130)], [pointerEvent("move", 220, 130)], [pointerEvent("up", 220, 130)]]);
    expect(fired(started({ minVelocity: 5000 }).script(script))).toEqual([]);
    expect(fired(started({ minVelocity: 5000, lookahead: 0.2 }).script(script))).toEqual([["swiped", "swipedRight"]]);
  });

  it("lets Min Velocity overrule the projection on a reverse flick, unless it's raised out of reach", () => {
    // 80 pt right slowly, then a flick back left at release.
    const script = sequence(drag([100, 200], [180, 200], { frames: 20, release: false }), idle(15), [[pointerEvent("move", 170, 200)], [pointerEvent("move", 160, 200)], [pointerEvent("move", 150, 200)], [pointerEvent("up", 150, 200)]]);
    expect(fired(started({ ...card, minVelocity: 500, lookahead: 0.2 }).script(script))).toEqual([["swiped", "swipedLeft"]]);
    expect(fired(started({ ...card, minVelocity: 100000, lookahead: 0.2 }).script(script))).toEqual([]);
  });

  it("never swipes a tap or a small wiggle, however long the lookahead", () => {
    const r = started({ minDistance: 0, minVelocity: 0, lookahead: 5 });
    expect(fired(r.script(tap(100, 100)))).toEqual([]);
    expect(fired(r.script(drag([100, 100], [106, 100], { frames: 1 })))).toEqual([]);
  });

  it("treats negative and non-finite Lookahead as 0", () => {
    for (const lookahead of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const frames = started({ ...card, lookahead }).script(quickFlick());
      expect(fired(frames)).toEqual([]);
      for (const f of frames) for (const c of projected(f)) expect(Number.isFinite(c)).toBe(true);
    }
  });

  it("projects 0,0 and fires nothing while disabled or for a press that overlapped a disabled frame", () => {
    for (const f of started({ enabled: false, lookahead: 0.2 }).script(drag([300, 200], [100, 200], { frames: 4 }))) expect(projected(f)).toEqual([0, 0]);
    const r = started({ enabled: false, lookahead: 0.2 });
    r.step({ events: [pointerEvent("down", 300, 200)] });
    expect(projected(r.step({ inputs: { enabled: true }, events: [pointerEvent("move", 200, 200)] }))).toEqual([0, 0]);
    expect(r.step({ events: [pointerEvent("up", 100, 200)] }).pulses.size).toBe(0);
  });

  it("never swipes a cancelled press", () => {
    const cancelled = sequence(drag([300, 200], [100, 200], { frames: 4, release: false }), [[pointerEvent("cancel", 100, 200)]]);
    expect(fired(started({ lookahead: 0.2 }).script(cancelled))).toEqual([]);
  });

  it("projects and pulses each loop copy on its own", () => {
    const r = createInteractionRig(swipe, {
      inputs: { layer: loopOf([{ layerId: "card", instance: 0 }, { layerId: "card", instance: 1 }]), ...card, lookahead: 0.2 },
      layers: [
        { id: "card", instance: 0, rect: [0, 0, 390, 300] },
        { id: "card", instance: 1, rect: [0, 400, 390, 300] },
      ],
    });
    r.step();
    const release = r.script(drag([100, 500], [160, 500], { frames: 6 })).at(-1)!;
    const items = (release.outputs.projected as unknown as { items: number[][] }).items;
    expect(items[0]).toEqual([0, 0]);
    expect(items[1]![0]).toBeGreaterThan(95);
    expect(release.pulseItems.swipedRight).toEqual([false, true]);
  });

  it("fires nothing and projects 0,0 when muted", () => {
    const r = createInteractionRig(swipe, { inputs: { layer: { layerId: "card" }, lookahead: 0.2, minDistance: 0 }, layers: [{ id: "card", rect: [0, 0, 390, 400] }], muted: true });
    r.step();
    const frames = r.script(drag([300, 200], [100, 200], { frames: 4 }));
    expect(fired(frames)).toEqual([]);
    for (const f of frames) expect(projected(f)).toEqual([0, 0]);
  });
});
