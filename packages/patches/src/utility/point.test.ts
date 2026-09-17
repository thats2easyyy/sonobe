import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { point } from "./point.ts";

describe("point", () => {
  it("packs X and Y into [X, Y] on the same frame, starting at [0, 0]", () => {
    const h = createPatchHarness(point);
    expect(h.step().outputs.output).toEqual([0, 0]);
    expect(h.step({ inputs: { x: 186, y: 120 } }).outputs.output).toEqual([186, 120]);
  });

  it("never clamps", () => {
    const h = createPatchHarness(point, { inputs: { x: -40, y: 1e7 } });
    expect(h.step().outputs.output).toEqual([-40, 1e7]);
  });

  it("reads wired values as numbers", () => {
    const h = createPatchHarness(point, { inputs: { x: true, y: "33.5" } });
    expect(h.step().outputs.output).toEqual([1, 33.5]);
  });

  it("gives a loop of points: the longest loop sets the length, shorter ones wrap, scalars broadcast", () => {
    const h = createPatchHarness(point, { inputs: { x: loopOf([33, 105, 177]), y: 400 } });
    expect(h.step().outputs.output).toEqual(loopOf([[33, 400], [105, 400], [177, 400]]));
    h.set({ y: loopOf([1, 2]) });
    expect(h.step().outputs.output).toEqual(loopOf([[33, 1], [105, 2], [177, 1]]));
  });

  it("uses 0 for a non-finite input and warns once", () => {
    const h = createPatchHarness(point, { id: "card_position", inputs: { x: Number.NaN, y: 5 } });
    expect(h.step().outputs.output).toEqual([0, 5]);
    h.step({ inputs: { y: Number.NEGATIVE_INFINITY } });
    expect(h.output("output")).toEqual([0, 0]);
    expect(h.logs.map((l) => [l.level, l.message])).toEqual([["warn", "card_position got a value that isn't a finite number and used 0"]]);
  });

  it("outputs zeros while muted (no point input to pass through)", () => {
    const result = runPatch(point, [{ x: 4, y: 5 }], { muted: true });
    expect(result.frames[0]!.outputs.output).toEqual([0, 0]);
  });
});
