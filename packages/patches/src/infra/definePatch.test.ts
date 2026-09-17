import { describe, expect, it } from "vitest";
import { SPECS } from "../specs.ts";
import { definePatch } from "./definePatch.ts";
import { createPatchHarness } from "./harness.ts";
import { firstPulsed } from "./pulses.ts";

describe("definePatch", () => {
  it("merges the catalog spec with the implementation", () => {
    const state = () => ({ on: false });
    const evaluate = () => {};
    const def = definePatch("switch", { state, evaluate });
    const spec = SPECS.switch!;
    for (const [key, value] of Object.entries(spec)) expect((def as unknown as Record<string, unknown>)[key], key).toBe(value);
    expect(def.evaluate).toBe(evaluate);
    expect(def.state).toBe(state);
    expect(def).not.toHaveProperty("dispose");
    expect(def).not.toHaveProperty("dynamicPorts");
    expect(def).not.toBe(spec);
    expect(Object.isFrozen(def)).toBe(false);
  });

  it("passes dispose and dynamicPorts through", () => {
    const dispose = () => {};
    const dynamicPorts = () => ({ inputs: [], outputs: [] });
    const def = definePatch("javascript", { evaluate() {}, dispose, dynamicPorts });
    expect(def.dispose).toBe(dispose);
    expect(def.dynamicPorts).toBe(dynamicPorts);
  });

  it("carries muted behavior, and leaves it unset for the default bypass", () => {
    expect(definePatch("switch", { evaluate() {}, mutedBehavior: "zero" }).mutedBehavior).toBe("zero");
    expect(definePatch("switch", { evaluate() {}, mutedBehavior: "evaluate" }).mutedBehavior).toBe("evaluate");
    expect(definePatch("switch", { evaluate() {} })).not.toHaveProperty("mutedBehavior");
    expect(() => definePatch("switch", { evaluate() {}, mutedBehavior: "mute" as never })).toThrow(/mutedBehavior must be/);
  });

  it("throws with a suggestion for unknown types", () => {
    expect(() => definePatch("swtich", { evaluate() {} })).toThrow(/"swtich" isn't a catalog patch type\. Did you mean "switch"/);
    expect(() => definePatch("constructor", { evaluate() {} })).toThrow(/isn't a catalog patch type/);
  });

  it("requires evaluate", () => {
    expect(() => definePatch("switch", {} as never)).toThrow(/evaluate must be a function/);
  });

  it("types ctx.state from the state factory", () => {
    const def = definePatch("switch", {
      state: () => ({ on: false }),
      evaluate(ctx) {
        const winner = firstPulsed(ctx, ["turnOff", "turnOn", "flip"]);
        if (winner === "turnOff") ctx.state.on = false;
        else if (winner === "turnOn") ctx.state.on = true;
        else if (winner === "flip") ctx.state.on = !ctx.state.on;
        ctx.output("on", ctx.state.on);
      },
    });
    const h = createPatchHarness(def);
    expect(h.step({ pulses: ["flip"] }).outputs.on).toBe(true);
    expect(h.step({ pulses: ["flip", "turnOff"] }).outputs.on).toBe(false);
  });
});
