import type { PatchContext } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { definitions } from "./index.ts";
import { drivenByPulse, isMuted, jsonEqual, optionIndex, pulseOnFirstFrame, readDuration, sameValue } from "./shared.ts";

describe("state shared helpers", () => {
  it("defines every state catalog type once", () => {
    const types = definitions.map((d) => d.type);
    expect(types).toEqual(["switch", "counter", "pulse", "pulseOnChange", "whenPrototypeStarts", "sampleAndHold", "optionSwitch", "optionPicker", "optionSender", "optionEquals", "delay", "delay1", "wait", "repeatingPulse", "time", "stopwatch"]);
    for (const def of definitions) expect(def.category, def.type).toBe("state");
  });

  it("compares values by variant", () => {
    expect(sameValue(0, -0, "number")).toBe(true);
    expect(sameValue(Number.NaN, Number.NaN, "index")).toBe(true);
    expect(sameValue(1, 1.0000001, "number")).toBe(false);
    expect(sameValue("A", "a", "text")).toBe(false);
    expect(sameValue({ r: 0.5, g: 0.2, b: 0, a: 1 }, { r: 0.501, g: 0.2, b: 0, a: 1 }, "color")).toBe(true);
    expect(sameValue({ r: 0.5, g: 0.2, b: 0, a: 1 }, { r: 0.501, g: 0.2, b: 0, a: 1 }, "color", "exact")).toBe(false);
    expect(sameValue([1, 2, 3], [1, 2, 3], "point3d")).toBe(true);
    expect(sameValue([1, 2], [1, 2, 0], "point")).toBe(false);
    expect(sameValue({ layerId: "card" }, { layerId: "card", instance: undefined }, "layer")).toBe(true);
    expect(sameValue({ layerId: "card", instance: 1 }, { layerId: "card", instance: 2 }, "layer")).toBe(false);
    expect(sameValue(null, null, "layer")).toBe(true);
    expect(sameValue({ assetId: "hero" }, { assetId: "hero" }, "image")).toBe(true);
    expect(sameValue({ assetId: "hero" }, { url: "hero" }, "image")).toBe(false);
    expect(sameValue({ path: "M0 0" }, { path: "M0 0" }, "shape")).toBe(true);
  });

  it("compares JSON by kind, in order for arrays and in any order for keys", () => {
    expect(jsonEqual({ a: 1, b: { c: [1, "x"] } }, { b: { c: [1, "x"] }, a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual({ a: undefined }, {})).toBe(false);
    expect(jsonEqual(0, false)).toBe(false);
    expect(jsonEqual("1", 1)).toBe(false);
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(null, null)).toBe(true);
  });

  it("reads option numbers with an epsilon and clamps them", () => {
    expect(optionIndex(2.9999999999999996, 5)).toBe(3);
    expect(optionIndex(2.5, 5)).toBe(2);
    expect(optionIndex(-1, 3)).toBe(0);
    expect(optionIndex(99, 3)).toBe(2);
    expect(optionIndex(Number.NaN, 3)).toBe(0);
    expect(optionIndex(true, 3)).toBe(1);
  });

  it("reads pulse sources through ctx.isPulseSource", () => {
    const ctx = (sources: readonly string[]) => ({ isPulseSource: (key: string) => sources.includes(key), pulsed: () => true }) as unknown as PatchContext;
    expect(drivenByPulse(ctx(["value"]), "value")).toBe(true);
    expect(drivenByPulse(ctx([]), "value")).toBe(false);
    expect(pulseOnFirstFrame(ctx(["value"]), "value", "boolean")).toBe(true);
    expect(pulseOnFirstFrame(ctx(["value"]), "value", "number")).toBe(false);
    expect(pulseOnFirstFrame(ctx([]), "value", "boolean")).toBe(false);
  });

  it("reports muting through ctx.muted, which includes an enclosing muted instance", () => {
    expect(isMuted({ muted: false })).toBe(false);
    expect(isMuted({ muted: true })).toBe(true);
  });

  it("reads durations safely and warns once per restart", () => {
    const seen: number[] = [];
    const probe = { ...definitions[0]!, state: undefined, evaluate: (c: PatchContext) => seen.push(readDuration(c, "duration", "Probe")) };
    const h = createPatchHarness(probe, { inputs: { duration: -3 } });
    h.step();
    h.step({ inputs: { duration: Number.NaN } });
    h.step();
    h.step({ inputs: { duration: 0.4 } });
    expect(seen).toEqual([0, 0, 0, 0.4]);
    expect(h.logs.map((l) => l.message)).toEqual(['Probe "patch_1": duration isn\'t a finite number of seconds, so it counts as 0.']);
  });
});
