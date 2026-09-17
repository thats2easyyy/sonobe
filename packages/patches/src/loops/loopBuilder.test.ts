import { createEmptyDocument } from "@sonobe/core";
import type { PatchNode } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopBuilderPatch } from "./loopBuilder.ts";
import { variantInputPorts } from "./shared.ts";

describe("loopBuilder", () => {
  it("collects the items in order with matching indices", () => {
    const h = createPatchHarness(loopBuilderPatch, { typeParam: "text", inputCount: 3, inputs: { item0: "Ada", item1: "Grace", item2: "Katherine" } });
    const frame = h.step();
    expect(frame.outputs.loop).toEqual(loopOf(["Ada", "Grace", "Katherine"]));
    expect(frame.outputs.index).toEqual(loopOf([0, 1, 2]));
    expect(h.logs).toEqual([]);
  });

  it("defaults to three number items of 0", () => {
    const h = createPatchHarness(loopBuilderPatch);
    expect(h.step().outputs).toEqual({ loop: loopOf([0, 0, 0]), index: loopOf([0, 1, 2]) });
  });

  it("coerces items to the patch's type and uses the zero value for unset items", () => {
    const h = createPatchHarness(loopBuilderPatch, { typeParam: "color", inputCount: 2, inputs: { item0: "#FF0000FF" } });
    expect(h.step().outputs.loop).toEqual(loopOf([{ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 0, a: 0 }]));
  });

  it("keeps media items without an asset as null so later items don't shift", () => {
    const h = createPatchHarness(loopBuilderPatch, { typeParam: "image", inputCount: 3, inputs: { item1: { assetId: "photo" } } });
    expect(h.step().outputs.loop).toEqual(loopOf([null, { assetId: "photo" }, null]));
  });

  it("makes a one-item loop with one input", () => {
    const h = createPatchHarness(loopBuilderPatch, { inputCount: 1, inputs: { item0: 42 } });
    expect(h.step().outputs).toEqual({ loop: loopOf([42]), index: loopOf([0]) });
  });

  it("updates a changed item on the same frame", () => {
    const h = createPatchHarness(loopBuilderPatch, { inputs: { item0: 1, item1: 2, item2: 3 } });
    h.step();
    expect(h.step({ inputs: { item1: 20 } }).outputs.loop).toEqual(loopOf([1, 20, 3]));
  });

  it("reads item 0 of a looped item and warns once", () => {
    const h = createPatchHarness(loopBuilderPatch, { inputs: { item1: loopOf([4, 5]) } });
    expect(h.run(3).outputs.loop).toEqual(loopOf([0, 4, 0]));
    expect(h.logs.map((l) => l.message)).toEqual(["Loop Builder: each item takes one value, so only the first item of a looped input is used."]);
  });

  it("declares 0-based item ports with per-variant defaults", () => {
    const node: PatchNode = { type: "loopBuilder", typeParam: "text", inputCount: 2, inputs: {}, ui: { x: 0, y: 0 } };
    const ports = loopBuilderPatch.dynamicPorts!(node, createEmptyDocument({ name: "Doc" }));
    expect(ports.outputs).toEqual([]);
    expect(ports.inputs.map((p) => [p.key, p.name, p.type, p.default])).toEqual([
      ["item0", "Item 0", "text", ""],
      ["item1", "Item 1", "text", ""],
    ]);
    expect(variantInputPorts("loopBuilder", undefined, undefined).map((p) => [p.key, p.default])).toEqual([
      ["item0", 0],
      ["item1", 0],
      ["item2", 0],
    ]);
  });

  it("reads item0 … in the runtime", () => {
    const result = runPatch(loopBuilderPatch, [{ item0: "Tokyo", item1: "Lisbon" }, { item2: "Oaxaca" }], { typeParam: "text", inputCount: 3 });
    expect(result.frames[0]!.outputs.loop).toEqual(loopOf(["Tokyo", "Lisbon", ""]));
    expect(result.frames[1]!.outputs.loop).toEqual(loopOf(["Tokyo", "Lisbon", "Oaxaca"]));
    expect(result.frames[1]!.outputs.index).toEqual(loopOf([0, 1, 2]));
    expect(result.issues).toEqual([]);
  });
});
