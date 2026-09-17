import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { colorControlsEffect } from "./colorControlsEffect.ts";

describe("colorControlsEffect", () => {
  it("starts neutral", () => {
    const h = createPatchHarness(colorControlsEffect);
    expect(h.step().outputs.effect).toEqual({ kind: "colorControls", params: { brightness: 0, contrast: 1, saturation: 1, hue: 0 } });
  });

  it("maps Hue Rotation to the hue param without wrapping", () => {
    const h = createPatchHarness(colorControlsEffect, { inputs: { brightness: 0.1, contrast: 1.2, saturation: 0, hueRotation: 540 } });
    expect(h.step().outputs.effect).toEqual({ kind: "colorControls", params: { brightness: 0.1, contrast: 1.2, saturation: 0, hue: 540 } });
  });

  it("clamps brightness at −1 and contrast and saturation at 0, with no upper clamps", () => {
    const h = createPatchHarness(colorControlsEffect, { inputs: { brightness: -3, contrast: -1, saturation: -2 } });
    expect(h.step().outputs.effect).toEqual({ kind: "colorControls", params: { brightness: -1, contrast: 0, saturation: 0, hue: 0 } });
    h.set({ brightness: 4, contrast: 9, saturation: 7 });
    expect(h.step().outputs.effect).toEqual({ kind: "colorControls", params: { brightness: 4, contrast: 9, saturation: 7, hue: 0 } });
  });

  it("uses each control's neutral value for non-finite input and warns once per control", () => {
    const h = createPatchHarness(colorControlsEffect, { inputs: { contrast: Number.NaN, hueRotation: Number.NEGATIVE_INFINITY } });
    h.run(3);
    expect(h.output("effect")).toEqual({ kind: "colorControls", params: { brightness: 0, contrast: 1, saturation: 1, hue: 0 } });
    expect(h.logs.map((l) => l.message)).toEqual([
      "Color Controls Effect: contrast isn't a finite number; using 1.",
      "Color Controls Effect: hueRotation isn't a finite number; using 0.",
    ]);
  });

  it("gives a loop of effects per loop index", () => {
    const h = createPatchHarness(colorControlsEffect, { inputs: { saturation: loopOf([0, 2]) } });
    expect(h.step().outputs.effect).toEqual(
      loopOf([
        { kind: "colorControls", params: { brightness: 0, contrast: 1, saturation: 0, hue: 0 } },
        { kind: "colorControls", params: { brightness: 0, contrast: 1, saturation: 2, hue: 0 } },
      ]),
    );
  });
});
