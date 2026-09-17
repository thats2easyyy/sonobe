import { describe, expect, it } from "vitest";
import type { Color, LayerEffectValue } from "@sonobe/core";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { glassEffect } from "./glassEffect.ts";

const params = (effect: unknown) => (effect as LayerEffectValue).params as Record<string, number> & { tint: Color };

describe("glassEffect", () => {
  it("outputs full glass for the defaults", () => {
    const h = createPatchHarness(glassEffect);
    const effect = h.step().outputs.effect as LayerEffectValue;
    expect(effect.kind).toBe("glass");
    const p = params(effect);
    expect(p.frost).toBe(8);
    expect(p.tint.r).toBe(1);
    expect(p.tint.a).toBeCloseTo(0x26 / 255, 6);
    expect(p.refraction).toBe(0.5);
    expect(p.highlight).toBe(0.6);
    expect(p.saturation).toBeCloseTo(1.4, 12);
    expect(p.depth).toBe(16);
  });

  it("folds Intensity into every param except Depth", () => {
    const h = createPatchHarness(glassEffect, { inputs: { intensity: 0 } });
    expect(h.step().outputs.effect).toEqual({
      kind: "glass",
      params: { frost: 0, tint: { r: 1, g: 1, b: 1, a: 0 }, refraction: 0, highlight: 0, saturation: 1, depth: 16 },
    });
    h.set({ intensity: 0.5, frost: 10, tint: { r: 0, g: 0, b: 0, a: 0.4 }, refraction: 1, highlight: 0.2, saturation: 2, depth: 8 });
    expect(h.step().outputs.effect).toEqual({
      kind: "glass",
      params: { frost: 5, tint: { r: 0, g: 0, b: 0, a: 0.2 }, refraction: 0.5, highlight: 0.1, saturation: 1.5, depth: 8 },
    });
  });

  it("clamps Intensity, Refraction, and Highlight to 0–1 and negative Frost, Depth, and Saturation to 0", () => {
    const h = createPatchHarness(glassEffect, { inputs: { intensity: 3, refraction: -1, highlight: 4, frost: -5, depth: -2, saturation: -1 } });
    const p = params(h.step().outputs.effect);
    expect(p.refraction).toBe(0);
    expect(p.highlight).toBe(1);
    expect(p.frost).toBe(0);
    expect(p.depth).toBe(0);
    expect(p.saturation).toBe(0);
    expect(p.tint.a).toBeCloseTo(0x26 / 255, 6);
  });

  it("uses neutral values for non-finite input and warns once per port", () => {
    const h = createPatchHarness(glassEffect, { inputs: { intensity: Number.NaN, saturation: Number.POSITIVE_INFINITY } });
    h.run(2);
    const p = params(h.output("effect"));
    expect(p.frost).toBe(8);
    expect(p.saturation).toBe(1);
    expect(h.logs.map((l) => l.message)).toEqual(["Glass Effect: Intensity isn't a finite number; using 1.", "Glass Effect: Saturation isn't a finite number; using 1."]);
  });

  it("gives a loop of effects per loop index", () => {
    const h = createPatchHarness(glassEffect, { inputs: { intensity: loopOf([0, 1]) } });
    const out = h.step().outputs.effect as { items: LayerEffectValue[] };
    expect(out.items.map((e) => params(e).frost)).toEqual([0, 8]);
  });
});
