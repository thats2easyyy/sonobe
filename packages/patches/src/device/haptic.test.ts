import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { VIBRATION_PLANS, ahapToVibration, hapticPatch } from "./haptic.ts";

const transient = (time: number) => ({ Event: { Time: time, EventType: "HapticTransient", EventParameters: [] } });
const continuous = (time: number, duration: number) => ({ Event: { Time: time, EventType: "HapticContinuous", EventDuration: duration } });

describe("ahapToVibration", () => {
  it("turns transient and continuous events into on/off spans", () => {
    expect(ahapToVibration({ Pattern: [transient(0), transient(0.1)] }).plan).toEqual([12, 88, 12]);
    expect(ahapToVibration({ Pattern: [continuous(0.2, 0.5)] }).plan).toEqual([0, 200, 500]);
  });

  it("sorts, merges overlaps, ignores audio events and curves, and clips at 10 s", () => {
    const pattern = {
      Pattern: [continuous(0.3, 0.2), transient(0), continuous(0.4, 0.3), { Event: { Time: 0.05, EventType: "AudioCustom" } }, { ParameterCurve: { Time: 0 } }, continuous(9.9, 5), transient(12)],
    };
    expect(ahapToVibration(pattern).plan).toEqual([12, 288, 400, 9200, 100]);
  });

  it("names the problem when the pattern can't convert", () => {
    expect(ahapToVibration(null)).toMatchObject({ plan: null, problem: expect.stringContaining("isn't a Core Haptics pattern") });
    expect(ahapToVibration({ Pattern: [{ Event: { Time: 0, EventType: "AudioCustom" } }] })).toMatchObject({ plan: null, problem: expect.stringContaining("no haptic events") });
  });
});

describe("haptic", () => {
  it("plays each type's vibration pattern on a pulse and reports availability", () => {
    const calls: unknown[] = [];
    const h = createPatchHarness(hapticPatch, { services: { platform: { vibrate: (p) => calls.push(p) } } });
    expect(h.step().outputs.available).toBe(true);
    for (const type of ["vibrate", "selection", "impactMedium", "notificationError"]) h.step({ pulses: ["play"], inputs: { type } });
    expect(calls).toEqual([[400], [8], [20], [...VIBRATION_PLANS.notificationError!]]);
    expect(h.step({ inputs: { type: "alignment" }, pulses: ["play"] }).outputs.available).toBe(false);
    expect(calls).toHaveLength(4);
    expect(h.logs.at(-1)?.message).toBe("Haptic: alignment (no haptics on this device)");
  });

  it("logs where there are no haptics", () => {
    const h = createPatchHarness(hapticPatch);
    expect(h.step({ pulses: ["play"] }).outputs.available).toBe(false);
    expect(h.logs.map((l) => [l.level, l.message])).toEqual([["log", "Haptic: impactLight (no haptics on this device)"]]);
  });

  it("prefers native haptics for supported types and passes the pattern for Custom Pattern", () => {
    const played: unknown[] = [];
    const vibrations: unknown[] = [];
    const haptic = { supports: (type: string) => type !== "levelChange", play: (type: string, pattern?: unknown) => played.push([type, pattern]) };
    const pattern = { Pattern: [transient(0)] };
    const h = createPatchHarness(hapticPatch, { services: { platform: { haptic, vibrate: (p: number | number[]) => vibrations.push(p) } as never } });
    h.step({ pulses: ["play"], inputs: { type: "customPattern", pattern } });
    h.step({ pulses: ["play"], inputs: { type: "impactHeavy" } });
    expect(played).toEqual([["customPattern", pattern], ["impactHeavy", undefined]]);
    expect(h.step({ inputs: { type: "levelChange" } }).outputs.available).toBe(false);
    expect(vibrations).toEqual([]);
  });

  it("converts Custom Pattern for vibration, caches by identity, and warns once about bad patterns", () => {
    const calls: unknown[] = [];
    const h = createPatchHarness(hapticPatch, { services: { platform: { vibrate: (p) => calls.push(p) } } });
    h.step({ pulses: ["play"], inputs: { type: "customPattern", pattern: { Pattern: [continuous(0, 0.25)] } } });
    expect(calls).toEqual([[250]]);
    h.set({ pattern: { nope: true } });
    const f = h.run(3, { pulses: ["play"] });
    expect(f.outputs.available).toBe(false);
    expect(calls).toHaveLength(1);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("treats an unknown type as Impact Light with a warning", () => {
    const calls: unknown[] = [];
    const h = createPatchHarness(hapticPatch, { services: { platform: { vibrate: (p) => calls.push(p) } } });
    h.step({ pulses: ["play"], inputs: { type: "impactMediumIOS" } });
    expect(calls).toEqual([[12]]);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("plays once per pulsing loop index and stops vibration on dispose", () => {
    const calls: unknown[] = [];
    const h = createPatchHarness(hapticPatch, { services: { platform: { vibrate: (p) => calls.push(p) } } });
    h.step({ pulses: ["play"], inputs: { type: loopOf(["selection", "impactHeavy"]) } });
    expect(calls).toEqual([[8], [35]]);
    h.dispose();
    expect(calls.slice(2)).toEqual([0, 0]);
  });
});
