import { describe, expect, it } from "vitest";
import { compare, evaluateExpectation, ExampleTestFormatError, parseExampleTest, pickComponent, segmentEvents } from "./scenarios.ts";

const valid = {
  description: "Checks the card.",
  scenarios: [
    {
      name: "tap grows the card",
      events: [{ kind: "tap", target: "@card", atMs: 100 }],
      durationMs: 1000,
      expect: [{ description: "Card grows", target: "@card.scale", op: ">", value: 1 }],
    },
  ],
};

describe("parseExampleTest", () => {
  it("accepts a valid file", () => {
    const t = parseExampleTest(valid);
    expect(t.scenarios[0]!.events[0]).toEqual({ kind: "tap", target: "@card", atMs: 100 });
  });

  it("names the first problem", () => {
    const bad = (patch: (v: typeof valid) => unknown) => () => parseExampleTest(patch(structuredClone(valid)), "x.json");
    expect(bad((v) => ({ ...v, scenarios: [] }))).toThrow(/scenarios must be a non-empty array/);
    expect(bad((v) => (v.scenarios[0]!.events = [{ kind: "tapp" }] as never, v))).toThrow(/events/);
    expect(bad((v) => ((v.scenarios[0]!.expect[0] as Record<string, unknown>).op = "=~", v))).toThrow(/op must be one of/);
    expect(bad((v) => ((v.scenarios[0]!.expect[0] as Record<string, unknown>) = { description: "d", target: "@a.b" }, v))).toThrow(/needs op and value/);
    expect(bad((v) => (v.scenarios.push(v.scenarios[0]!), v))).toThrow(/used twice/);
    expect(bad((v) => ((v.scenarios[0]!.expect[0] as Record<string, unknown>).value = "big", v))).toThrow(/needs a number value/);
    expect(bad(() => [])).toThrow(ExampleTestFormatError);
  });
});

describe("pickComponent", () => {
  it("reads vector parts and color channels", () => {
    expect(pickComponent([3, 4], "y")).toBe(4);
    expect(pickComponent([3, 4], "width")).toBe(3);
    expect(pickComponent([1, 2, 3], 2)).toBe(3);
    expect(pickComponent({ r: 1, g: 0.5, b: 0, a: 1 }, "g")).toBe(0.5);
    expect(pickComponent(7, undefined)).toBe(7);
    expect(pickComponent(7, "x")).toBeUndefined();
  });
});

describe("compare", () => {
  it("compares numbers with a tolerance, booleans and text exactly", () => {
    expect(compare(1.0004, "==", 1)).toBe(true);
    expect(compare(1.01, "==", 1)).toBe(false);
    expect(compare(1.01, "==", 1, 0.02)).toBe(true);
    expect(compare(true, ">", 0)).toBe(true);
    expect(compare(true, "==", true)).toBe(true);
    expect(compare("129 likes", "==", "129 likes")).toBe(true);
    expect(compare("a", "!=", "b")).toBe(true);
    expect(compare(null, "<", 3)).toBe(false);
  });
});

describe("evaluateExpectation", () => {
  const times = [16.67, 33.33, 50, 66.67, 83.33, 100, 116.67, 133.33, 150, 166.67];
  const settling = [0, 50, 90, 105, 101, 100, 100, 100, 100, 100].map((y) => [0, y]);

  it("reads end, start, min, max, and times", () => {
    const at = (point: "start" | "end" | "min" | "max" | number, op: ">" | "==" | "<", value: number) =>
      evaluateExpectation({ description: "d", target: "@a.position", component: "y", at: point, op, value }, times, settling);
    expect(at("end", "==", 100).pass).toBe(true);
    expect(at("start", "==", 0).pass).toBe(true);
    expect(at("max", "==", 105).pass).toBe(true);
    expect(at("min", "<", 1).pass).toBe(true);
    expect(at(60, "==", 105).pass).toBe(true);
    const fail = at("end", ">", 200);
    expect(fail.pass).toBe(false);
    expect(fail.detail).toBe("@a.position y at end is 100 (wanted > 200)");
  });

  it("checks settling", () => {
    const e = { description: "d", target: "@a.position", component: "y" };
    expect(evaluateExpectation({ ...e, settled: true }, times, settling).pass).toBe(true);
    expect(evaluateExpectation({ ...e, settlesWithinMs: 110 }, times, settling).pass).toBe(true);
    expect(evaluateExpectation({ ...e, settlesWithinMs: 50 }, times, settling).pass).toBe(false);
    const moving = times.map((_, i) => i * 10);
    expect(evaluateExpectation({ description: "d", target: "x.output", settled: true }, times, moving).detail).toContain("still moving");
    expect(evaluateExpectation({ description: "d", target: "x.output", settled: false }, times, moving).pass).toBe(true);
  });
});

describe("segmentEvents", () => {
  const frames = (events: Parameters<typeof segmentEvents>[0], durationMs: number) =>
    segmentEvents(events, durationMs, 60).map((s) => [s.startFrame, s.endFrame, s.events.map((e) => [e.index, e.event.atMs])]);

  it("is one segment without events", () => {
    expect(frames([], 1000)).toEqual([[0, 60, []]]);
  });

  it("starts each group one frame before its first input fires", () => {
    const out = frames([{ kind: "tap", target: "@a", atMs: 100 }, { kind: "tap", target: "@b", atMs: 900 }], 1500);
    expect(out.map(([s, e]) => [s, e])).toEqual([[0, 5], [5, 53], [53, 90]]);
    expect(out[1]![2]).toEqual([[0, expect.closeTo(16.67, 1)]]);
    expect(out[2]![2]).toEqual([[1, expect.closeTo(16.67, 1)]]);
  });

  it("keeps overlapping inputs together and sorts by time", () => {
    const out = frames([{ kind: "tap", target: "@b", atMs: 200 }, { kind: "drag", from: "@a", to: [0, 0], durationMs: 300, atMs: 0 }], 1000);
    expect(out).toEqual([[0, 60, [[1, 0], [0, 200]]]]);
  });

  it("drops inputs scheduled past the end", () => {
    expect(frames([{ kind: "tap", target: "@a", atMs: 5000 }], 500)).toEqual([[0, 30, []]]);
  });
});
