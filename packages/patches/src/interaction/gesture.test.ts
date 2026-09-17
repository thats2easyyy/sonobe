import { describe, expect, it } from "vitest";
import { pointerEvent, tap } from "@sonobe/engine/testing";
import { gesture } from "./gesture.ts";
import { createInteractionRig } from "./testing.ts";

function rig(inputs: Record<string, unknown> = { layer: { layerId: "card" } }) {
  return createInteractionRig(gesture, { inputs, layers: [{ id: "card", rect: [0, 0, 300, 300] }] });
}

describe("gesture", () => {
  it("starts idle", () => {
    const f = rig().step();
    expect(f.outputs).toEqual({
      down: false,
      position: [0, 0],
      translation: [0, 0],
      velocity: [0, 0],
      startPosition: [0, 0],
      localPosition: [0, 0],
    });
  });

  it("tracks translation and velocity during a press, keeps them on release, then returns to 0,0", () => {
    const r = rig();
    r.step();
    const press = r.step({ events: [pointerEvent("down", 100, 100)] });
    expect(press.outputs.translation).toEqual([0, 0]);
    expect(press.outputs.velocity).toEqual([0, 0]);
    expect(press.outputs.startPosition).toEqual([100, 100]);

    let last = press;
    for (let i = 1; i <= 6; i++) last = r.step({ events: [pointerEvent("move", 100 + i * 10, 100)] });
    expect(last.outputs.translation).toEqual([60, 0]);
    const [vx, vy] = last.outputs.velocity as number[];
    expect(vx).toBeGreaterThan(400);
    expect(vx).toBeLessThan(600);
    expect(vy).toBe(0);

    const release = r.step({ events: [pointerEvent("up", 160, 100)] });
    expect(release.outputs.down).toBe(false);
    expect(release.outputs.translation).toEqual([60, 0]);
    expect((release.outputs.velocity as number[])[0]).toBeCloseTo(vx, 9);
    expect(release.outputs.position).toEqual([160, 100]);

    const after = r.step();
    expect(after.outputs.translation).toEqual([0, 0]);
    expect(after.outputs.velocity).toEqual([0, 0]);
    expect(after.outputs.position).toEqual([160, 100]);
    expect(after.outputs.startPosition).toEqual([100, 100]);
  });

  it("shows movement inside the tap slop", () => {
    const r = rig();
    r.step();
    r.step({ events: [pointerEvent("down", 100, 100)] });
    expect(r.step({ events: [pointerEvent("move", 105, 97)] }).outputs.translation).toEqual([5, -3]);
  });

  it("taps like Interaction", () => {
    const r = rig();
    r.step();
    const [, up] = r.script(tap(50, 50));
    expect(up!.pulses.has("tap")).toBe(true);
  });

  it("outputs idle values while disabled and holds positions", () => {
    const r = rig();
    r.step();
    r.script(tap(50, 50));
    const f = r.step({ inputs: { enabled: false }, events: [pointerEvent("down", 80, 80)] });
    expect(f.outputs.down).toBe(false);
    expect(f.outputs.translation).toEqual([0, 0]);
    expect(f.outputs.position).toEqual([50, 50]);
    const moved = r.step({ inputs: { enabled: true }, events: [pointerEvent("move", 120, 80)] });
    expect(moved.outputs.down).toBe(false);
    expect(moved.outputs.translation).toEqual([0, 0]);
  });
});
