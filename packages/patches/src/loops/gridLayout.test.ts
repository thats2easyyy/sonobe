import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { gridLayoutPatch } from "./gridLayout.ts";

describe("gridLayout", () => {
  it("fills rows left to right with equal columns that exactly fill Width", () => {
    const h = createPatchHarness(gridLayoutPatch, { inputs: { columns: 3, origin: [16, 120], width: 370, itemHeight: 118, spacing: 8 } });
    expect(h.step().outputs).toEqual({ position: [16, 120], size: [118, 118] });
    expect(h.step({ inputs: { index: 2 } }).outputs.position).toEqual([268, 120]);
    expect(h.step({ inputs: { index: 4 } }).outputs.position).toEqual([142, 246]);
  });

  it("uses 100-point items in three columns by default", () => {
    const h = createPatchHarness(gridLayoutPatch);
    expect(h.step().outputs).toEqual({ position: [0, 0], size: [100, 100] });
    expect(h.step({ inputs: { index: 3 } }).outputs.position).toEqual([0, 108]);
  });

  it("evaluates once per index of a looped Index, placing items by value", () => {
    const h = createPatchHarness(gridLayoutPatch, { inputs: { index: loopOf([0, 1, 2, 3]), columns: 2, width: 316 } });
    expect(h.step().outputs).toEqual({
      position: loopOf([[0, 0], [162, 0], [0, 108], [162, 108]]),
      size: loopOf([[154, 100], [154, 100], [154, 100], [154, 100]]),
    });
    expect(h.step({ inputs: { index: loopOf([3, 0]) } }).outputs.position).toEqual(loopOf([[162, 108], [0, 0]]));
  });

  it("treats Columns below 1 or not finite as 1 and rounds decimals down", () => {
    const h = createPatchHarness(gridLayoutPatch, { inputs: { columns: 0, index: 2 } });
    expect(h.step().outputs).toEqual({ position: [0, 216], size: [316, 100] });
    expect(h.step({ inputs: { columns: Number.NaN } }).outputs.position).toEqual([0, 216]);
    expect(h.step({ inputs: { columns: 2.9, index: 3 } }).outputs.position).toEqual([162, 108]);
  });

  it("clamps item width at 0 when Spacing is too wide, and positions still advance by Spacing", () => {
    const h = createPatchHarness(gridLayoutPatch, { inputs: { columns: 3, width: 10, spacing: 20, index: 2 } });
    expect(h.step().outputs).toEqual({ position: [40, 0], size: [0, 100] });
  });

  it("clamps negative Item Height and overlaps items with negative Spacing", () => {
    const h = createPatchHarness(gridLayoutPatch, { inputs: { columns: 2, width: 100, spacing: -10, itemHeight: -5, index: 3 } });
    expect(h.step().outputs).toEqual({ position: [45, -10], size: [55, 0] });
  });

  it("counts non-finite Width, Item Height, and Spacing as 0", () => {
    const h = createPatchHarness(gridLayoutPatch, { inputs: { columns: 2, width: Number.NaN, itemHeight: Infinity, spacing: Number.NaN, index: 3 } });
    expect(h.step().outputs).toEqual({ position: [0, 0], size: [0, 0] });
    expect(h.logs).toEqual([]);
  });

  it("never outputs non-finite positions", () => {
    const h = createPatchHarness(gridLayoutPatch, { inputs: { columns: 1, itemHeight: 1e308, spacing: 1e308, index: 2 } });
    expect(h.step().outputs.position).toEqual([0, 0]);
    expect(h.logs.map((l) => l.message)).toEqual(["Grid Layout: a position got too large to show, so it outputs 0."]);
  });

  it("gives empty outputs for an empty Index loop in the runtime", () => {
    const result = runPatch(gridLayoutPatch, [{ index: loopOf([]) }, { index: loopOf([0, 4]) }]);
    expect(result.frames[0]!.outputs).toEqual({ position: loopOf([]), size: loopOf([]) });
    expect(result.frames[1]!.outputs.position).toEqual(loopOf([[0, 0], [108, 108]]));
  });
});
