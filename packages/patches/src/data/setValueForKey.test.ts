import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { setValueForKey } from "./setValueForKey.ts";

describe("setValueForKey", () => {
  it("replaces a key in place and appends new keys at the end", () => {
    const h = createPatchHarness(setValueForKey, { inputs: { object: { a: 1, b: 2 }, key: "a", value: 9 } });
    const replaced = h.step().outputs.output as Record<string, unknown>;
    expect(replaced).toEqual({ a: 9, b: 2 });
    expect(Object.keys(replaced)).toEqual(["a", "b"]);
    expect(Object.keys(h.step({ inputs: { key: "c" } }).outputs.output as object)).toEqual(["a", "b", "c"]);
  });

  it("never mutates the incoming object", () => {
    const input = { a: 1 };
    const h = createPatchHarness(setValueForKey, { inputs: { object: input, key: "b", value: 2 } });
    expect(h.step().outputs.output).not.toBe(input);
    expect(input).toEqual({ a: 1 });
  });

  it("passes Object through unchanged for an empty key", () => {
    const input = { a: 1 };
    expect(createPatchHarness(setValueForKey, { inputs: { object: input } }).step().outputs.output).toBe(input);
  });

  it("starts from {} for null silently and for other values with one warning", () => {
    const quiet = createPatchHarness(setValueForKey, { typeParam: "text", inputs: { object: null, key: "k", value: "v" } });
    expect(quiet.step().outputs.output).toEqual({ k: "v" });
    expect(quiet.logs).toEqual([]);
    const loud = createPatchHarness(setValueForKey, { inputs: { object: ["x"], key: "k" } });
    expect(loud.step().outputs.output).toEqual({ k: 0 });
    loud.step();
    expect(loud.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("stores __proto__ as an own key", () => {
    const out = createPatchHarness(setValueForKey, { inputs: { object: {}, key: "__proto__", value: 1 } }).step().outputs.output as object;
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("sets the field on every looped object, with per-item values", () => {
    const h = createPatchHarness(setValueForKey, {
      typeParam: "boolean",
      inputs: { object: loopOf([{ id: 1 }, { id: 2 }]), key: "selected", value: loopOf([true, false]) },
    });
    expect(h.step().outputs.output).toEqual(
      loopOf([
        { id: 1, selected: true },
        { id: 2, selected: false },
      ]),
    );
  });
});
