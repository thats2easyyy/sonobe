import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { point } from "./point.ts";
import { point4dUnpack } from "./point4dUnpack.ts";

describe("pack and unpack helpers", () => {
  it("warn once per loop index about non-finite components, and again after a restart", () => {
    const h = createPatchHarness(point, { id: "dot_position", inputs: { x: loopOf([Number.NaN, 1, Number.POSITIVE_INFINITY]), y: 2 } });
    expect(h.step().outputs.output).toEqual(loopOf([[0, 2], [1, 2], [0, 2]]));
    h.run(3);
    expect(h.logs.map((l) => l.level)).toEqual(["warn", "warn"]);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(4);
  });

  it("emit a new array every frame so history patches never see a mutated value", () => {
    const h = createPatchHarness(point, { inputs: { x: 1, y: 2 } });
    const first = h.step().outputs.output;
    const second = h.step().outputs.output;
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("give empty outputs for an empty loop in the runtime evaluator", () => {
    const packed = runPatch(point, [{ x: loopOf([]), y: 3 }]);
    expect(packed.frames[0]!.outputs.output).toEqual(loopOf([]));
    const unpacked = runPatch(point4dUnpack, [{ value: loopOf([]) }]);
    for (const key of ["x", "y", "z", "w"]) expect(unpacked.frames[0]!.outputs[key]).toEqual(loopOf([]));
  });

  it("read a malformed upstream vector as zeros with one warning instead of throwing", () => {
    const h = createPatchHarness(point4dUnpack, { inputs: { value: loopOf([[1, 2, Number.NaN, 4]]) } });
    expect(h.step().outputs).toMatchObject({ x: loopOf([1]), y: loopOf([2]), z: loopOf([0]), w: loopOf([4]) });
    expect(h.logs).toHaveLength(1);
  });
});
