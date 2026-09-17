import { describe, expect, it } from "vitest";
import { decayPosition, decayVelocity } from "@sonobe/engine";
import { drag as dragScript, idle, pointerEvent, sequence } from "@sonobe/engine/testing";
import { loopOf } from "../infra/index.ts";
import { drag, dragDeceleration } from "./drag.ts";
import { createInteractionRig, type RigLayer } from "./testing.ts";

const knob: RigLayer = { id: "knob", rect: [100, 100, 60, 60] };

function rig(inputs: Record<string, unknown> = {}, layers: RigLayer[] = [knob]) {
  return createInteractionRig(drag, { inputs: { layer: { layerId: "knob" }, startPosition: [100, 100], ...inputs }, layers });
}

describe("dragDeceleration", () => {
  it("maps Momentum Friction to POP decay rates", () => {
    expect(dragDeceleration(50)).toBeCloseTo(0.998, 12);
    expect(dragDeceleration(250)).toBeCloseTo(0.99, 12);
    expect(dragDeceleration(950)).toBeCloseTo(0.962, 12);
    expect(dragDeceleration(0)).toBeCloseTo(1 - 1 / 25000, 12);
  });
});

describe("drag", () => {
  it("starts at Start Position and follows it live until the first drag", () => {
    const r = rig();
    expect(r.step().outputs).toEqual({ position: [100, 100], dragging: false, velocity: [0, 0] });
    expect(r.step({ inputs: { startPosition: [120, 90] } }).outputs.position).toEqual([120, 90]);
  });

  it("moves by the pointer's translation from the first point of movement", () => {
    const r = rig();
    r.step();
    const frames = r.script(dragScript([130, 130], [230, 150], { frames: 10, release: false }));
    expect(frames[0]!.outputs.dragging).toBe(true);
    expect(frames[1]!.outputs.position).toEqual([110, 102]);
    const last = frames.at(-1)!;
    expect(last.outputs.position).toEqual([200, 120]);
    expect((last.outputs.velocity as number[])[0]).toBeGreaterThan(0);
    expect(last.requestedNextFrame).toBe(true);
    const up = r.step({ events: [pointerEvent("up", 230, 150)] });
    expect(up.outputs).toEqual({ position: [200, 120], dragging: false, velocity: [0, 0] });
    expect(r.step({ inputs: { startPosition: [0, 0] } }).outputs.position).toEqual([200, 120]);
    expect(r.step({ pulses: ["reset"] }).outputs.position).toEqual([0, 0]);
    expect(r.step({ inputs: { startPosition: [5, 5] } }).outputs.position).toEqual([5, 5]);
  });

  it("locks to one axis", () => {
    const r = rig({ axis: "horizontal" });
    r.step();
    const last = r.script(dragScript([130, 130], [180, 200], { frames: 5, release: false })).at(-1)!;
    expect(last.outputs.position).toEqual([150, 100]);
    expect((last.outputs.velocity as number[])[1]).toBe(0);
  });

  it("clips between Min and Max, swapping them per axis", () => {
    const r = rig({ clip: true, min: [300, 0], max: [0, 120] });
    r.step();
    const last = r.script(dragScript([130, 130], [530, 330], { frames: 5, release: false })).at(-1)!;
    expect(last.outputs.position).toEqual([300, 120]);
    expect(r.step({ inputs: { max: [0, 110] } }).outputs.position).toEqual([300, 110]);
  });

  it("glides with POP decay after a flick when Momentum is on, then stops", () => {
    const r = rig({ momentum: true });
    r.step();
    r.script(dragScript([130, 130], [230, 130], { frames: 5, release: false }));
    const up = r.step({ events: [pointerEvent("up", 230, 130)] });
    expect(up.outputs.dragging).toBe(false);
    const [vx] = up.outputs.velocity as number[];
    expect(vx).toBeGreaterThan(500);
    const [x] = up.outputs.position as number[];
    const next = r.step();
    expect((next.outputs.position as number[])[0]).toBeCloseTo(x! + decayPosition(0, vx!, 0.998, 1 / 60), 9);
    expect((next.outputs.velocity as number[])[0]).toBeCloseTo(decayVelocity(vx!, 0.998, 1 / 60), 9);
    expect(next.requestedNextFrame).toBe(true);
    let last = next;
    for (let i = 0; i < 900 && (last.outputs.velocity as number[])[0] !== 0; i++) last = r.step();
    expect(last.outputs.velocity).toEqual([0, 0]);
    expect(last.requestedNextFrame).toBe(false);
    expect((last.outputs.position as number[])[0]).toBeCloseTo(x! + (vx! / 1000) * 0.998 / 0.002, -1);
  });

  it("stops hard at a bound while gliding with Clip on", () => {
    const r = rig({ momentum: true, clip: true, min: [0, 0], max: [260, 300] });
    r.step();
    r.script(dragScript([130, 130], [230, 130], { frames: 5 }));
    const last = r.run(120);
    expect(last.outputs.position).toEqual([260, 100]);
    expect(last.outputs.velocity).toEqual([0, 0]);
  });

  it("catches a gliding layer", () => {
    const r = rig({ momentum: true });
    r.step();
    r.script(dragScript([130, 130], [230, 130], { frames: 5 }));
    const gliding = r.run(3);
    const grabbed = r.step({ events: [pointerEvent("down", 150, 130)] });
    expect(grabbed.outputs.position).toEqual(gliding.outputs.position);
    expect(grabbed.outputs.dragging).toBe(true);
  });

  it("lets Reset win over a press in the same frame, until that touch lifts", () => {
    const r = rig();
    r.step();
    const reset = r.step({ events: [pointerEvent("down", 130, 130)], pulses: ["reset"] });
    expect(reset.outputs.dragging).toBe(false);
    expect(r.step({ events: [pointerEvent("move", 180, 130)] }).outputs.position).toEqual([100, 100]);
    r.step({ events: [pointerEvent("up", 180, 130)] });
    r.step({ events: [pointerEvent("down", 130, 130)] });
    expect(r.step({ events: [pointerEvent("move", 180, 130)] }).outputs.position).toEqual([150, 100]);
  });

  it("ends a drag without momentum when disabled, and ignores that touch until it lifts", () => {
    const r = rig({ momentum: true });
    r.step();
    r.script(dragScript([130, 130], [230, 130], { frames: 5, release: false }));
    const disabled = r.step({ inputs: { enabled: false }, events: [pointerEvent("move", 260, 130)] });
    expect(disabled.outputs).toEqual({ position: [200, 100], dragging: false, velocity: [0, 0] });
    const enabled = r.step({ inputs: { enabled: true }, events: [pointerEvent("move", 300, 130)] });
    expect(enabled.outputs.dragging).toBe(false);
    expect(r.step({ events: [pointerEvent("up", 300, 130)] }).outputs.position).toEqual([200, 100]);
  });

  it("converts pointer movement into the parent's scaled space", () => {
    const layers: RigLayer[] = [{ id: "panel", rect: [0, 0, 390, 400], scale: [2, 4] }, { ...knob, parent: "panel" }];
    const r = rig({}, layers);
    r.step();
    const last = r.script(dragScript([130, 130], [230, 230], { frames: 5, release: false })).at(-1)!;
    expect(last.outputs.position).toEqual([150, 125]);
  });

  it("drags each copy of a loop-replicated layer independently", () => {
    const layers: RigLayer[] = [
      { id: "chip", instance: 0, rect: [0, 0, 50, 50] },
      { id: "chip", instance: 1, rect: [0, 100, 50, 50] },
    ];
    const r = rig({ layer: loopOf([{ layerId: "chip", instance: 0 }, { layerId: "chip", instance: 1 }]), startPosition: loopOf([[0, 0], [0, 100]]) }, layers);
    r.step();
    const last = r.script(sequence(dragScript([20, 120], [60, 120], { frames: 4, release: false }), idle(1))).at(-1)!;
    expect(last.outputs.position).toEqual(loopOf([[0, 0], [40, 100]]));
    expect(last.outputs.dragging).toEqual(loopOf([false, true]));
  });

  it("treats non-finite inputs as 0 and warns once", () => {
    const r = rig({ startPosition: [Number.NaN, 5] });
    expect(r.step().outputs.position).toEqual([0, 5]);
    r.step();
    expect(r.harness.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
