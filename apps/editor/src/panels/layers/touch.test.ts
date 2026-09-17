import { applyOps, createEmptyDocument, findLayer, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { planTouch, TOUCH_OPTIONS, touchOptions, touchPlacement } from "./touch.ts";

const registry = getRegistry();

function apply(doc: SonobeDocument, ops: Op[]) {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result;
}

const card = () => apply(createEmptyDocument(), [{ op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card", props: { position: [16, 146], size: [370, 440] } } }]).doc;

describe("touch interactions", () => {
  it("offers every option with real patch types", () => {
    expect(touchOptions(registry).map((o) => o.kind)).toEqual(TOUCH_OPTIONS.map((o) => o.kind));
    for (const option of TOUCH_OPTIONS) expect(registry.patches.get(option.patchType)?.inputs.some((p) => p.key === "layer")).toBe(true);
  });

  it("adds a Tap interaction watching the layer", () => {
    const doc = card();
    const plan = planTouch(doc, "main", "card", "tap", registry)!;
    const result = apply(doc, plan.ops);
    const patch = result.doc.components.main!.patches[result.idMap[plan.ref]!]!;
    expect(patch.type).toBe("interaction");
    expect(patch.name).toBe("Tap Card");
    expect(patch.inputs.layer).toEqual({ layer: "card" });
    expect(plan.label).toBe("Add Tap to Card");
  });

  it("uses Long Press, Double Tap, and Hover patches", () => {
    const doc = card();
    for (const [kind, type] of [["longPress", "longPress"], ["doubleTap", "doubleTap"], ["hover", "hover"], ["press", "interaction"]] as const) {
      const plan = planTouch(doc, "main", "card", kind, registry)!;
      const result = apply(doc, plan.ops);
      expect(result.doc.components.main!.patches[result.idMap[plan.ref]!]!.type).toBe(type);
    }
  });

  it("wires Drag into the layer's position, starting where the layer is", () => {
    const doc = card();
    const plan = planTouch(doc, "main", "card", "drag", registry)!;
    const result = apply(doc, plan.ops);
    const id = result.idMap[plan.ref]!;
    const main = result.doc.components.main!;
    expect(main.patches[id]!.inputs.startPosition).toEqual([16, 146]);
    expect(findLayer(main.layers, "card")!.layer.props.position).toEqual({ link: `${id}.position` });
    expect(plan.positionLinked).toBe(false);
  });

  it("configures Scroll X and Scroll Y axes", () => {
    const doc = card();
    const x = planTouch(doc, "main", "card", "scrollX", registry)!;
    const y = planTouch(doc, "main", "card", "scrollY", registry)!;
    const rx = apply(doc, x.ops);
    const ry = apply(doc, y.ops);
    expect(rx.doc.components.main!.patches[rx.idMap.touch!]!.inputs).toMatchObject({ scrollX: "free", scrollY: "off" });
    expect(ry.doc.components.main!.patches[ry.idMap.touch!]!.inputs).toMatchObject({ scrollX: "off", scrollY: "free" });
  });

  it("leaves an existing position link alone", () => {
    const doc = apply(card(), [
      { op: "addPatch", patch: { id: "mover", type: "transition", typeParam: "point", ui: { x: 40, y: 60 } } },
      { op: "connect", from: "mover.output", to: "@card.position" },
    ]).doc;
    const plan = planTouch(doc, "main", "card", "drag", registry)!;
    expect(plan.positionLinked).toBe(true);
    expect(plan.ops).toHaveLength(1);
    const result = apply(doc, plan.ops);
    expect(findLayer(result.doc.components.main!.layers, "card")!.layer.props.position).toEqual({ link: "mover.output" });
  });

  it("places new patches under related patches without overlapping", () => {
    const doc = apply(card(), [
      { op: "addPatch", patch: { id: "tap", type: "interaction", inputs: { layer: { layer: "card" } }, ui: { x: 40, y: 60 } } },
      { op: "addPatch", patch: { id: "grow", type: "transition", typeParam: "number", ui: { x: 400, y: 60 } } },
      { op: "connect", from: "grow.output", to: "@card.scale" },
    ]).doc;
    expect(touchPlacement(doc.components.main!, "card")).toEqual({ x: 40, y: 200 });
    const crowded = apply(doc, [{ op: "addPatch", patch: { id: "blocker", type: "switch", ui: { x: 60, y: 210 } } }]).doc;
    expect(touchPlacement(crowded.components.main!, "card")).toEqual({ x: 40, y: 340 });
    expect(touchPlacement(card().components.main!, "card")).toEqual({ x: 40, y: 60 });
  });

  it("returns undefined for unknown layers", () => {
    expect(planTouch(card(), "main", "missing", "tap", registry)).toBeUndefined();
  });
});
