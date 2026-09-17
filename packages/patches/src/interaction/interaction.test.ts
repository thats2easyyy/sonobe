import { describe, expect, it } from "vitest";
import { drag, pointerEvent, tap } from "@sonobe/engine/testing";
import { loopOf } from "../infra/index.ts";
import { interaction, snapshotPressure } from "./interaction.ts";
import { createInteractionRig, type RigLayer } from "./testing.ts";

const card: RigLayer = { id: "card", rect: [100, 200, 200, 100] };

function rig(inputs: Record<string, unknown> = { layer: { layerId: "card" } }, layers: RigLayer[] = [card]) {
  return createInteractionRig(interaction, { inputs, layers });
}

describe("interaction", () => {
  it("starts idle", () => {
    const r = rig();
    const f = r.step();
    expect(f.outputs).toEqual({ down: false, position: [0, 0], localPosition: [0, 0], force: 0 });
    expect(f.pulses.size).toBe(0);
  });

  it("reports Down while pressed and a one-frame Tap on release", () => {
    const r = rig();
    r.step();
    const [down, up, after] = r.script([...tap(150, 250), []]);
    expect(down!.outputs.down).toBe(true);
    expect(down!.outputs.position).toEqual([150, 250]);
    expect(down!.outputs.localPosition).toEqual([50, 50]);
    expect(down!.pulses.has("tap")).toBe(false);
    expect(up!.outputs.down).toBe(false);
    expect(up!.pulses.has("tap")).toBe(true);
    expect(up!.outputs.position).toEqual([150, 250]);
    expect(after!.pulses.has("tap")).toBe(false);
    expect(after!.outputs.position).toEqual([150, 250]);
  });

  it("keeps the release point on the tap frame", () => {
    const r = rig();
    r.step();
    const frames = r.script(drag([150, 250], [156, 250], { frames: 2 }));
    const up = frames.at(-1)!;
    expect(up.pulses.has("tap")).toBe(true);
    expect(up.outputs.position).toEqual([156, 250]);
  });

  it("doesn't tap after moving 10 points or more", () => {
    const r = rig();
    r.step();
    const frames = r.script(drag([150, 250], [170, 250], { frames: 2 }));
    expect(frames.some((f) => f.pulses.has("tap"))).toBe(false);
  });

  it("captures the press when it slides off, and doesn't tap when released outside", () => {
    const r = rig();
    r.step();
    r.step({ events: [pointerEvent("down", 150, 250)] });
    expect(r.step({ events: [pointerEvent("move", 152, 251)] }).outputs.down).toBe(true);
    expect(r.step({ events: [pointerEvent("move", 20, 20)] }).outputs.down).toBe(true);
    const up = r.step({ events: [pointerEvent("up", 20, 20)] });
    expect(up.outputs.down).toBe(false);
    expect(up.pulses.has("tap")).toBe(false);
  });

  it("ignores presses that start elsewhere", () => {
    const r = rig();
    r.step();
    const [down, up] = r.script(tap(10, 10));
    expect(down!.outputs.down).toBe(false);
    expect(up!.pulses.has("tap")).toBe(false);
    expect(up!.outputs.position).toEqual([0, 0]);
  });

  it("watches the whole screen when Layer is empty", () => {
    const r = rig({});
    r.step();
    const [down, up] = r.script(tap(10, 10));
    expect(down!.outputs.down).toBe(true);
    expect(up!.pulses.has("tap")).toBe(true);
    expect(up!.outputs.localPosition).toEqual([10, 10]);
  });

  it("reads a missing layer as never pressed", () => {
    const r = rig({ layer: { layerId: "gone" } });
    r.step();
    const [down, up] = r.script(tap(150, 250));
    expect(down!.outputs.down).toBe(false);
    expect(up!.pulses.has("tap")).toBe(false);
  });

  it("bubbles presses on children to parents", () => {
    const r = rig({ layer: { layerId: "card" } }, [card, { id: "button", rect: [120, 220, 40, 40], parent: "card" }]);
    r.step();
    const [down, up] = r.script(tap(130, 230));
    expect(down!.outputs.down).toBe(true);
    expect(up!.pulses.has("tap")).toBe(true);
  });

  it("ignores presses while disabled, including one that overlaps a disabled frame", () => {
    const r = rig({ layer: { layerId: "card" }, enabled: false });
    r.step();
    const [down, up] = r.script(tap(150, 250));
    expect(down!.outputs.down).toBe(false);
    expect(up!.pulses.has("tap")).toBe(false);
    expect(up!.outputs.position).toEqual([0, 0]);

    r.step({ events: [pointerEvent("down", 150, 250)] });
    const held = r.step({ inputs: { enabled: true } });
    expect(held.outputs.down).toBe(false);
    const release = r.step({ events: [pointerEvent("up", 150, 250)] });
    expect(release.pulses.has("tap")).toBe(false);
    const [again, againUp] = r.script(tap(150, 250));
    expect(again!.outputs.down).toBe(true);
    expect(againUp!.pulses.has("tap")).toBe(true);
  });

  it("evaluates per copy of a loop-replicated layer", () => {
    const layers: RigLayer[] = [
      { id: "row", instance: 0, rect: [0, 0, 300, 80] },
      { id: "row", instance: 1, rect: [0, 100, 300, 80] },
    ];
    const r = rig({ layer: loopOf([{ layerId: "row", instance: 0 }, { layerId: "row", instance: 1 }]) }, layers);
    r.step();
    const [down, up] = r.script(tap(50, 140));
    expect(down!.loopCount).toBe(2);
    expect(down!.outputs.down).toEqual(loopOf([false, true]));
    expect(up!.pulseItems.tap).toEqual([false, true]);
    expect(up!.outputs.position).toEqual(loopOf([[0, 0], [50, 140]]));
    expect(r.harness.state(0)!.lastPosition).toEqual([0, 0]);
  });

  it("gives two fingers lifting on the same frame one Tap", () => {
    const r = rig();
    r.step();
    r.step({ events: [pointerEvent("down", 150, 250, { pointerId: 1 }), pointerEvent("down", 160, 250, { pointerId: 2 })] });
    const up = r.step({ events: [pointerEvent("up", 150, 250, { pointerId: 1 }), pointerEvent("up", 160, 250, { pointerId: 2 })] });
    expect(up.pulses.has("tap")).toBe(true);
    expect(up.pulseItems.tap).toEqual([true]);
  });

  it("reads Force from a snapshot pressure when present", () => {
    expect(snapshotPressure({ pressure: 0.4 })).toBe(0.4);
    expect(snapshotPressure({ pressure: 3 })).toBe(1);
    expect(snapshotPressure({ pressure: Number.NaN })).toBe(0);
    expect(snapshotPressure({})).toBe(0);
  });
});
