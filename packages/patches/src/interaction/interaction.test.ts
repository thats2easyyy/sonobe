import { describe, expect, it } from "vitest";
import { drag, pointerEvent, tap } from "@sonobe/engine/testing";
import { loopOf } from "../infra/index.ts";
import type { InputEvent } from "@sonobe/engine";
import { interaction } from "./interaction.ts";
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

  it("reports Force from the pointer's pressure while down", () => {
    const press = (phase: "down" | "move" | "up", pointerType: "touch" | "mouse", pressure?: number): InputEvent => {
      const event: InputEvent = { kind: "pointer", phase, pointerId: 1, pointerType, x: 150, y: 250 };
      if (pressure !== undefined) event.pressure = pressure;
      return event;
    };
    const r = rig();
    r.step();
    expect(r.step({ events: [press("down", "touch", 0.4)] }).outputs.force).toBe(0.4);
    expect(r.step({ events: [press("move", "touch", 0.9)] }).outputs.force).toBe(0.9);
    expect(r.step({ events: [press("up", "touch")] }).outputs.force).toBe(0);
    expect(r.step({ events: [press("down", "touch")] }).outputs.force).toBe(0.5);
    r.step({ events: [press("up", "touch")] });
    expect(r.step({ events: [press("down", "mouse")] }).outputs.force).toBe(0);
    const disabled = rig({ layer: { layerId: "card" }, enabled: false });
    disabled.step();
    expect(disabled.step({ events: [press("down", "touch", 0.7)] }).outputs.force).toBe(0);
  });
});
