import { buildDoc, createMockRegistry, createTestRuntime, sequenceDefinition } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { definitions } from "./index.ts";
import { sizeUnpack } from "./sizeUnpack.ts";

describe("sizeUnpack", () => {
  it("splits a size into Width and Height, starting at 100 and 100", () => {
    const h = createPatchHarness(sizeUnpack);
    expect(h.step().outputs).toEqual({ width: 100, height: 100 });
    expect(h.step({ inputs: { value: [240, 88] } }).outputs).toEqual({ width: 240, height: 88 });
  });

  it("passes negative sizes through and reads a number as [n, n]", () => {
    const h = createPatchHarness(sizeUnpack, { inputs: { value: [-4, 12] } });
    expect(h.step().outputs).toEqual({ width: -4, height: 12 });
    expect(h.step({ inputs: { value: 30 } }).outputs).toEqual({ width: 30, height: 30 });
  });

  it("turns a loop of sizes into loops of numbers", () => {
    const h = createPatchHarness(sizeUnpack, { inputs: { value: loopOf([[10, 20], [30, 40]]) } });
    expect(h.step().outputs).toEqual({ width: loopOf([10, 30]), height: loopOf([20, 40]) });
  });

  it("outputs 0 and warns once when an upstream size has a non-finite component", () => {
    const source = sequenceDefinition("brokenSize", "size", [[Number.NaN, 56]]);
    const registry = createMockRegistry([source, ...definitions]);
    const logs: unknown[][] = [];
    const rt = createTestRuntime(
      buildDoc({ patches: { src: { type: "brokenSize" }, dims: { type: "sizeUnpack", inputs: { value: { link: "src.value" } } } } }, registry),
      registry,
      { onLog: (level, args) => logs.push([level, ...args]) },
    );
    rt.step();
    rt.step();
    expect(rt.getValue("dims.width")).toBe(0);
    expect(rt.getValue("dims.height")).toBe(56);
    expect(logs).toEqual([["warn", "dims got a value that isn't a finite number and used 0"]]);
  });
});
