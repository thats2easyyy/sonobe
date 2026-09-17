import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { getKeys } from "./getKeys.ts";

describe("getKeys", () => {
  it("lists top-level keys in JavaScript key order", () => {
    const object = JSON.parse('{"b":1,"10":2,"a":null,"2":{"nested":1}}');
    expect(createPatchHarness(getKeys, { inputs: { object } }).step().outputs.keys).toEqual(["2", "10", "b", "a"]);
    expect(createPatchHarness(getKeys).step().outputs.keys).toEqual([]);
  });

  it("builds a new array every frame", () => {
    const h = createPatchHarness(getKeys, { inputs: { object: { a: 1 } } });
    expect(h.step().outputs.keys).not.toBe(h.step().outputs.keys);
  });

  it("outputs [] for null silently and warns once for other values", () => {
    const quiet = createPatchHarness(getKeys, { inputs: { object: null } });
    expect(quiet.step().outputs.keys).toEqual([]);
    expect(quiet.logs).toEqual([]);
    const loud = createPatchHarness(getKeys, { inputs: { object: [1, 2] } });
    expect(loud.step().outputs.keys).toEqual([]);
    loud.step();
    expect(loud.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("gives a loop of key arrays for a loop of objects", () => {
    const h = createPatchHarness(getKeys, { inputs: { object: loopOf([{ a: 1 }, { b: 1, c: 2 }]) } });
    expect(h.step().outputs.keys).toEqual(loopOf([["a"], ["b", "c"]]));
  });
});
