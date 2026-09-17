// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, findLayer, resolveNodePorts, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { cablesTouching, endpointLabel, planPortChange } from "./portChange.ts";

const registry = getRegistry();

function build(ops: Op[], doc: SonobeDocument = createEmptyDocument()): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const fixture = () =>
  build([
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
    { op: "addLayer", layer: { id: "dot", type: "oval", name: "Dot" } },
    { op: "addPatch", patch: { id: "grow", type: "transition", name: "Grow", typeParam: "number", inputs: { start: 1, end: 1.2 }, ui: { x: 300, y: 0 } } },
    { op: "addPatch", patch: { id: "pop", type: "popAnimation", typeParam: "number", ui: { x: 0, y: 0 } } },
    { op: "connect", from: "pop.output", to: "grow.progress" },
    { op: "connect", from: "grow.output", to: "@card.scale" },
  ]);

const toColor: Op[] = [{ op: "updatePatch", component: "main", id: "grow", typeParam: "color" }];

describe("planPortChange", () => {
  it("finds cables a Type change disconnects, with a converter that fixes them in one batch", () => {
    const doc = fixture();
    const plan = planPortChange(doc, "main", registry, toColor);
    if (!plan.ok) throw new Error("plan failed");
    expect(plan.lost).toHaveLength(1);
    expect(plan.lost[0]).toMatchObject({ from: "grow.output", to: "@card.scale", removedPort: false, fromType: "color", toType: "number", toLabel: "Card · Scale" });
    expect(plan.lost[0]!.fromLabel).toMatch(/^Grow · /);
    expect(plan.lost[0]!.converter).toMatchObject({ patchType: expect.any(String), description: expect.any(String) });
    expect(plan.converterCount).toBe(1);
    expect(plan.resetValues).toBe(2);

    const fixed = applyOps(doc, [...toColor, ...plan.converterOps], { registry });
    expect(fixed.ok).toBe(true);
    const main = fixed.doc.components.main!;
    const scale = findLayer(main.layers, "card")!.layer.props.scale as { link: string };
    const converter = scale.link.split(".")[0]!;
    expect(converter).not.toBe("grow");
    expect(main.patches[converter]!.type).toBe(plan.lost[0]!.converter!.patchType);
    expect(Object.values(main.patches[converter]!.inputs)).toContainEqual({ link: "grow.output" });
    expect(main.patches.grow!.inputs.progress).toEqual({ link: "pop.output" });
    expect(main.patches[converter]!.ui.y).toBeGreaterThanOrEqual(0);
  });

  it("gives every converter its own ref", () => {
    const doc = build([{ op: "connect", from: "grow.output", to: "@dot.scale" }], fixture());
    const plan = planPortChange(doc, "main", registry, toColor);
    if (!plan.ok) throw new Error("plan failed");
    expect(plan.lost.map((l) => l.to)).toEqual(["@card.scale", "@dot.scale"]);
    const refs = plan.converterOps.flatMap((op) => (op.op === "addPatch" ? [op.patch.ref] : []));
    expect(refs).toEqual(["converter_1", "converter_2"]);
    const fixed = applyOps(doc, [...toColor, ...plan.converterOps], { registry });
    expect(fixed.ok).toBe(true);
    const layers = fixed.doc.components.main!.layers;
    const card = (findLayer(layers, "card")!.layer.props.scale as { link: string }).link;
    const dot = (findLayer(layers, "dot")!.layer.props.scale as { link: string }).link;
    expect(card.split(".")[0]).not.toBe(dot.split(".")[0]);
  });

  it("reports cables into inputs a smaller count removes, without converters", () => {
    let doc = build([{ op: "addPatch", patch: { id: "sum", type: "add", typeParam: "number", inputCount: 3, ui: { x: 0, y: 300 } } }], fixture());
    const last = resolveNodePorts(doc, doc.components.main!.patches.sum!, registry)!.inputs.at(-1)!;
    doc = build([{ op: "connect", from: "pop.output", to: `sum.${last.key}` }], doc);
    const plan = planPortChange(doc, "main", registry, [{ op: "updatePatch", component: "main", id: "sum", inputCount: 2 }]);
    if (!plan.ok) throw new Error("plan failed");
    expect(plan.lost).toEqual([expect.objectContaining({ from: "pop.output", to: `sum.${last.key}`, removedPort: true })]);
    expect(plan.lost[0]!.converter).toBeUndefined();
    expect(plan.converterOps).toEqual([]);
  });

  it("is empty when nothing disconnects, and explains ops that don't apply", () => {
    const doc = fixture();
    const grow = planPortChange(doc, "main", registry, [{ op: "updatePatch", component: "main", id: "pop", typeParam: "number" }]);
    expect(grow).toMatchObject({ ok: true, lost: [], converterOps: [] });
    const bad = planPortChange(doc, "main", registry, [{ op: "updatePatch", component: "main", id: "grow", typeParam: "gradient" }]);
    expect(bad.ok).toBe(false);
  });
});

describe("cablesTouching and endpointLabel", () => {
  it("lists cables into and out of patches, including published outputs", () => {
    const doc = build([
      { op: "addComponent", component: { id: "press", name: "Press", kind: "patchComponent" } },
      { op: "addPatch", component: "press", patch: { id: "shrink", type: "transition", typeParam: "number", ui: { x: 0, y: 0 } } },
      { op: "updateInterface", component: "press", outputs: { scale: { key: "scale", name: "Scale", type: "number", link: "shrink.output" } } },
    ]);
    expect(cablesTouching(doc.components.press!, new Set(["shrink"]))).toEqual([{ from: "shrink.output", to: "$out.scale" }]);
    expect(endpointLabel(doc, "press", registry, "$out.scale")).toBe("Scale (component output)");
    const main = fixture();
    expect(cablesTouching(main.components.main!, new Set(["grow"]))).toEqual([
      { from: "pop.output", to: "grow.progress" },
      { from: "grow.output", to: "@card.scale" },
    ]);
    expect(endpointLabel(main, "main", registry, "@card.scale")).toBe("Card · Scale");
    expect(endpointLabel(main, "main", registry, "pop.output")).toMatch(/^Pop Animation · /);
    expect(endpointLabel(main, "main", registry, "ghost.output")).toBe("ghost.output");
  });
});
