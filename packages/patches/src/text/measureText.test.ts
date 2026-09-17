import { approximateTextMeasurer } from "@sonobe/engine";
import type { RuntimeServices } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { measureTextPatch } from "./measureText.ts";

const style = { fontFamily: "Inter", fontSize: 17, fontWeight: 400, letterSpacing: 0, lineHeight: 0 };

describe("measureText", () => {
  it("measures a new Text layer's text with the defaults", () => {
    const expected = approximateTextMeasurer.measure("Text", style, null);
    expect(createPatchHarness(measureTextPatch).step().outputs.size).toEqual([expected.width, expected.height]);
  });

  it("uses the style ports and wraps at Max Width", () => {
    const text = "Limited offer for everyone who signs up today";
    const bold = { ...style, fontSize: 13, fontWeight: 600, letterSpacing: 0.5 };
    const h = createPatchHarness(measureTextPatch, { inputs: { text, fontSize: 13, fontWeight: 600, letterSpacing: 0.5 } });
    const oneLine = approximateTextMeasurer.measure(text, bold, null);
    expect(h.step().outputs.size).toEqual([oneLine.width, oneLine.height]);
    const wrapped = approximateTextMeasurer.measure(text, bold, 120);
    expect(h.step({ inputs: { maxWidth: 120 } }).outputs.size).toEqual([wrapped.width, wrapped.height]);
    expect(wrapped.height).toBeGreaterThan(oneLine.height);
    expect(h.step({ inputs: { maxWidth: -5 } }).outputs.size).toEqual([oneLine.width, oneLine.height]);
  });

  it("gives empty text zero width and one line of height", () => {
    const size = createPatchHarness(measureTextPatch, { inputs: { text: "" } }).step().outputs.size as number[];
    expect(size[0]).toBe(0);
    expect(size[1]).toBeCloseTo(17 * 1.2, 6);
    const tall = createPatchHarness(measureTextPatch, { inputs: { text: "", lineHeight: 30 } }).step().outputs.size;
    expect(tall).toEqual([0, 30]);
  });

  it("adds Paragraph Spacing between paragraphs only", () => {
    const text = "One\nTwo\r\nThree";
    const base = approximateTextMeasurer.measure(text, style, null);
    const size = createPatchHarness(measureTextPatch, { inputs: { text, paragraphSpacing: 8 } }).step().outputs.size as number[];
    expect(size[1]).toBeCloseTo(base.height + 16, 6);
    const negative = createPatchHarness(measureTextPatch, { inputs: { text, paragraphSpacing: -8 } }).step().outputs.size as number[];
    expect(negative[1]).toBeCloseTo(base.height, 6);
  });

  it("never goes below 0 with negative letter spacing", () => {
    const size = createPatchHarness(measureTextPatch, { inputs: { text: "ab", letterSpacing: -40 } }).step().outputs.size as number[];
    expect(size[0]).toBe(0);
  });

  it("prefers a host-provided measureText service", () => {
    const services = { measureText: (text: string) => ({ width: text.length * 10, height: 24 }) } as unknown as Partial<RuntimeServices>;
    const h = createPatchHarness(measureTextPatch, { inputs: { text: "abcd", paragraphSpacing: 5 }, services });
    expect(h.step().outputs.size).toEqual([40, 24]);
  });

  it("counts a non-finite measurement as 0 and warns once per loop index per restart", () => {
    const services = { measureText: () => ({ width: Number.NaN, height: Number.POSITIVE_INFINITY }) } as unknown as Partial<RuntimeServices>;
    const h = createPatchHarness(measureTextPatch, { services });
    expect(h.step().outputs.size).toEqual([0, 0]);
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("gives a loop of sizes for a loop of labels", () => {
    const frame = createPatchHarness(measureTextPatch, { inputs: { text: loopOf(["a", "abc"]) } }).step();
    const [a, abc] = (frame.outputs.size as { items: number[][] }).items;
    expect(abc![0]).toBeGreaterThan(a![0]!);
  });

  it("outputs [0, 0] while muted", () => {
    expect(runPatch(measureTextPatch, [{ text: "Hello" }], { muted: true }).frames[0]!.outputs.size).toEqual([0, 0]);
  });
});
