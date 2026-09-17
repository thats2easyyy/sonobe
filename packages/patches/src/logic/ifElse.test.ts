import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { ifElse } from "./ifElse.ts";

describe("ifElse", () => {
  it("chooses If True while Condition is on", () => {
    const h = createPatchHarness(ifElse);
    expect(h.step().outputs.output).toBe(0);
    expect(h.step({ inputs: { condition: true } }).outputs.output).toBe(1);
    expect(h.step({ inputs: { condition: 0.5, ifTrue: 42 } }).outputs.output).toBe(42);
    expect(h.step({ inputs: { condition: "off", ifFalse: 7 } }).outputs.output).toBe(7);
  });

  it("uses friendly defaults for other variants", () => {
    const text = createPatchHarness(ifElse, { typeParam: "text" });
    expect(text.step().outputs.output).toBe("Off");
    expect(text.step({ inputs: { condition: true } }).outputs.output).toBe("On");
    const color = createPatchHarness(ifElse, { typeParam: "color", inputs: { condition: true } });
    expect(color.step().outputs.output).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(color.step({ inputs: { condition: false } }).outputs.output).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(runPatch(ifElse, [{ condition: true }], { typeParam: "boolean" }).frames[0]!.outputs.output).toBe(true);
  });

  it("chooses per loop index", () => {
    const h = createPatchHarness(ifElse, { typeParam: "text", inputs: { condition: loopOf([true, false, true]), ifTrue: "A", ifFalse: "B" } });
    expect(h.step().outputs.output).toEqual(loopOf(["A", "B", "A"]));
    expect(runPatch(ifElse, [{ condition: loopOf([]) }]).frames[0]!.outputs.output).toEqual(loopOf([]));
  });

  it("passes references and null through unchanged", () => {
    const hero = { assetId: "hero" };
    const h = createPatchHarness(ifElse, { typeParam: "image", inputs: { condition: true, ifTrue: hero, ifFalse: null } });
    expect(h.step().outputs.output).toEqual(hero);
    expect(h.step({ inputs: { condition: false } }).outputs.output).toBeNull();
  });

  it("passes If True through while muted, even for the boolean variant", () => {
    expect(runPatch(ifElse, [{ condition: false, ifTrue: 7, ifFalse: 3 }], { muted: true }).frames[0]!.outputs.output).toBe(7);
    expect(runPatch(ifElse, [{ condition: false, ifTrue: true, ifFalse: true }], { typeParam: "boolean", muted: true }).frames[0]!.outputs.output).toBe(true);
  });
});
