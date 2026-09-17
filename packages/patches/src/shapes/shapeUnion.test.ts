import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { ellipsePath, parsePath, signedArea } from "./path.ts";
import { shapeUnion } from "./shapeUnion.ts";

describe("shapeUnion", () => {
  it("appends clockwise shapes in input order", () => {
    const h = createPatchHarness(shapeUnion, { inputs: { shape1: { path: "M0 0 L10 0 L10 10 Z" }, shape2: { path: "M20 0 L30 0 L30 10 Z" } } });
    expect(h.step().outputs.shape).toEqual({ path: "M0 0 L10 0 L10 10 Z M20 0 L30 0 L30 10 Z" });
  });

  it("reverses counter-clockwise inputs so overlaps add up", () => {
    const h = createPatchHarness(shapeUnion, { inputs: { shape1: { path: "M0 0 L10 0 L10 10 Z" }, shape2: { path: "M0 0 L0 10 L10 10 Z" } } });
    expect(h.step().outputs.shape).toEqual({ path: "M0 0 L10 0 L10 10 Z M0 0 L10 10 L0 10 L0 0 Z" });
  });

  it("flips arc sweeps when reversing", () => {
    const ccw = "M50 0 A50 50 0 0 0 0 50 A50 50 0 0 0 50 100 A50 50 0 0 0 100 50 A50 50 0 0 0 50 0 Z";
    const h = createPatchHarness(shapeUnion, { inputs: { shape1: { path: ccw }, shape2: null } });
    expect(h.step().outputs.shape).toEqual({ path: ellipsePath(50, 50, 50, 50) });
  });

  it("keeps holes inside an input opposite to their outline", () => {
    const ring = "M0 0 L0 100 L100 100 L100 0 Z M25 25 L75 25 L75 75 L25 75 Z";
    const h = createPatchHarness(shapeUnion, { inputs: { shape1: ring, shape2: null } });
    const { path } = h.step().outputs.shape as { path: string };
    expect(path).toBe("M0 0 L100 0 L100 100 L0 100 L0 0 Z M25 25 L25 75 L75 75 L75 25 L25 25 Z");
    const [outer, inner] = path.split(" M").map((p, i) => parsePath(i === 0 ? p : `M${p}`).segments);
    expect(signedArea(outer!)).toBeGreaterThan(0);
    expect(signedArea(inner!)).toBeLessThan(0);
  });

  it("skips unconnected, empty, and whitespace-only inputs", () => {
    const h = createPatchHarness(shapeUnion, { inputs: { shape1: { path: "   " }, shape2: null } });
    expect(h.step().outputs.shape).toEqual({ path: "" });
    const three = createPatchHarness(shapeUnion, { inputCount: 3, inputs: { shape3: { path: "M1 1 L2 1 L2 2 Z" } } });
    expect(three.step().outputs.shape).toEqual({ path: "M1 1 L2 1 L2 2 Z" });
  });

  it("uses the valid prefix of invalid path data and warns once naming the input", () => {
    const h = createPatchHarness(shapeUnion, { inputs: { shape1: { path: "M0 0 L10 0 L10 10 Z" }, shape2: { path: "M0 0 L10" } } });
    h.run(3);
    expect(h.output("shape")).toEqual({ path: "M0 0 L10 0 L10 10 Z M0 0" });
    expect(h.logs.map((l) => l.message)).toEqual(["Shape 2 has path data that stops at character 9."]);
  });

  it("reuses its output while inputs stay the same", () => {
    const h = createPatchHarness(shapeUnion, { inputs: { shape1: { path: "M0 0 L1 0 L1 1 Z" } } });
    const first = h.step().outputs.shape;
    expect(h.step().outputs.shape).toBe(first);
  });

  it("makes one union per loop index", () => {
    const h = createPatchHarness(shapeUnion, {
      inputs: { shape1: loopOf([{ path: "M0 0 L1 0 L1 1 Z" }, { path: "M5 5 L6 5 L6 6 Z" }]), shape2: { path: "M9 9 L10 9 L10 10 Z" } },
    });
    const frame = h.step();
    expect(frame.loopCount).toBe(2);
    expect(frame.outputs.shape).toEqual(loopOf([{ path: "M0 0 L1 0 L1 1 Z M9 9 L10 9 L10 10 Z" }, { path: "M5 5 L6 5 L6 6 Z M9 9 L10 9 L10 10 Z" }]));
  });
});
