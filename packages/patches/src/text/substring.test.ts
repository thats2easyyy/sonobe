import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { substring, substringPatch } from "./substring.ts";

const run = (inputs: Record<string, unknown>) => createPatchHarness(substringPatch, { inputs }).step().outputs.output;

describe("substring", () => {
  it("keeps Length graphemes from Start", () => {
    expect(run({ text: "Saturday", start: 0, length: 3 })).toBe("Sat");
    expect(run({ text: "Saturday", start: 3, length: 3 })).toBe("urd");
    expect(run({ text: "Saturday", start: 8 })).toBe("");
    expect(run({ text: "Saturday", start: 5, length: 99 })).toBe("day");
    expect(run({ text: "👋🏽 hi", start: 0, length: 1 })).toBe("👋🏽");
    expect(run({ text: "Saturday" })).toBe("Sat");
  });

  it("adds an ellipsis only when characters after the kept part were cut off", () => {
    expect(run({ text: "Weekend hiking trails near the coast", length: 15, ellipsis: true })).toBe("Weekend hiking…");
    expect(run({ text: "Saturday", start: 5, length: 3, ellipsis: true })).toBe("day");
    expect(run({ text: "Saturday", start: 9, length: 3, ellipsis: true })).toBe("");
    expect(run({ text: "Saturday", length: 0, ellipsis: true })).toBe("");
    expect(run({ text: "abcdefghijkl", length: 10, ellipsis: true })).toBe("abcdefghij…");
  });

  it("never counts from the end and rounds fractions down after an epsilon", () => {
    expect(substring("Saturday", -2, 3, false)).toBe("Sat");
    expect(substring("Saturday", 0, -1, false)).toBe("");
    expect(substring("Saturday", 0, 2.9999999, false)).toBe("Sat");
    expect(substring("Saturday", 0, 2.5, false)).toBe("Sa");
    expect(substring("Saturday", Number.NaN, Number.POSITIVE_INFINITY, false)).toBe("");
    expect(run({ text: "Saturday", start: -4, length: 2 })).toBe("Sa");
  });

  it("evaluates per loop index", () => {
    expect(run({ text: loopOf(["Maya", "Chen"]), length: 1 })).toEqual(loopOf(["M", "C"]));
    expect(run({ text: "Saturday", start: loopOf([0, 3]), length: loopOf([3]) })).toEqual(loopOf(["Sat", "urd"]));
  });
});
