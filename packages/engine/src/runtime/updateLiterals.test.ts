import { applyOps, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port, sequenceDefinition } from "../testing/index.ts";
import { compileDocument, updateLiterals } from "./compile.ts";

const target = sequenceDefinition("target", "number", [0, 1]);
/** Outputs what the document stores for its `amount` input (reads ctx.node). */
const nodeReader = defineMock({
  type: "nodeReader",
  name: "Node Reader",
  inputs: [port("amount", "number")],
  outputs: [port("stored", "number")],
  evaluate(ctx) {
    const stored = ctx.node.inputs.amount;
    ctx.output("stored", typeof stored === "number" ? stored : -1);
  },
});
const registry = createMockRegistry([target, nodeReader]);

function baseDoc(): SonobeDocument {
  return buildDoc(
    {
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: [16, 120], size: [100, 100], opacity: 1, scale: { link: "grow.output" } } }],
      patches: {
        t: { type: "target" },
        pop: { type: "popAnimation", inputs: { number: { link: "t.value" }, bounciness: 5 } },
        grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.5 } },
        reads: { type: "add", inputs: { value1: { link: "@card.opacity" }, value2: 1 } },
        node: { type: "nodeReader", inputs: { amount: 3 } },
      },
    },
    registry,
  );
}

const apply = (doc: SonobeDocument, ops: Op[]) => {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
};

describe("updateLiterals", () => {
  it("rewrites constant bindings in place for literal edits and position moves", () => {
    const base = baseDoc();
    const graph = compileDocument(base, registry);
    const edited = apply(base, [
      { op: "setInput", target: "pop.bounciness", value: 12 },
      { op: "setInput", target: "@card.opacity", value: 0.25 },
      { op: "setInput", target: "grow.end", value: null },
      { op: "updatePatch", id: "t", ui: { x: 500, y: 20 } },
    ]);
    const opacity = graph.resolveLink("@card.opacity")!.binding;
    expect(updateLiterals(graph, edited)).toBe(true);
    expect(graph.doc).toBe(edited);
    expect(graph.root!.component).toBe(edited.components.main);
    const pop = graph.root!.nodes.get("pop")!;
    expect(pop.bindings[pop.inputIndex.get("bounciness")!]).toMatchObject({ kind: "const", value: 12 });
    expect(pop.node).toBe(edited.components.main!.patches.pop);
    const grow = graph.root!.nodes.get("grow")!;
    const end = grow.inputIndex.get("end")!;
    expect(grow.bindings[end]).toMatchObject({ kind: "const", value: grow.inputs[end]!.default });
    // Readers of a layer property share its binding, so they see the new value too.
    expect(graph.resolveLink("@card.opacity")!.binding).toBe(opacity);
    expect(opacity).toMatchObject({ kind: "const", value: 0.25 });
    const reads = graph.root!.nodes.get("reads")!;
    expect(reads.bindings[reads.inputIndex.get("value1")!]).toBe(opacity);
  });

  it("refuses structural edits and leaves the graph as it was", () => {
    const base = baseDoc();
    const structural: Op[][] = [
      [{ op: "disconnect", to: "reads.value1" }],
      [{ op: "setInput", target: "grow.start", value: { link: "t.value" } }],
      [{ op: "addPatch", patch: { id: "extra", type: "add", ui: { x: 0, y: 0 } } }],
      [{ op: "updatePatch", id: "pop", name: "Spring" }],
      [{ op: "updatePatch", id: "grow", typeParam: "point" }],
      [{ op: "setInput", target: "@card.rotation", value: 45 }],
      [{ op: "setInput", target: "@card.position", value: null }],
      [{ op: "addLayer", layer: { id: "chip", type: "rectangle", name: "Chip", props: {} } }],
    ];
    for (const ops of structural) {
      const graph = compileDocument(base, registry);
      const pop = graph.root!.nodes.get("pop")!;
      expect(updateLiterals(graph, apply(base, ops))).toBe(false);
      expect(graph.doc).toBe(base);
      expect(graph.root!.component).toBe(base.components.main);
      expect(pop.node).toBe(base.components.main!.patches.pop);
    }
  });

  it("recompiles position moves when patches form a cycle", () => {
    const cyclic = apply(
      buildDoc(
        {
          patches: {
            a: { type: "add", inputs: { value1: { link: "b.output" }, value2: 1 } },
            b: { type: "add", inputs: { value1: { link: "a.output" } } },
          },
        },
        registry,
      ),
      [
        { op: "updatePatch", id: "a", ui: { x: 0, y: 0 } },
        { op: "updatePatch", id: "b", ui: { x: 200, y: 0 } },
      ],
    );
    const graph = compileDocument(cyclic, registry);
    expect(graph.cyclic).toBe(true);
    expect(updateLiterals(graph, apply(cyclic, [{ op: "updatePatch", id: "b", ui: { x: -200, y: 0 } }]))).toBe(false);
    expect(updateLiterals(graph, apply(cyclic, [{ op: "setInput", target: "a.value2", value: 3 }]))).toBe(true);
  });

  it("runs like a recompiled runtime, keeps patch state, and replays in traces", () => {
    const base = baseDoc();
    const inPlace = createTestRuntime(base, registry);
    const recompiled = createTestRuntime(base, registry);
    for (let i = 0; i < 10; i++) {
      inPlace.step();
      recompiled.step();
    }
    const edited = apply(base, [
      { op: "setInput", target: "pop.bounciness", value: 14 },
      { op: "setInput", target: "@card.opacity", value: 0.5 },
      { op: "setInput", target: "node.amount", value: 7 },
    ]);
    inPlace.updateDocument(edited);
    // New objects everywhere, so this one compiles.
    recompiled.updateDocument(structuredClone(edited));
    const targets = ["pop.output", "@card.scale", "reads.output", "@card.opacity", "node.stored"];
    for (let i = 0; i < 40; i++) {
      const a = inPlace.step();
      const b = recompiled.step();
      expect(targets.map((t) => inPlace.getValue(t))).toEqual(targets.map((t) => recompiled.getValue(t)));
      expect({ ...a.roots[0]!.props }).toEqual({ ...b.roots[0]!.props });
    }
    expect(inPlace.getValue("node.stored")).toBe(7);
    expect(inPlace.getValue("reads.output")).toBe(1.5);
    expect(inPlace.trace(targets, 200)).toEqual(recompiled.trace(targets, 200));
  });
});
