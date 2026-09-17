import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { jsonArray } from "./jsonArray.ts";

describe("jsonArray", () => {
  it("collects every item port in order, using zero values for unset items", () => {
    expect(createPatchHarness(jsonArray).step().outputs.array).toEqual([0, 0]);
    const h = createPatchHarness(jsonArray, { inputCount: 3, inputs: { item0: 5, item2: 7 } });
    expect(h.step().outputs.array).toEqual([5, 0, 7]);
  });

  it("writes colors as #RRGGBBAA text and vectors as lists", () => {
    const colors = createPatchHarness(jsonArray, { typeParam: "color", inputs: { item0: { r: 1, g: 0, b: 0, a: 1 } } });
    expect(colors.step().outputs.array).toEqual(["#FF0000FF", "#00000000"]);
    const points = createPatchHarness(jsonArray, { typeParam: "point", inputs: { item1: [3, 4] } });
    expect(points.step().outputs.array).toEqual([
      [0, 0],
      [3, 4],
    ]);
  });

  it("stores non-finite numbers as 0 and warns once", () => {
    const h = createPatchHarness(jsonArray, { inputs: { item0: Number.NaN, item1: Number.POSITIVE_INFINITY } });
    expect(h.step().outputs.array).toEqual([0, 0]);
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("builds a new array every frame and passes JSON items by reference", () => {
    const data = { id: 1 };
    const h = createPatchHarness(jsonArray, { typeParam: "json", inputs: { item0: data, item1: [1, 2] } });
    const a = h.step().outputs.array as unknown[];
    const b = h.step().outputs.array as unknown[];
    expect(a).not.toBe(b);
    expect(b).toEqual([data, [1, 2]]);
    expect(b[0]).toBe(data);
  });

  it("gives a loop of arrays when an item loops", () => {
    const h = createPatchHarness(jsonArray, { inputs: { item0: loopOf([1, 2, 3]), item1: 9 } });
    expect(h.step().outputs.array).toEqual(
      loopOf([
        [1, 9],
        [2, 9],
        [3, 9],
      ]),
    );
  });

  it("declares item ports counted from 0 as dynamic ports", () => {
    const ports = jsonArray.dynamicPorts!({ type: "jsonArray", typeParam: "text", inputCount: 3, inputs: {}, ui: { x: 0, y: 0 } }, {} as never);
    expect(ports.inputs.map((p) => p.key)).toEqual(["item0", "item1", "item2"]);
    expect(ports.inputs[0]).toMatchObject({ type: "text", default: "" });
    expect(ports.outputs).toEqual([]);
  });

  it("outputs [] while muted", () => {
    const run = runPatch(jsonArray, [{ item0: { a: 1 } }], { muted: true, typeParam: "json" });
    expect(run.frames[0]!.outputs.array).toEqual([]);
  });
});
