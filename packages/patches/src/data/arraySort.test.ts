import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { arraySort, compareJson } from "./arraySort.ts";

const sorted = (array: unknown, inputs: Record<string, unknown> = {}) => createPatchHarness(arraySort, { inputs: { array, ...inputs } }).step().outputs.output;

describe("arraySort", () => {
  it("sorts numbers ascending by default and descending on request", () => {
    expect(sorted([3, 1, 2])).toEqual([1, 2, 3]);
    expect(sorted([3, 1, 2], { sortBy: "descending" })).toEqual([3, 2, 1]);
  });

  it("compares text by lowercase code units, uppercase first on ties", () => {
    expect(sorted(["b", "B", "é", "a", "z", "A"])).toEqual(["A", "a", "B", "b", "z", "é"]);
    expect(sorted(["item 10", "item 9"])).toEqual(["item 10", "item 9"]);
  });

  it("orders mixed kinds: null, booleans, numbers, text, arrays, objects", () => {
    expect(sorted([{ o: 1 }, "t", [1], 2, true, null, false])).toEqual([null, false, true, 2, "t", [1], { o: 1 }]);
    expect(compareJson([2], [1])).toBe(0);
  });

  it("keeps ties in input order in both directions", () => {
    const items = [
      { p: 1, id: "a" },
      { p: 2, id: "b" },
      { p: 1, id: "c" },
    ];
    expect((sorted(items, { key: "p", sortBy: "descending" }) as { id: string }[]).map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect((sorted(items, { key: "p" }) as { id: string }[]).map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts by a field with missing fields and non-objects last in both directions", () => {
    const items = [{ p: 2 }, { q: 1 }, { p: null }, "x", { p: 1 }];
    expect(sorted(items, { key: "p" })).toEqual([{ p: null }, { p: 1 }, { p: 2 }, { q: 1 }, "x"]);
    expect(sorted(items, { key: "p", sortBy: "descending" })).toEqual([{ p: 2 }, { p: 1 }, { p: null }, { q: 1 }, "x"]);
  });

  it("sorts a copy", () => {
    const input = [2, 1];
    sorted(input);
    expect(input).toEqual([2, 1]);
  });

  it("outputs [] for non-arrays with one warning", () => {
    const h = createPatchHarness(arraySort, { inputs: { array: "text" } });
    expect(h.step().outputs.output).toEqual([]);
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
