import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { size } from "./size.ts";

describe("size", () => {
  it("packs Width and Height, starting at [100, 100] so a wired layer stays visible", () => {
    const h = createPatchHarness(size);
    expect(h.step().outputs.output).toEqual([100, 100]);
    expect(h.step({ inputs: { width: 220, height: 56 } }).outputs.output).toEqual([220, 56]);
  });

  it("lets negative sizes through (min 0 is a soft inspector limit)", () => {
    const h = createPatchHarness(size, { inputs: { width: -10, height: 0 } });
    expect(h.step().outputs.output).toEqual([-10, 0]);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(size, { inputs: { width: loopOf([160, 240]), height: 56 } });
    expect(h.step().outputs.output).toEqual(loopOf([[160, 56], [240, 56]]));
  });

  it("uses 0 for a non-finite input and warns once", () => {
    const h = createPatchHarness(size, { id: "bar_size", inputs: { width: Number.NaN } });
    expect(h.step().outputs.output).toEqual([0, 100]);
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["bar_size got a value that isn't a finite number and used 0"]);
  });
});
