import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { resolvePath, valueAtPath } from "./valueAtPath.ts";

const data = {
  user: { name: "Ada", tags: ["x", "y"] },
  items: [{ title: "One", price: 3 }, { title: "Two" }, { price: 5 }],
  "2024": { total: 7 },
};

describe("resolvePath", () => {
  it("returns the whole value for an empty path", () => {
    expect(resolvePath(data, "")).toEqual({ ok: true, value: data });
  });

  it("walks keys and array positions", () => {
    expect(resolvePath(data, "user.tags.1")).toEqual({ ok: true, value: "y" });
    expect(resolvePath(data, "items.01.title")).toEqual({ ok: true, value: "Two" });
    expect(resolvePath(data, "2024.total")).toEqual({ ok: true, value: 7 });
    expect(resolvePath([[1, 2]], "0.1")).toEqual({ ok: true, value: 2 });
  });

  it("reports missing steps, empty steps, and negative positions as not found", () => {
    for (const path of ["user.age", "a..b", "user.", ".user", "..", "items.-1", "items.3", "user.name.length"]) {
      expect(resolvePath(data, path).ok, path).toBe(false);
    }
  });

  it("collects every child for *", () => {
    expect(resolvePath(data, "items.*.title")).toEqual({ ok: true, value: ["One", "Two"] });
    expect(resolvePath(data, "user.*")).toEqual({ ok: true, value: ["Ada", ["x", "y"]] });
    expect(resolvePath(data, "items.*.missing")).toEqual({ ok: true, value: [] });
    expect(resolvePath(data, "user.name.*").ok).toBe(false);
  });

  it("flattens several wildcards into one array", () => {
    expect(resolvePath({ groups: [{ items: [1, 2] }, { items: [3] }] }, "groups.*.items.*")).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it("searches every depth in document order with a leading ..", () => {
    expect(resolvePath(data, "..title")).toEqual({ ok: true, value: ["One", "Two"] });
    expect(resolvePath(data, "..price")).toEqual({ ok: true, value: [3, 5] });
    expect(resolvePath({ a: { a: { b: 1 } } }, "..a")).toEqual({ ok: true, value: [{ a: { b: 1 } }, { b: 1 }] });
    expect(resolvePath({ a: { a: { b: 1 } } }, "..a.b")).toEqual({ ok: true, value: [1] });
    expect(resolvePath(data, "..nothing")).toEqual({ ok: true, value: [] });
    expect(resolvePath({ "*": 1, x: 2 }, "..*")).toEqual({ ok: true, value: [1] });
  });
});

describe("valueAtPath", () => {
  it("outputs what the path leads to, read as the patch's type", () => {
    const h = createPatchHarness(valueAtPath, { typeParam: "number", inputs: { object: data, path: "items.0.price" } });
    expect(h.step().outputs).toEqual({ value: 3, found: true });
    expect(h.step({ inputs: { path: "items.1.price" } }).outputs).toEqual({ value: 0, found: false });
    const text = createPatchHarness(valueAtPath, { typeParam: "text", inputs: { object: data, path: "user.name" } });
    expect(text.step().outputs.value).toBe("Ada");
  });

  it("reads several paths from one object per loop index", () => {
    const h = createPatchHarness(valueAtPath, { inputs: { object: data, path: loopOf(["user.name", "items.*.price", "nope"]) } });
    const f = h.step();
    expect(f.outputs.value).toEqual(loopOf(["Ada", [3, 5], null]));
    expect(f.outputs.found).toEqual(loopOf([true, true, false]));
  });

  it("stops past 256 levels of nesting with one warning", () => {
    let node: unknown = 1;
    for (let i = 0; i < 300; i++) node = { a: node };
    const h = createPatchHarness(valueAtPath, { inputs: { object: node, path: Array.from({ length: 300 }, () => "a").join(".") } });
    expect(h.step().outputs.found).toBe(false);
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
