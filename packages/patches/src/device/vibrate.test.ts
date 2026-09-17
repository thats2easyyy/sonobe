import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { vibratePatch, vibrationMs } from "./vibrate.ts";

function withMotor() {
  const calls: (number | number[])[] = [];
  const h = createPatchHarness(vibratePatch, { services: { platform: { vibrate: (p) => calls.push(p) } } });
  return { h, calls };
}

describe("vibrate", () => {
  it("clamps durations to 0–10 s in whole milliseconds", () => {
    expect(vibrationMs(0.4)).toBe(400);
    expect(vibrationMs(20)).toBe(10_000);
    expect(vibrationMs(-1)).toBe(0);
    expect(vibrationMs(Number.NaN)).toBe(0);
    expect(vibrationMs(0.0004)).toBe(0);
  });

  it("reports availability and buzzes on each pulse, consecutive frames included", () => {
    const { h, calls } = withMotor();
    expect(h.step().outputs.available).toBe(true);
    expect(calls).toEqual([]);
    h.step({ pulses: ["vibrate"] });
    h.step({ pulses: ["vibrate"], inputs: { duration: 1.5 } });
    h.step();
    expect(calls).toEqual([400, 1500]);
  });

  it("does nothing for zero or negative durations", () => {
    const { h, calls } = withMotor();
    h.step({ pulses: ["vibrate"], inputs: { duration: 0 } });
    h.step({ pulses: ["vibrate"], inputs: { duration: -2 } });
    expect(calls).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it("a held true fires once", () => {
    const { h, calls } = withMotor();
    h.set({ vibrate: true });
    h.run(4);
    expect(calls).toEqual([400]);
  });

  it("logs instead where the device can't vibrate", () => {
    const h = createPatchHarness(vibratePatch);
    expect(h.step({ pulses: ["vibrate"] }).outputs.available).toBe(false);
    expect(h.logs.map((l) => [l.level, l.message])).toEqual([["log", "Vibrate: 400 ms (this device can't vibrate)"]]);
  });

  it("vibrates once per pulsing loop index", () => {
    const { h, calls } = withMotor();
    h.step({ inputs: { duration: loopOf([0.1, 0.2, 0]) }, pulses: ["vibrate"] });
    expect(calls).toEqual([100, 200]);
  });

  it("stops a running buzz on dispose", () => {
    const { h, calls } = withMotor();
    h.dispose();
    expect(calls).toEqual([]);
    h.step({ pulses: ["vibrate"] });
    h.restart();
    expect(calls).toEqual([400, 0]);
  });
});
