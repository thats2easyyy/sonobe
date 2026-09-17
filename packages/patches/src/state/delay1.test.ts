import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { delay1Patch } from "./delay1.ts";

describe("delay1", () => {
  it("outputs the first value on frame 0, then last frame's value", () => {
    const h = createPatchHarness(delay1Patch, { inputs: { value: 3 } });
    expect(h.step().outputs.output).toBe(3);
    const changed = h.step({ inputs: { value: 4 } });
    expect(changed.outputs.output).toBe(3);
    expect(changed.requestedNextFrame).toBe(true);
    const next = h.step({ inputs: { value: 9 } });
    expect(next.outputs.output).toBe(4);
    expect(h.step().outputs.output).toBe(9);
    expect(h.step().requestedNextFrame).toBe(false);
  });

  it("passes values of any type unchanged", () => {
    const h = createPatchHarness(delay1Patch, { typeParam: "point", inputs: { value: [1, 2] } });
    h.step();
    h.step({ inputs: { value: [5, -500000] } });
    expect(h.step().outputs.output).toEqual([5, -500000]);
  });

  it("keeps a register per loop index", () => {
    const h = createPatchHarness(delay1Patch, { inputs: { value: loopOf([1, 2]) } });
    expect(h.step().outputs.output).toEqual(loopOf([1, 2]));
    expect(h.step({ inputs: { value: loopOf([3, 4, 5]) } }).outputs.output).toEqual(loopOf([1, 2, 5]));
    expect(h.step().outputs.output).toEqual(loopOf([3, 4, 5]));
  });

  it("seeds again after a restart", () => {
    const h = createPatchHarness(delay1Patch, { inputs: { value: 1 } });
    h.step();
    h.restart();
    expect(h.step({ inputs: { value: 8 } }).outputs.output).toBe(8);
  });
});
