import { applyOps, createEmptyDocument, getPatchSpec, type PatchNode } from "@sonobe/core";
import { fromBouncinessSpeed } from "@sonobe/engine";
import { springPresetValues } from "@sonobe/patches/infra";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { activePreset, handoffSnippets, isSpringPatch, planPreset, presetInputs, springConfigForNode, springCurveGeometry } from "./spring.ts";

const registry = getRegistry();
const spec = (type: string) => getPatchSpec(registry, type)!;
const node = (type: string, inputs: PatchNode["inputs"] = {}): PatchNode => ({ type, inputs, ui: { x: 0, y: 0 } });

describe("spring inspector helpers", () => {
  it("reads the spring each patch type describes", () => {
    const pop = springConfigForNode(node("popAnimation"), spec("popAnimation"))!;
    const expected = fromBouncinessSpeed(5, 10);
    expect(pop.config.stiffness).toBeCloseTo(expected.stiffness, 6);
    expect(pop.config.damping).toBeCloseTo(expected.damping, 6);
    expect(pop.config.stiffness).toBeCloseTo(299.62, 1);

    const physical = springConfigForNode(node("springAnimation", { mass: 2, tension: 200, friction: 20 }), spec("springAnimation"))!;
    expect(physical.config).toEqual({ mass: 2, stiffness: 200, damping: 20 });

    const fluid = springConfigForNode(node("fluidSpringAnimation", { response: 0.5, dampingFraction: 0.825 }), spec("fluidSpringAnimation"))!;
    expect(fluid.config.stiffness).toBeCloseTo(157.9137, 3);
    expect(fluid.config.damping).toBeCloseTo(20.7345, 3);

    const preset = springConfigForNode(node("springPreset", { preset: "bouncy" }), spec("springPreset"))!;
    expect(preset.config.stiffness).toBeCloseTo(springPresetValues("bouncy").tension, 6);

    const linked = springConfigForNode(node("popAnimation", { speed: { link: "feel.speed" } }), spec("popAnimation"))!;
    expect(linked.linked).toEqual(["speed"]);
    expect(springConfigForNode(node("switch"), spec("switch"))).toBeUndefined();
    expect(isSpringPatch("fluidSpringAnimation")).toBe(true);
  });

  it("applies presets per patch type and recognizes them", () => {
    for (const type of ["popAnimation", "springAnimation", "fluidSpringAnimation", "springPreset"]) {
      const inputs = presetInputs(type, "snappy")!;
      expect(activePreset(node(type, inputs), spec(type))).toBe("snappy");
    }
    expect(activePreset(node("popAnimation"), spec("popAnimation"))).toBeNull();
    expect(activePreset(node("springPreset"), spec("springPreset"))).toBe("smooth");

    const doc = applyOps(createEmptyDocument(), [{ op: "addPatch", patch: { id: "pop", type: "popAnimation", typeParam: "number", ui: { x: 0, y: 0 } } }], { registry }).doc;
    const result = applyOps(doc, planPreset("main", "pop", "popAnimation", "bouncy"), { registry });
    expect(result.ok).toBe(true);
    const inputs = result.doc.components.main!.patches.pop!.inputs;
    expect(activePreset(result.doc.components.main!.patches.pop!, spec("popAnimation"))).toBe("bouncy");
    expect(Object.keys(inputs).sort()).toEqual(["bounciness", "speed"]);
  });

  it("reads knob-driven inputs as their knobs' values, and applies presets to those knobs", () => {
    const doc = applyOps(
      createEmptyDocument(),
      [
        { op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", value: 12 } },
        { op: "addPatch", patch: { id: "pop", type: "popAnimation", typeParam: "number", inputs: { bounciness: { link: "$knob.bounce" }, speed: 16 }, ui: { x: 0, y: 0 } } },
      ],
      { registry },
    ).doc;
    const readLink = (link: string) => (link === "$knob.bounce" ? doc.knobs!.knobs[0]!.values.default : undefined);
    const pop = doc.components.main!.patches.pop!;
    const reading = springConfigForNode(pop, spec("popAnimation"), readLink)!;
    expect(reading.linked).toEqual([]);
    expect(reading.config.stiffness).toBeCloseTo(fromBouncinessSpeed(12, 16).stiffness, 6);

    const ops = planPreset("main", "pop", "popAnimation", "bouncy", (port) => (port === "bounciness" ? "bounce" : undefined));
    expect(ops.map((op) => op.op)).toEqual(["setKnobValue", "setInput"]);
    const result = applyOps(doc, ops, { registry });
    expect(result.ok).toBe(true);
    const tuned = result.doc.knobs!.knobs[0]!.values.default;
    expect(result.doc.components.main!.patches.pop!.inputs.bounciness).toEqual({ link: "$knob.bounce" });
    expect(activePreset(result.doc.components.main!.patches.pop!, spec("popAnimation"), (link) => (link === "$knob.bounce" ? tuned : undefined))).toBe("bouncy");
  });

  it("builds curve geometry and handoff code", () => {
    const { config } = springConfigForNode(node("popAnimation", { bounciness: 12, speed: 12 }), spec("popAnimation"))!;
    const geometry = springCurveGeometry(config, 240, 90);
    expect(geometry.path.startsWith("M")).toBe(true);
    expect(geometry.values[0]).toBe(0);
    expect(geometry.targetY).toBeLessThan(geometry.startY);
    expect(geometry.overshoot).toBeGreaterThan(0);
    expect(geometry.settleTime).not.toBeNull();

    const snippets = handoffSnippets(config);
    expect(snippets.map((s) => s.id)).toEqual(["swiftui", "android", "css", "motion"]);
    expect(snippets[0]!.code).toContain(".spring(duration:");
    expect(snippets[1]!.code).toContain("SpringForce()");
    expect(snippets[2]!.code).toContain("linear(");
    expect(snippets[3]!.code).toContain('type: "spring"');
  });
});
