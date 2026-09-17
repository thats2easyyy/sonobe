import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { objectJoin } from "./objectJoin.ts";

describe("objectJoin", () => {
  it("merges shallowly, with later inputs winning", () => {
    const h = createPatchHarness(objectJoin, { inputs: { object1: { a: 1, b: { x: 1 } }, object2: { b: { y: 2 }, c: 3 } } });
    expect(h.step().outputs.object).toEqual({ a: 1, b: { y: 2 }, c: 3 });
    expect(createPatchHarness(objectJoin).step().outputs.object).toEqual({});
  });

  it("keeps each key where it first appeared", () => {
    const h = createPatchHarness(objectJoin, { inputs: { object1: { b: 1, a: 1 }, object2: { a: 2, c: 3 } } });
    const out = h.step().outputs.object as object;
    expect(Object.keys(out)).toEqual(["b", "a", "c"]);
    expect(out).toEqual({ b: 1, a: 2, c: 3 });
  });

  it("never mutates inputs", () => {
    const first = { a: 1 };
    createPatchHarness(objectJoin, { inputs: { object1: first, object2: { b: 2 } } }).step();
    expect(first).toEqual({ a: 1 });
  });

  it("skips null silently and warns once per input for other values", () => {
    const h = createPatchHarness(objectJoin, { inputCount: 3, inputs: { object1: null, object2: [1], object3: { z: 1 } } });
    expect(h.step().outputs.object).toEqual({ z: 1 });
    h.step();
    const warnings = h.logs.filter((l) => l.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("Object 2");
  });

  it("stores __proto__ keys without changing the prototype", () => {
    const h = createPatchHarness(objectJoin, { inputs: { object1: JSON.parse('{"__proto__":{"polluted":true}}') } });
    const out = h.step().outputs.object as Record<string, unknown>;
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("zips looped inputs into a loop of merged objects", () => {
    const h = createPatchHarness(objectJoin, { inputs: { object1: loopOf([{ id: 1 }, { id: 2 }]), object2: { on: true } } });
    expect(h.step().outputs.object).toEqual(
      loopOf([
        { id: 1, on: true },
        { id: 2, on: true },
      ]),
    );
  });
});
