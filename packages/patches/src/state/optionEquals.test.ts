import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { optionEqualsPatch } from "./optionEquals.ts";

describe("optionEquals", () => {
  it("outputs the first matching option, or −1 when none match", () => {
    const h = createPatchHarness(optionEqualsPatch, { inputs: { value: 4, option0: 2, option1: 4, option2: 4 } });
    expect(h.step().outputs).toEqual({ option: 1, equals: true });
    expect(h.step({ inputs: { value: 7 } }).outputs).toEqual({ option: -1, equals: false });
    expect(h.step({ inputs: { value: 2 } }).outputs).toEqual({ option: 0, equals: true });
  });

  it("matches the unset options' zero value", () => {
    expect(createPatchHarness(optionEqualsPatch).step().outputs).toEqual({ option: 0, equals: true });
  });

  it("compares text exactly, colors at 8-bit precision, and JSON deeply", () => {
    const text = createPatchHarness(optionEqualsPatch, { typeParam: "text", inputs: { value: "Rain", option0: "rain", option1: "Rain ", option2: "Rain" } });
    expect(text.step().outputs.option).toBe(2);
    expect(text.step({ inputs: { value: "" } }).outputs.option).toBe(-1);
    expect(text.step({ inputs: { option1: "" } }).outputs.option).toBe(1);

    const color = createPatchHarness(optionEqualsPatch, { typeParam: "color", inputCount: 2, inputs: { value: { r: 1, g: 0.2, b: 0, a: 1 }, option0: "#000000FF", option1: "#FF3300FF" } });
    expect(color.step().outputs.option).toBe(1);

    const json = createPatchHarness(optionEqualsPatch, { typeParam: "json", inputCount: 2, inputs: { value: { a: [1, { b: 2 }] }, option0: null, option1: { a: [1, { b: 2 }] } } });
    expect(json.step().outputs.option).toBe(1);
    expect(json.step({ inputs: { value: null } }).outputs.option).toBe(0);
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(optionEqualsPatch, { typeParam: "index", inputCount: 2, inputs: { value: loopOf([0, 5, 6, 3]), option0: 5, option1: 6 } });
    const out = h.step().outputs;
    expect(out.option).toEqual(loopOf([-1, 0, 1, -1]));
    expect(out.equals).toEqual(loopOf([false, true, true, false]));
  });

  it("reports no match while muted", () => {
    const result = runPatch(optionEqualsPatch, [{ value: 0 }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ option: -1, equals: false });
  });
});
