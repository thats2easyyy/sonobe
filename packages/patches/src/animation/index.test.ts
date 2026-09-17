import { describe, expect, it } from "vitest";
import { CATALOG_CHUNKS, getSpec } from "../specs.ts";
import { definitions } from "./index.ts";

describe("animation definitions", () => {
  it("define every animation catalog patch once, in catalog order", () => {
    const catalog = CATALOG_CHUNKS.filter((chunk) => chunk.category === "animation").flatMap((chunk) => chunk.patches.map((p) => p.type));
    expect(definitions.map((d) => d.type)).toEqual(catalog);
  });

  it("keep their catalog specs and have evaluators", () => {
    for (const def of definitions) {
      const spec = getSpec(def.type)!;
      expect(def.category, def.type).toBe("animation");
      expect(def.inputs, def.type).toEqual(spec.inputs);
      expect(def.outputs, def.type).toEqual(spec.outputs);
      expect(def.variants, def.type).toEqual(spec.variants);
      expect(typeof def.evaluate, def.type).toBe("function");
    }
  });

  it("declare muted behavior where the default bypass would be wrong", () => {
    const muted = Object.fromEntries(
      definitions.filter((d) => d.mutedBehavior !== undefined).map((d) => [d.type, d.mutedBehavior]),
    );
    expect(muted).toEqual({
      transition: "evaluate",
      repeatingAnimation: "zero",
      velocity: "zero",
      springPreset: "evaluate",
      cubicBezierAnimation: "evaluate",
      arcTransition: "evaluate",
      keyframes: "evaluate",
    });
  });

  it("give Keyframes dynamic ports", () => {
    expect(typeof definitions.find((d) => d.type === "keyframes")!.dynamicPorts).toBe("function");
  });
});
