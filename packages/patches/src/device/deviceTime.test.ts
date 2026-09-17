import { describe, expect, it } from "vitest";
import { HARNESS_EPOCH_MS, createPatchHarness, loopOf } from "../infra/index.ts";
import { deviceTimePatch, splitClock } from "./deviceTime.ts";

describe("splitClock", () => {
  it("splits epoch milliseconds into seconds, milliseconds, and time of day", () => {
    expect(splitClock(Date.UTC(2026, 2, 4, 13, 5, 7, 250), true)).toEqual({ seconds: Date.UTC(2026, 2, 4, 13, 5, 7) / 1000, milliseconds: 250, timeOfDay: 13 * 3600 + 5 * 60 + 7.25 });
  });

  it("keeps milliseconds in 0–999 before 1970", () => {
    expect(splitClock(-1500, true)).toMatchObject({ seconds: -2, milliseconds: 500 });
  });

  it("uses local time outside simulation", () => {
    const ms = Date.UTC(2026, 5, 1, 8, 30, 0, 125);
    const d = new Date(ms);
    expect(splitClock(ms, false).timeOfDay).toBeCloseTo(d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + 0.125, 9);
  });
});

describe("deviceTime", () => {
  it("reports the device clock on frame 0 (UTC in simulation) and follows it", () => {
    const h = createPatchHarness(deviceTimePatch);
    const f0 = h.step();
    expect(f0.outputs).toEqual({ seconds: HARNESS_EPOCH_MS / 1000, milliseconds: 0, timeOfDay: 0 });
    expect(f0.requestedNextFrame).toBe(true);
    h.step({ dt: 0.75 });
    const f2 = h.step({ dt: 0.75 });
    expect(f2.outputs).toEqual({ seconds: HARNESS_EPOCH_MS / 1000 + 1, milliseconds: 500, timeOfDay: 1.5 });
  });

  it("holds while disabled (0 from the start) and jumps to the current time when re-enabled", () => {
    const h = createPatchHarness(deviceTimePatch, { inputs: { enabled: false } });
    expect(h.step().outputs).toEqual({ seconds: 0, milliseconds: 0, timeOfDay: 0 });
    expect(h.step({ dt: 0.5 }).requestedNextFrame).toBe(false);
    expect(h.step({ dt: 0.5, inputs: { enabled: true } }).outputs).toEqual({ seconds: HARNESS_EPOCH_MS / 1000 + 1, milliseconds: 0, timeOfDay: 1 });
    expect(h.step({ dt: 0.5, inputs: { enabled: false } }).outputs.timeOfDay).toBe(1);
  });

  it("uses the wall clock's local time zone outside simulation", () => {
    const wall = Date.UTC(2026, 8, 16, 21, 45, 30, 42);
    const h = createPatchHarness(deviceTimePatch, { services: { now: () => wall } });
    const d = new Date(wall);
    expect(h.step().outputs).toEqual({ seconds: Math.floor(wall / 1000), milliseconds: 42, timeOfDay: d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + 0.042 });
  });

  it("keeps the held values and warns once when the clock isn't finite", () => {
    let now = HARNESS_EPOCH_MS + 2000;
    const h = createPatchHarness(deviceTimePatch, { services: { now: () => now } });
    h.step();
    now = Number.NaN;
    const f = h.run(3);
    expect(f.outputs.seconds).toBe(HARNESS_EPOCH_MS / 1000 + 2);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("holds one set of values per loop index", () => {
    const h = createPatchHarness(deviceTimePatch, { inputs: { enabled: loopOf([true, false]) } });
    expect(h.step().outputs.seconds).toEqual(loopOf([HARNESS_EPOCH_MS / 1000, 0]));
  });
});
