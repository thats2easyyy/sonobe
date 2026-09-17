import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, isPlainObject, loopOf } from "../infra/index.ts";
import { dedupe, loopDedupePatch } from "./loopDedupe.ts";

/** The catalog's reference `same`, compared pairwise. */
function same(a: unknown, b: unknown, variant: string): boolean {
  switch (variant) {
    case "number":
    case "index":
    case "boolean":
    case "enum":
    case "text":
      return a === b;
    case "color": {
      const x = a as { r: number; g: number; b: number; a: number };
      const y = b as typeof x;
      return (["r", "g", "b", "a"] as const).every((k) => Math.round(x[k] * 255) === Math.round(y[k] * 255));
    }
    case "json":
      return deepEqual(a, b);
    default:
      return (a as number[]).length === (b as number[]).length && (a as number[]).every((c, i) => c === (b as number[])[i]);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return a === b;
}

function reference(items: readonly unknown[], variant: string): unknown[] {
  const unique: unknown[] = [];
  for (const item of items) if (!unique.some((kept) => same(kept, item, variant))) unique.push(item);
  return unique;
}

describe("loopDedupe", () => {
  it("keeps the first of each value in order", () => {
    const h = createPatchHarness(loopDedupePatch, { typeParam: "text", inputs: { loop: loopOf(["b", "a", "b", "c", "a"]) } });
    expect(h.step().outputs).toEqual({ output: loopOf(["b", "a", "c"]), index: loopOf([0, 1, 2]) });
  });

  it("compares numbers exactly, with 0 equal to −0", () => {
    const h = createPatchHarness(loopDedupePatch, { inputs: { loop: loopOf([0, -0, 0.3, 0.1 + 0.2, 1, 1]) } });
    expect(h.step().outputs.output).toEqual(loopOf([0, 0.3, 0.1 + 0.2, 1]));
  });

  it("is case-sensitive for text", () => {
    const h = createPatchHarness(loopDedupePatch, { typeParam: "text", inputs: { loop: loopOf(["Apple", "apple", "Apple"]) } });
    expect(h.step().outputs.output).toEqual(loopOf(["Apple", "apple"]));
  });

  it("matches colors that store as the same 8-bit hex color", () => {
    const red = (r: number) => ({ r, g: 0, b: 0, a: 1 });
    const h = createPatchHarness(loopDedupePatch, { typeParam: "color", inputs: { loop: loopOf([red(0.5), red(0.501), red(0.498)]) } });
    expect(h.step().outputs.output).toEqual(loopOf([red(0.5), red(0.498)]));
  });

  it("compares vectors component by component", () => {
    const h = createPatchHarness(loopDedupePatch, { typeParam: "point", inputs: { loop: loopOf([[1, 2], [1, 2], [2, 1], [0, -0], [-0, 0]]) } });
    expect(h.step().outputs.output).toEqual(loopOf([[1, 2], [2, 1], [0, -0]]));
  });

  it("compares JSON deeply in any key order", () => {
    const loop = loopOf([{ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }, { a: 1, b: [2, 1] }, null, null, 1, "1", [1], { a: undefined }, {}]);
    const h = createPatchHarness(loopDedupePatch, { typeParam: "json", inputs: { loop } });
    expect(h.step().outputs.output).toEqual(loopOf([{ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] }, null, 1, "1", [1], { a: undefined }, {}]));
  });

  it("never merges NaN items, which aren't === to anything", () => {
    expect(dedupe([Number.NaN, Number.NaN, 1, 1], "number")).toEqual([Number.NaN, Number.NaN, 1]);
    expect(dedupe([[Number.NaN, 1], [Number.NaN, 1]], "point")).toHaveLength(2);
  });

  it("returns exactly what the pairwise comparison returns", () => {
    const fixtures: [string, unknown[]][] = [
      ["number", [3, 1, 3, -0, 0, 2.5, 2.5, 1e21, 1e21]],
      ["index", [0, 1, 1, 4, 0]],
      ["boolean", [true, false, true, false]],
      ["enum", ["linear", "cubicIn", "linear"]],
      ["color", [{ r: 1, g: 0.2, b: 0, a: 1 }, { r: 1, g: 0.2004, b: 0, a: 1 }, { r: 1, g: 0.21, b: 0, a: 1 }, { r: 1, g: 0.2, b: 0, a: 0.999 }]],
      ["point4d", [[1, 2, 3, 4], [1, 2, 3, 4], [4, 3, 2, 1]]],
      ["anchor", [[0.5, 0.5], [0.5, 0.5], [0, 1]]],
      ["json", [{ x: { y: [1, { z: 2 }] } }, { x: { y: [1, { z: 2 }] } }, { x: { y: [1, { z: "2" }] } }, [], [[]], [], true, "true", { "a,b": 1 }, { a: 1, b: 1 }]],
    ];
    for (const [variant, items] of fixtures) expect(dedupe(items, variant), variant).toEqual(reference(items, variant));
  });

  it("gives empty loops for an empty loop and one-item loops for a single value", () => {
    const h = createPatchHarness(loopDedupePatch);
    expect(h.step().outputs).toEqual({ output: loopOf([]), index: loopOf([]) });
    expect(h.step({ inputs: { loop: 9 } }).outputs).toEqual({ output: loopOf([9]), index: loopOf([0]) });
  });

  it("passes Loop through with every index while muted", () => {
    expect(loopDedupePatch.mutedBehavior).toBe("evaluate");
    const result = runPatch(loopDedupePatch, [{ loop: loopOf([1, 1, 2]) }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ output: loopOf([1, 1, 2]), index: loopOf([0, 1, 2]) });
  });
});
