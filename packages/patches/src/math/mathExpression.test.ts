import type { SonobeDocument } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { mathExpression } from "./mathExpression.ts";

const withText = (expression: string, inputs: Record<string, unknown> = {}) => createPatchHarness(mathExpression, { settings: { expression }, inputs });

describe("mathExpression", () => {
  it("evaluates statements in order, feeding named results forward", () => {
    const h = withText("area = width * height; area * 2", { width: 3, height: 4 });
    expect(h.step().outputs).toEqual({ area: 12, output: 24 });
    expect(h.step({ inputs: { height: 0.5 } }).outputs).toEqual({ area: 1.5, output: 3 });
  });

  it("reads unconnected variables as 0 and coerces inputs to numbers", () => {
    expect(withText("a + b", { a: true }).step().outputs.output).toBe(1);
  });

  it("derives its ports from the expression in a real runtime", () => {
    const node = { type: "mathExpression", inputs: {}, settings: { expression: "w = side * 2; w * side" }, ui: { x: 0, y: 0 } };
    const ports = mathExpression.dynamicPorts!(node, {} as SonobeDocument);
    expect(ports.inputs.map((p) => p.key)).toEqual(["side"]);
    expect(ports.outputs.map((p) => p.key)).toEqual(["w", "output"]);
    const run = runPatch(mathExpression, [{ side: 3 }, { side: loopOf([1, 2]) }], { settings: { expression: "w = side * 2; w * side" } });
    expect(run.frames[0]!.outputs).toEqual({ w: 6, output: 18 });
    expect(run.frames[1]!.outputs).toEqual({ w: loopOf([2, 4]), output: loopOf([2, 8]) });
    expect(run.issues).toEqual([]);
  });

  it("outputs 0 for non-finite results and warns once per loop index until restart", () => {
    const h = withText("1 / x; atan(1 / x); -x", { x: 0 });
    const outputs = h.run(2).outputs;
    expect(outputs.output).toBe(0);
    expect(outputs.output2).toBe(Math.PI / 2);
    expect(Object.is(outputs.output3, 0)).toBe(true);
    expect(h.logs.map((l) => l.message)).toEqual(["patch_1.output isn't a finite number, so it outputs 0"]);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(2);
    const looped = withText("1 / x", { x: loopOf([0, 0]) });
    looped.run(2);
    expect(looped.logs).toHaveLength(2);
  });

  it("outputs 0 on the lenient outputs and logs one error for invalid text", () => {
    const h = withText("a = b ^ 2; b + 1", { b: 3 });
    expect(h.run(3).outputs).toEqual({ a: 0, output: 0 });
    expect(h.logs.map((l) => [l.level, l.message])).toEqual([["error", "patch_1: Use `**` for powers, like `x ** 2`. (column 7)"]]);
  });

  it("does nothing for an empty expression", () => {
    const h = withText("");
    expect(h.step().outputs).toEqual({});
    expect(h.logs).toEqual([]);
    expect(createPatchHarness(mathExpression).step().outputs).toEqual({});
  });
});
