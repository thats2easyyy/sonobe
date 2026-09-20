import { applyOps, createEmptyDocument, MAX_KNOBS, type Op } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { planConversion } from "./ConvertVariablesDialog.tsx";

const registry = getRegistry();

/** A shared Card Radius in the root and a shared Bounce inside a patch component, with `knobs` knobs already. */
function fixture(knobs: number) {
  const ops: Op[] = [
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
    { op: "addPatch", patch: { id: "radius_var", type: "variableBroadcaster", typeParam: "number", settings: { name: "Card Radius" }, inputs: { value: 16 }, ui: { x: 0, y: 0 } } },
    { op: "addPatch", patch: { id: "radius_in", type: "variableReceiver", typeParam: "number", settings: { name: "Card Radius" }, ui: { x: 200, y: 0 } } },
    { op: "connect", from: "radius_in.output", to: "@card.cornerRadius" },
    { op: "addPatch", patch: { id: "bounce_var", type: "variableBroadcaster", typeParam: "number", settings: { name: "Bounce" }, inputs: { value: 8 }, ui: { x: 0, y: 200 } } },
    { op: "addPatch", patch: { id: "bounce_in", type: "variableReceiver", typeParam: "number", settings: { name: "Bounce" }, ui: { x: 200, y: 200 } } },
    { op: "addPatch", patch: { id: "pop", type: "popAnimation", typeParam: "number", ui: { x: 400, y: 200 } } },
    { op: "connect", from: "bounce_in.output", to: "pop.bounciness" },
    { op: "createComponent", component: "main", name: "Inner", patchIds: ["bounce_var", "bounce_in", "pop"] },
  ];
  for (let i = 0; i < knobs; i++) ops.push({ op: "addKnob", knob: { id: `k${i}`, name: `Knob ${i}`, type: "number", value: i } });
  const result = applyOps(createEmptyDocument(), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const chosen = [
  { component: "main", from: "radius_var" },
  { component: "inner", from: "bounce_var" },
];

describe("Convert Variables to Knobs", () => {
  it("converts broadcasters across components in one batch", () => {
    const doc = fixture(0);
    const planned = planConversion(doc, registry, chosen, () => false);
    expect(planned).toMatchObject({ ok: true, count: 2 });
    const result = applyOps(doc, planned.ok ? planned.ops : [], { registry });
    expect(result.ok).toBe(true);
    expect(result.doc.knobs!.knobs.map((k) => k.id)).toEqual(["card_radius", "bounce"]);
    expect(result.doc.components.inner!.patches.pop!.inputs.bounciness).toEqual({ link: "$knob.bounce" });
  });

  it("converts nothing when one component's part can't apply, and names it", () => {
    // Room for one more knob: the root's converts, the component's would pass the limit.
    const doc = fixture(MAX_KNOBS - 1);
    const planned = planConversion(doc, registry, chosen, () => false);
    expect(planned).toMatchObject({ ok: false, component: "inner" });
    expect(!planned.ok && planned.message).toMatch(/500/);
    expect(planConversion(doc, registry, chosen.slice(0, 1), () => false)).toMatchObject({ ok: true, count: 1 });
  });
});
