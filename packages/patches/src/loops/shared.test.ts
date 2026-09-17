import { createEmptyDocument, resolveNodePorts } from "@sonobe/core";
import type { PatchNode } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { loopOf } from "../infra/index.ts";
import { createPatchRegistry } from "../registry.ts";
import { definitions } from "./index.ts";
import { cachedReplay, indices, sameItems, snapshot } from "./shared.ts";

describe("loops shared helpers", () => {
  it("makes index loops", () => {
    expect(indices(0)).toEqual([]);
    expect(indices(4)).toEqual([0, 1, 2, 3]);
  });

  it("snapshots arrays and plain objects deeply", () => {
    const value = { a: [1, { b: 2 }], c: "x" };
    const copy = snapshot(value);
    expect(copy).toEqual(value);
    expect(copy.a).not.toBe(value.a);
    expect(copy.a[1]).not.toBe(value.a[1]);
    expect(snapshot(5)).toBe(5);
  });

  it("reuses a replay result only for a structurally equal source", () => {
    let replays = 0;
    const replay = (s: readonly unknown[]) => {
      replays++;
      return [...s, "x"];
    };
    const first = cachedReplay(null, [[1, 2], "a"], replay);
    expect(cachedReplay(first, [[1, 2], "a"], replay)).toBe(first);
    expect(cachedReplay(first, [[1, 3], "a"], replay).items).toEqual([[1, 3], "a", "x"]);
    expect(replays).toBe(2);
    expect(sameItems([Number.NaN], [Number.NaN])).toBe(true);
    expect(sameItems([1], [1, 2])).toBe(false);
  });

  it("gets variant inputs with catalog defaults for every variant from core port resolution", () => {
    const registry = createPatchRegistry();
    const doc = createEmptyDocument();
    const byKey = (type: string, typeParam?: string) => {
      const node: PatchNode = { type, inputs: {}, ui: { x: 0, y: 0 } };
      if (typeParam !== undefined) node.typeParam = typeParam;
      const ports = resolveNodePorts(doc, node, registry)!;
      return Object.fromEntries(ports.inputs.filter((p) => p.key === "loop" || p.key === "value").map((p) => [p.key, [p.type, p.default]]));
    };
    expect(byKey("loopInsert")).toEqual({ loop: ["number", { loop: [] }], value: ["number", 0] });
    expect(byKey("loopInsert", "text")).toEqual({ loop: ["text", { loop: [] }], value: ["text", ""] });
    expect(byKey("loopAppend", "color")).toEqual({ loop: ["color", { loop: [] }], value: ["color", "#00000000"] });
    expect(byKey("loopAppend", "image")).toEqual({ loop: ["image", { loop: [] }], value: ["image", null] });
    expect(byKey("loopSum", "point")).toEqual({ loop: ["point", { loop: [] }] });
    for (const def of definitions) expect(def.dynamicPorts, def.type).toBeUndefined();
  });

  it("starts unconnected variant loop inputs as empty loops in the runtime, for every type", () => {
    const withVariantLoop = definitions.filter((d) => d.inputs.some((p) => p.key === "loop" && p.type === "variant"));
    expect(withVariantLoop.map((d) => d.type)).toEqual([
      "loopSelect",
      "loopFilter",
      "loopSum",
      "loopReverse",
      "loopShuffle",
      "loopDedupe",
      "loopInsert",
      "loopAppend",
      "loopRemove",
      "loopRemoveLast",
    ]);
    for (const def of withVariantLoop) {
      for (const typeParam of def.variants ?? []) {
        const result = runPatch(def, [{}], { typeParam });
        const outputs = result.frames[0]!.outputs;
        const label = `${def.type}<${typeParam}>`;
        expect(result.issues, label).toEqual([]);
        if (def.type === "loopSum") expect(outputs.sum, label).toEqual(typeParam === "text" ? "" : typeParam === "number" ? 0 : new Array(typeParam === "point3d" ? 3 : typeParam === "point4d" ? 4 : 2).fill(0));
        else expect(outputs.output, label).toEqual(loopOf([]));
      }
    }
  });

  it("appends the zero value of the type for an unconnected Value", () => {
    const text = runPatch(definitions.find((d) => d.type === "loopAppend")!, [{ append: true }], { typeParam: "text" });
    expect(text.frames[0]!.outputs.output).toEqual(loopOf([""]));
    const color = runPatch(definitions.find((d) => d.type === "loopInsert")!, [{ insert: true }], { typeParam: "color" });
    expect(color.frames[0]!.outputs.output).toEqual(loopOf([{ r: 0, g: 0, b: 0, a: 0 }]));
  });
});
