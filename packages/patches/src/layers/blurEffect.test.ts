import { describe, expect, it } from "vitest";
import { runPatch } from "@sonobe/engine/testing";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { blurEffect } from "./blurEffect.ts";

describe("blurEffect", () => {
  it("outputs a blur effect for the defaults", () => {
    const h = createPatchHarness(blurEffect);
    expect(h.step().outputs.effect).toEqual({ kind: "blur", params: { radius: 10, hardEdges: false } });
  });

  it("passes Hard Edges and outputs an effect even at radius 0", () => {
    const h = createPatchHarness(blurEffect, { inputs: { radius: 0, hardEdges: true } });
    expect(h.step().outputs.effect).toEqual({ kind: "blur", params: { radius: 0, hardEdges: true } });
  });

  it("clamps negative radii to 0 without an upper clamp", () => {
    const h = createPatchHarness(blurEffect, { inputs: { radius: -4 } });
    expect(h.step().outputs.effect).toEqual({ kind: "blur", params: { radius: 0, hardEdges: false } });
    h.set({ radius: 500 });
    expect(h.step().outputs.effect).toEqual({ kind: "blur", params: { radius: 500, hardEdges: false } });
    expect(h.logs).toEqual([]);
  });

  it("uses 0 for a non-finite radius and warns once per restart", () => {
    const h = createPatchHarness(blurEffect, { inputs: { radius: Number.NaN } });
    h.run(3);
    expect(h.output("effect")).toEqual({ kind: "blur", params: { radius: 0, hardEdges: false } });
    expect(h.logs.map((l) => l.message)).toEqual(["Blur Effect: Radius isn't a finite number; using 0."]);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(2);
  });

  it("gives a loop of effects for a loop of radii", () => {
    const h = createPatchHarness(blurEffect, { inputs: { radius: loopOf([2, 20]) } });
    expect(h.step().outputs.effect).toEqual(loopOf([{ kind: "blur", params: { radius: 2, hardEdges: false } }, { kind: "blur", params: { radius: 20, hardEdges: false } }]));
  });

  it("outputs null while muted", () => {
    expect(runPatch(blurEffect, [{ radius: 5 }], { muted: true }).frames[0]!.outputs.effect).toBeNull();
  });
});
