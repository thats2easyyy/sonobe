import { LAYER_TYPES } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { cornerRadii } from "./cornerRadii.ts";

describe("cornerRadii", () => {
  it("packs radii clockwise from the top left, starting at zeros", () => {
    const h = createPatchHarness(cornerRadii);
    expect(h.step().outputs.output).toEqual([0, 0, 0, 0]);
    expect(h.step({ inputs: { topLeft: 20, topRight: 20, bottomRight: 6, bottomLeft: 20 } }).outputs.output).toEqual([20, 20, 6, 20]);
  });

  it("uses the same corner order as the Corner Radii layer property", () => {
    const rectangle = LAYER_TYPES.find((t) => t.type === "rectangle")!;
    expect(rectangle.props.find((p) => p.key === "cornerRadii")?.description).toMatch(/topLeft, topRight, bottomRight, bottomLeft/);
  });

  it("passes negative radii through (min 0 is a soft inspector limit)", () => {
    const h = createPatchHarness(cornerRadii, { inputs: { bottomLeft: -3 } });
    expect(h.step().outputs.output).toEqual([0, 0, 0, -3]);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(cornerRadii, { inputs: { topLeft: loopOf([8, 16]), topRight: 24 } });
    expect(h.step().outputs.output).toEqual(loopOf([[8, 24, 0, 0], [16, 24, 0, 0]]));
  });

  it("uses 0 for a non-finite radius and warns once", () => {
    const h = createPatchHarness(cornerRadii, { id: "corners", inputs: { topRight: Number.POSITIVE_INFINITY } });
    expect(h.step().outputs.output).toEqual([0, 0, 0, 0]);
    h.step();
    expect(h.logs.map((l) => l.message)).toEqual(["corners: a radius isn't a finite number, so Corner Radii uses 0 for it"]);
  });
});
