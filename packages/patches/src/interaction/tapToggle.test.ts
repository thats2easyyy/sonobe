import { describe, expect, it } from "vitest";
import { pointerEvent, tap } from "@sonobe/engine/testing";
import { loopOf } from "../infra/index.ts";
import { tapToggle } from "./tapToggle.ts";
import { createInteractionRig, type RigLayer } from "./testing.ts";

const heart: RigLayer = { id: "heart", rect: [0, 0, 100, 100] };

function rig(inputs: Record<string, unknown> = {}, layers: RigLayer[] = [heart]) {
  return createInteractionRig(tapToggle, { inputs: { layer: { layerId: "heart" }, ...inputs }, layers });
}

describe("tapToggle", () => {
  it("flips on each tap and pulses only on changes", () => {
    const r = rig();
    expect(r.step().outputs).toEqual({ on: false, down: false });
    const [down, up] = r.script(tap(50, 50));
    expect(down!.outputs).toEqual({ on: false, down: true });
    expect(up!.outputs.on).toBe(true);
    expect([...up!.pulses]).toEqual(["turnedOn"]);
    expect(r.step().pulses.size).toBe(0);
    const [, up2] = r.script(tap(50, 50));
    expect(up2!.outputs.on).toBe(false);
    expect([...up2!.pulses]).toEqual(["turnedOff"]);
  });

  it("applies Turn Off, then Turn On, then a tap or Flip", () => {
    const r = rig();
    r.step();
    expect(r.step({ pulses: ["turnOn", "turnOff", "flip"] }).outputs.on).toBe(false);
    expect(r.step({ pulses: ["turnOn", "flip"] }).outputs.on).toBe(true);
    const turnOnAgain = r.step({ pulses: ["turnOn"] });
    expect(turnOnAgain.outputs.on).toBe(true);
    expect(turnOnAgain.pulses.size).toBe(0);
    r.step({ events: [pointerEvent("down", 50, 50)] });
    const both = r.step({ events: [pointerEvent("up", 50, 50)], pulses: ["flip"] });
    expect(both.outputs.on).toBe(false);
  });

  it("counts pulses on consecutive frames", () => {
    const r = rig();
    r.step();
    expect(r.step({ pulses: ["flip"] }).outputs.on).toBe(true);
    expect(r.step({ pulses: ["flip"] }).outputs.on).toBe(false);
  });

  it("reads Start On only when state is created", () => {
    const r = rig({ startOn: true });
    const first = r.step();
    expect(first.outputs.on).toBe(true);
    expect(first.pulses.size).toBe(0);
    expect(r.step({ inputs: { startOn: false } }).outputs.on).toBe(true);
    r.harness.restart();
    expect(r.step().outputs.on).toBe(false);
  });

  it("ignores taps while disabled but still takes pulses", () => {
    const r = rig({ enabled: false });
    r.step();
    const [down, up] = r.script(tap(50, 50));
    expect(down!.outputs.down).toBe(false);
    expect(up!.outputs.on).toBe(false);
    expect(r.step({ pulses: ["flip"] }).outputs.on).toBe(true);
  });

  it("can't be tapped by a press that overlapped a disabled frame", () => {
    const r = rig({ enabled: false });
    r.step();
    r.step({ events: [pointerEvent("down", 50, 50)] });
    r.step({ inputs: { enabled: true } });
    expect(r.step({ events: [pointerEvent("up", 50, 50)] }).outputs.on).toBe(false);
  });

  it("keeps independent toggles for loop-replicated layers", () => {
    const layers: RigLayer[] = [0, 1, 2].map((i) => ({ id: "row", instance: i, rect: [0, i * 100, 300, 80] }));
    const r = rig({ layer: loopOf([0, 1, 2].map((i) => ({ layerId: "row", instance: i }))), startOn: loopOf([false, false, true]) }, layers);
    expect(r.step().outputs.on).toEqual(loopOf([false, false, true]));
    const [, up] = r.script(tap(50, 140));
    expect(up!.outputs.on).toEqual(loopOf([false, true, true]));
    expect(up!.pulseItems.turnedOn).toEqual([false, true, false]);
  });

  it("still takes pulses when the layer is missing", () => {
    const r = rig({ layer: { layerId: "gone" } });
    r.step();
    r.script(tap(50, 50));
    expect(r.harness.output("on")).toBe(false);
    expect(r.step({ pulses: ["turnOn"] }).outputs.on).toBe(true);
  });
});
