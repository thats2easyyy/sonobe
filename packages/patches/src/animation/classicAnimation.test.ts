import type { Color } from "@sonobe/core";
import type { Loop } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, ease, loopOf } from "../infra/index.ts";
import { classicAnimation } from "./classicAnimation.ts";

describe("classicAnimation", () => {
  it("starts at rest on the first Number", () => {
    const h = createPatchHarness(classicAnimation, { inputs: { number: 3 } });
    const frame = h.step();
    expect(frame.outputs.output).toBe(3);
    expect(frame.requestedNextFrame).toBe(false);
  });

  it("eases toward a new Number over Duration and lands exactly on it", () => {
    const h = createPatchHarness(classicAnimation, { inputs: { number: 0, duration: 0.4, curve: "quadraticInOut" } });
    h.step();
    for (let i = 1; i <= 20; i++) {
      const frame = h.step({ inputs: { number: 10 } });
      expect(frame.outputs.output as number).toBeCloseTo(10 * ease("quadraticInOut", i / 60 / 0.4), 9);
      expect(frame.requestedNextFrame).toBe(true);
    }
    const done = h.run(10);
    expect(done.outputs.output).toBe(10);
    expect(done.requestedNextFrame).toBe(false);
  });

  it("restarts from the current value over the full Duration when Number changes", () => {
    const h = createPatchHarness(classicAnimation, { inputs: { number: 0, duration: 1, curve: "linear" } });
    h.step();
    h.run(30, { inputs: { number: 100 } });
    const halfway = h.output("output") as number;
    expect(halfway).toBeCloseTo(50, 9);
    const frame = h.step({ inputs: { number: 0 } });
    expect(frame.outputs.output as number).toBeCloseTo(halfway * (1 - 1 / 60), 9);
    expect(h.run(59).outputs.output as number).toBeCloseTo(halfway * (1 - 60 / 60), 6);
  });

  it("ignores a Number equal to the destination in flight", () => {
    const h = createPatchHarness(classicAnimation, { inputs: { number: 0, duration: 1, curve: "linear" } });
    h.step();
    h.run(15, { inputs: { number: 100 } });
    expect(h.run(15, { inputs: { number: 100 } }).outputs.output as number).toBeCloseTo(50, 9);
  });

  it("rescales progress when Duration changes mid-flight and finishes when it's already past", () => {
    const h = createPatchHarness(classicAnimation, { inputs: { number: 0, duration: 1, curve: "linear" } });
    h.step();
    h.run(15, { inputs: { number: 100 } });
    expect(h.output("output") as number).toBeCloseTo(25, 9);
    expect(h.step({ inputs: { duration: 0.25 } }).outputs.output).toBe(100);
  });

  it.each([0, -2, Number.NaN])("jumps straight to the target when Duration is %d", (duration) => {
    const h = createPatchHarness(classicAnimation, { inputs: { number: 0, duration } });
    h.step();
    const frame = h.step({ inputs: { number: 8 } });
    expect(frame.outputs.output).toBe(8);
    expect(frame.requestedNextFrame).toBe(false);
  });

  it("resolves the catalog curve keys and falls back to Linear for unknown curves", () => {
    const run = (curve: string) => {
      const h = createPatchHarness(classicAnimation, { inputs: { number: 0, duration: 1, curve } });
      h.step();
      return h.run(30, { inputs: { number: 1 } }).outputs.output as number;
    };
    expect(run("sinusoidalIn")).toBeCloseTo(1 - Math.cos(Math.PI / 4), 9);
    expect(run("exponentialOut")).toBeCloseTo(1 - 2 ** -5, 9);
    expect(run("wobbly")).toBeCloseTo(0.5, 9);
  });

  it("tweens colors channel by channel", () => {
    const h = createPatchHarness(classicAnimation, { typeParam: "color", inputs: { number: { r: 0, g: 0, b: 0, a: 1 }, duration: 1, curve: "linear" } });
    h.step();
    const color = h.run(30, { inputs: { number: { r: 1, g: 0.5, b: 0, a: 0 } } }).outputs.output as Color;
    expect(color.r).toBeCloseTo(0.5, 9);
    expect(color.g).toBeCloseTo(0.25, 9);
    expect(color.b).toBe(0);
    expect(color.a).toBeCloseTo(0.5, 9);
  });

  it("keeps a tween per loop index", () => {
    const h = createPatchHarness(classicAnimation, { inputs: { number: loopOf([0, 0]), duration: 1, curve: "linear" } });
    h.step();
    h.run(30, { inputs: { number: loopOf([10, 0]) } });
    const items = (h.output("output") as Loop<number>).items;
    expect(items[0]).toBeCloseTo(5, 9);
    expect(items[1]).toBe(0);
  });

  it("keeps its previous target for a non-finite Number and warns once", () => {
    const h = createPatchHarness(classicAnimation, { inputs: { number: 4 } });
    h.step();
    expect(h.run(4, { inputs: { number: Number.NaN } }).outputs.output).toBe(4);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
