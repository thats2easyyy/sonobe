import { LAYER_TYPES } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { edges } from "./edges.ts";

describe("edges", () => {
  it("packs sides in top, right, bottom, left order, starting at zeros", () => {
    const h = createPatchHarness(edges);
    expect(h.step().outputs.output).toEqual([0, 0, 0, 0]);
    expect(h.step({ inputs: { top: 24, right: 20, bottom: 40, left: 16 } }).outputs.output).toEqual([24, 20, 40, 16]);
  });

  it("uses the same side order as a group's Padding", () => {
    const group = LAYER_TYPES.find((t) => t.type === "group")!;
    expect(group.props.find((p) => p.key === "padding")?.description).toMatch(/top, right, bottom, left/);
  });

  it("passes negative sides through", () => {
    const h = createPatchHarness(edges, { inputs: { top: -8 } });
    expect(h.step().outputs.output).toEqual([-8, 0, 0, 0]);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(edges, { inputs: { bottom: loopOf([10, 20]), left: 4 } });
    expect(h.step().outputs.output).toEqual(loopOf([[0, 0, 10, 4], [0, 0, 20, 4]]));
  });

  it("uses 0 for a non-finite side and warns once", () => {
    const h = createPatchHarness(edges, { id: "inset", inputs: { right: Number.NaN } });
    expect(h.step().outputs.output).toEqual([0, 0, 0, 0]);
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["inset: a side isn't a finite number, so Edges uses 0 for it"]);
  });
});
