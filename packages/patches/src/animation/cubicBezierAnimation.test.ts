import type { Color } from "@sonobe/core";
import type { Loop } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { cubicBezierAnimation } from "./cubicBezierAnimation.ts";
import { cubicBezierEase } from "./shared.ts";

describe("cubicBezierAnimation", () => {
  it("starts at rest on the first Number with Curve Point [1, 1]", () => {
    const frame = createPatchHarness(cubicBezierAnimation, { inputs: { number: 6 } }).step();
    expect(frame.outputs.output).toBe(6);
    expect(frame.outputs.curvePoint).toEqual([1, 1]);
    expect(frame.requestedNextFrame).toBe(false);
  });

  it("matches the catalog golden values at 60 and 120 fps", () => {
    const h120 = createPatchHarness(cubicBezierAnimation, { fps: 120, inputs: { number: 0 } });
    h120.step();
    expect(h120.run(15, { inputs: { number: 1 } }).outputs.output as number).toBeCloseTo(0.129162, 5);
    expect(h120.run(15).outputs.output as number).toBeCloseTo(0.5, 9);
    const done = h120.run(30);
    expect(done.outputs.output).toBe(1);
    expect(done.outputs.curvePoint).toEqual([1, 1]);
    expect(done.requestedNextFrame).toBe(false);

    const h60 = createPatchHarness(cubicBezierAnimation, { inputs: { number: 0 } });
    h60.step();
    const mid = h60.run(15, { inputs: { number: 1 } });
    expect(mid.outputs.output as number).toBeCloseTo(0.5, 9);
    expect(mid.requestedNextFrame).toBe(true);
    expect(h60.run(15).outputs.output).toBe(1);
  });

  it("starts a new animation from the current value when Number changes", () => {
    const h = createPatchHarness(cubicBezierAnimation, { inputs: { number: 0, duration: 1 } });
    h.step();
    h.run(30, { inputs: { number: 10 } });
    const current = h.output("output") as number;
    const frame = h.step({ inputs: { number: 0 } });
    const x = 1 / 60;
    const y = cubicBezierEase(0.42, 0, 0.58, 1, x);
    expect(frame.outputs.output as number).toBeCloseTo(current + (0 - current) * y, 9);
    expect((frame.outputs.curvePoint as number[])[0]).toBeCloseTo(x, 12);
  });

  it("finishes when Duration shrinks below the elapsed time", () => {
    const h = createPatchHarness(cubicBezierAnimation, { inputs: { number: 0, duration: 2 } });
    h.step();
    h.run(30, { inputs: { number: 4 } });
    expect(h.step({ inputs: { duration: 0.25 } }).outputs.output).toBe(4);
  });

  it.each([0, -1, Number.NaN])("jumps to Number when Duration is %d", (duration) => {
    const h = createPatchHarness(cubicBezierAnimation, { inputs: { number: 0, duration } });
    h.step();
    const frame = h.step({ inputs: { number: 3 } });
    expect(frame.outputs.output).toBe(3);
    expect(frame.outputs.curvePoint).toEqual([1, 1]);
  });

  it("clamps overshooting color channels in the output only", () => {
    const h = createPatchHarness(cubicBezierAnimation, {
      typeParam: "color",
      inputs: { number: { r: 0, g: 0, b: 0, a: 1 }, control1X: 0.34, control1Y: 1.56, control2X: 0.64, control2Y: 1 },
    });
    h.step();
    const color = h.run(15, { inputs: { number: { r: 1, g: 1, b: 1, a: 1 } } }).outputs.output as Color;
    expect(color.r).toBe(1);
    expect(h.state()!.value[0]).toBeGreaterThan(1);
  });

  it("keeps state per loop index", () => {
    const h = createPatchHarness(cubicBezierAnimation, { inputs: { number: loopOf([0, 5]), duration: 1 } });
    h.step();
    const items = (h.run(30, { inputs: { number: loopOf([1, 5, 9]) } }).outputs.output as Loop<number>).items;
    expect(items[0]).toBeCloseTo(0.5, 9);
    expect(items[1]).toBe(5);
    expect(items[2]).toBe(9);
  });

  it("passes Number through while muted", () => {
    const result = runPatch(cubicBezierAnimation, [{ number: 2 }, { number: 7 }], { muted: true });
    expect(result.frames.map((f) => f.outputs.output)).toEqual([2, 7]);
    expect(result.frames[1]!.outputs.curvePoint).toEqual([0, 0]);
  });
});
