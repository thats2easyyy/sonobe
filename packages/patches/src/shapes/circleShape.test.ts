import { describe, expect, it } from "vitest";
import { runPatch } from "@sonobe/engine/testing";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { circleShape } from "./circleShape.ts";

const DEFAULT_CIRCLE = "M50 0 A50 50 0 0 1 100 50 A50 50 0 0 1 50 100 A50 50 0 0 1 0 50 A50 50 0 0 1 50 0 Z";

describe("circleShape", () => {
  it("draws the default circle clockwise from 12 o'clock with exact arcs", () => {
    const h = createPatchHarness(circleShape);
    expect(h.step().outputs.shape).toEqual({ path: DEFAULT_CIRCLE });
  });

  it("measures Position from the anchor point of the circle's box", () => {
    const h = createPatchHarness(circleShape, { inputs: { position: [0, 0], radius: 10, anchor: [0, 0] } });
    expect(h.step().outputs.shape).toEqual({ path: "M10 0 A10 10 0 0 1 20 10 A10 10 0 0 1 10 20 A10 10 0 0 1 0 10 A10 10 0 0 1 10 0 Z" });
    h.set({ anchor: [1, 1] });
    expect(h.step().outputs.shape).toEqual({ path: "M-10 -20 A10 10 0 0 1 0 -10 A10 10 0 0 1 -10 0 A10 10 0 0 1 -20 -10 A10 10 0 0 1 -10 -20 Z" });
  });

  it("outputs the empty shape silently for a radius at or below 0", () => {
    const h = createPatchHarness(circleShape, { inputs: { radius: 0 } });
    expect(h.step().outputs.shape).toEqual({ path: "" });
    h.set({ radius: -12 });
    expect(h.step().outputs.shape).toEqual({ path: "" });
    expect(h.logs).toEqual([]);
  });

  it("rounds to 3 decimals and clamps coordinates to ±1,000,000", () => {
    const h = createPatchHarness(circleShape, { inputs: { position: [10.0004, 20], radius: 1.23456 } });
    expect(h.step().outputs.shape).toEqual({ path: "M10 18.765 A1.235 1.235 0 0 1 11.235 20 A1.235 1.235 0 0 1 10 21.235 A1.235 1.235 0 0 1 8.766 20 A1.235 1.235 0 0 1 10 18.765 Z" });
    h.set({ position: [0, 0], radius: 5e6 });
    const path = (h.step().outputs.shape as { path: string }).path;
    expect(path).toBe("M0 -1000000 A1000000 1000000 0 0 1 1000000 0 A1000000 1000000 0 0 1 0 1000000 A1000000 1000000 0 0 1 -1000000 0 A1000000 1000000 0 0 1 0 -1000000 Z");
    expect(path).not.toMatch(/e/);
  });

  it("reads non-finite inputs as 0 and warns once per restart", () => {
    const h = createPatchHarness(circleShape, { inputs: { radius: Number.NaN } });
    h.run(3);
    expect(h.output("shape")).toEqual({ path: "" });
    expect(h.logs.map((l) => [l.level, l.message])).toEqual([["warn", "Circle Shape: Radius isn't a finite number; using 0."]]);
    h.set({ radius: 10, position: [Number.POSITIVE_INFINITY, 10] });
    h.step();
    expect(h.output("shape")).toEqual({ path: "M0 0 A10 10 0 0 1 10 10 A10 10 0 0 1 0 20 A10 10 0 0 1 -10 10 A10 10 0 0 1 0 0 Z" });
    expect(h.logs).toHaveLength(2);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(3);
  });

  it("gives byte-identical text for the same inputs", () => {
    const a = createPatchHarness(circleShape, { inputs: { radius: 33.3333 } });
    const b = createPatchHarness(circleShape, { inputs: { radius: 33.3333 } });
    expect(a.step().outputs.shape).toEqual(b.step().outputs.shape);
    expect(a.step().outputs.shape).toEqual(b.step().outputs.shape);
  });

  it("evaluates once per loop index and outputs an empty loop for an empty loop", () => {
    const h = createPatchHarness(circleShape, { inputs: { radius: loopOf([10, 0]), position: [10, 10] } });
    const frame = h.step();
    expect(frame.loopCount).toBe(2);
    expect(frame.outputs.shape).toEqual(loopOf([{ path: "M10 0 A10 10 0 0 1 20 10 A10 10 0 0 1 10 20 A10 10 0 0 1 0 10 A10 10 0 0 1 10 0 Z" }, { path: "" }]));
    const empty = runPatch(circleShape, [{ radius: loopOf([]) }]);
    expect(empty.frames[0]!.outputs.shape).toEqual(loopOf([]));
  });
});
