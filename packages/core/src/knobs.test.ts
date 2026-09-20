import { describe, expect, it } from "vitest";
import { formatAddress, parseAddress } from "./address.ts";
import { deriveGraph, layerNodeId, nodeShapeFromData, type LayerNodeData, type PatchNodeData } from "./graph/index.ts";
import {
  deriveKnobId,
  effectiveKnobLiteral,
  effectiveKnobValues,
  findKnob,
  findKnobPreset,
  formatKnobValue,
  knobDifferences,
  knobDifferencesMarkdown,
  knobReaders,
  planVariablesToKnobs,
  resolveKnobOverride,
  suggestKnobRange,
  withKnobOverride,
} from "./knobs.ts";
import { applyOps } from "./ops/index.ts";
import { createRegistry } from "./registry.ts";
import { emptyDoc, MOCK_PATCH_SPECS, mockRegistry, mustApply, port } from "./testing/fixtures.ts";
import type { KnobSet, Op, PatchSpec, SonobeDocument } from "./types.ts";

const set: KnobSet = {
  active: "proposal",
  presets: [
    { id: "proposal", name: "Proposal" },
    { id: "shipped_app", name: "Shipped app", locked: true },
  ],
  knobs: [
    { id: "commit_distance", name: "Commit Distance", group: "Throw", type: "number", values: { proposal: 95, shipped_app: 95 }, min: 40, max: 200, step: 1, unit: "pt" },
    { id: "throw_lookahead", name: "Throw Lookahead", group: "Throw", type: "number", values: { proposal: 0.2, shipped_app: 0 }, unit: "s" },
    { id: "grab_tilt", name: "Grab Tilt", type: "boolean", values: { proposal: true } },
  ],
};

describe("knob values", () => {
  it("runs the active preset's value, falling back to the first preset that has one", () => {
    expect(effectiveKnobValues(set)).toEqual({ commit_distance: 95, throw_lookahead: 0.2, grab_tilt: true });
    expect(effectiveKnobLiteral(set, "grab_tilt", "shipped_app")).toBe(true);
    expect(effectiveKnobLiteral(set, "throw_lookahead", "shipped_app")).toBe(0);
    expect(effectiveKnobLiteral(set, "nope")).toBeUndefined();
    expect(effectiveKnobLiteral({ ...set, knobs: [{ id: "c", name: "C", type: "color", values: {} }] }, "c")).toBe("#00000000");
  });

  it("formats values for people", () => {
    expect(formatKnobValue(set.knobs[0]!, 95)).toBe("95 pt");
    expect(formatKnobValue({ type: "number", unit: "°" }, 45)).toBe("45°");
    expect(formatKnobValue({ type: "boolean" }, false)).toBe("off");
    expect(formatKnobValue({ type: "point", unit: "pt" }, [12, 40])).toBe("12, 40 pt");
    expect(formatKnobValue({ type: "enum", options: [{ key: "soft", name: "Soft" }] }, "soft")).toBe("Soft");
  });

  it("lists the differences between two presets, and as Markdown", () => {
    expect(knobDifferences(set, "proposal", "shipped_app")).toEqual([{ id: "throw_lookahead", name: "Throw Lookahead", a: 0.2, b: 0 }]);
    expect(knobDifferencesMarkdown(set, "proposal", "shipped_app")).toBe(["| Knob | Proposal | Shipped app |", "| --- | --- | --- |", "| Throw Lookahead | 0.2 s | 0 s |"].join("\n"));
    expect(knobDifferencesMarkdown(set, "proposal", "proposal")).toBe("Proposal and Proposal have the same value for every knob.");
  });

  it("finds knobs and presets by id or name, with a did-you-mean", () => {
    expect(findKnob(set, "grab tilt")).toMatchObject({ ok: true, value: { id: "grab_tilt" } });
    const miss = findKnob(set, "comit_distance");
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.error).toMatchObject({ code: "unknown_knob", message: 'There\'s no knob "comit_distance". Did you mean Commit Distance (commit_distance)?' });
    expect(findKnobPreset(set, "SHIPPED APP")).toMatchObject({ ok: true, value: { id: "shipped_app" } });
    const none = findKnob(undefined, "x");
    if (!none.ok) expect(none.error.message).toContain("no knobs yet");
  });
});

describe("withKnobOverride", () => {
  const doc = { ...emptyDoc(), knobs: set };

  it("runs another preset, or other values in the running one, on a copy that keeps its components", () => {
    const shipped = withKnobOverride(doc, { preset: "shipped_app" });
    expect(shipped.knobs!.active).toBe("shipped_app");
    expect(shipped.components).toBe(doc.components);
    expect(doc.knobs!.active).toBe("proposal");
    const tuned = withKnobOverride(doc, { preset: "shipped_app", values: { commit_distance: 120 } });
    expect(effectiveKnobValues(tuned.knobs!)).toMatchObject({ commit_distance: 120, throw_lookahead: 0 });
    expect(withKnobOverride(doc, {})).toBe(doc);
    expect(withKnobOverride(doc, { values: { commit_distance: 95 } })).toBe(doc);
  });

  it("resolves an override given by names and checks its values", () => {
    expect(resolveKnobOverride(doc, { preset: "Shipped app", values: { "Commit Distance": 110 } })).toEqual({ ok: true, value: { preset: "shipped_app", values: { commit_distance: 110 } } });
    const bad = resolveKnobOverride(doc, { values: { grab_tilt: 3 } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toContain('Knob "Grab Tilt" needs true or false');
    expect(resolveKnobOverride(doc, { preset: "Nope" }).ok).toBe(false);
  });
});

describe("suggestKnobRange", () => {
  it("works out a soft range and step from the value", () => {
    const cases: [number, [number, number, number]][] = [
      [95, [0, 200, 1]],
      [0.75, [0, 2, 0.01]],
      [1 / 30, [0, 0.1, 0.001]],
      [600, [0, 2000, 10]],
      [-20, [-50, 50, 1]],
      [0, [0, 1, 0.01]],
    ];
    for (const [value, [min, max, step]] of cases) expect(suggestKnobRange([value]), String(value)).toEqual({ min, max, step });
  });

  it("uses the port's declared bounds, progress, and its subtype's unit", () => {
    expect(suggestKnobRange([5], { min: 0, max: 20, step: 0.5 })).toEqual({ min: 0, max: 20, step: 0.5 });
    expect(suggestKnobRange([0.4], { subtype: "progress" })).toEqual({ min: 0, max: 1, step: 0.01 });
    expect(suggestKnobRange([95], { subtype: "distance" })).toEqual({ min: 0, max: 200, step: 1, unit: "pt" });
    expect(suggestKnobRange([0], { subtype: "distance" })).toEqual({ min: 0, max: 100, step: 1, unit: "pt" });
    expect(suggestKnobRange([[10, -300]])).toEqual({ min: -1000, max: 1000, step: 10 });
  });

  it("derives free ids from names", () => {
    expect(deriveKnobId(set, "Commit Distance")).toBe("commit_distance_2");
    expect(deriveKnobId(set, "Spring Feel", (id) => id === "spring_feel")).toBe("spring_feel_2");
    expect(deriveKnobId(undefined, "3D Tilt")).toBe("knob_3d_tilt");
  });
});

describe("knob addresses", () => {
  it("parse as a knob, never with a copy index or as a layer", () => {
    expect(parseAddress("$knob.commit_distance")).toEqual({ kind: "knob", key: "commit_distance" });
    expect(formatAddress({ kind: "knob", key: "commit_distance" })).toBe("$knob.commit_distance");
    expect(parseAddress("$knob.commit_distance#1")).toBeUndefined();
    expect(parseAddress("@$knob.commit_distance")).toBeUndefined();
  });

  it("list the inputs that read each knob", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addKnob", knob: { id: "gap", name: "Gap", type: "number", value: 8 } },
      { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { number: { link: "$knob.gap" } } } },
      { op: "addLayer", layer: { id: "card", type: "rectangle", props: { cornerRadius: { link: "$knob.gap" } } } },
    ]).doc;
    expect(knobReaders(doc)).toEqual([
      { knob: "gap", component: "main", target: "pop.number" },
      { knob: "gap", component: "main", target: "@card.cornerRadius" },
    ]);
  });

  it("draw as chips with the running value on graph nodes, never as cables", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addKnob", knob: { id: "gap", name: "Gap", type: "number", value: 8, unit: "pt" } },
      { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { number: { link: "$knob.gap" } } } },
      { op: "addLayer", layer: { id: "card", type: "rectangle", props: { cornerRadius: { link: "$knob.gap" } } } },
    ]).doc;
    const model = deriveGraph({ doc, componentId: "main", registry: mockRegistry });
    const input = (m: typeof model, node: string, key: string) => (m.nodes.find((n) => n.id === node)!.data as PatchNodeData | LayerNodeData).inputs.find((p) => p.key === key)!;
    expect(input(model, "pop", "number")).toMatchObject({ connected: true, link: "$knob.gap", knob: { id: "gap", name: "Gap", valueText: "8 pt" } });
    // Without a range, the chip keeps "-999 pt" for the value its field scrubs through.
    expect(input(model, layerNodeId("card"), "cornerRadius").knob).toEqual({ id: "gap", name: "Gap", valueText: "8 pt", valueReserve: 7 });
    expect(model.edges).toEqual([]);
    expect(nodeShapeFromData(model.nodes.find((n) => n.id === "pop")!.data as PatchNodeData).rows[0]!.in!.value).toEqual({ kind: "knob", name: "Gap", text: "8 pt", reserve: 7 });
    // A tune changes no patch, so the cached node must still pick up the new value.
    const tuned = mustApply(doc, [{ op: "setKnobValue", id: "gap", value: 12 }]).doc;
    expect(input(deriveGraph({ doc: tuned, componentId: "main", registry: mockRegistry, previous: model }), "pop", "number").knob?.valueText).toBe("12 pt");
  });
});

describe("planVariablesToKnobs", () => {
  const settings: PatchSpec["settings"] = [
    { key: "name", name: "Name", type: "text", default: "", description: "The variable's name." },
    { key: "scope", name: "Scope", type: "enum", default: "local", enumOptions: [{ key: "local", name: "Local" }, { key: "global", name: "Global" }], description: "Where it reaches." },
  ];
  const registry = createRegistry([
    ...MOCK_PATCH_SPECS,
    { type: "variableBroadcaster", name: "Variable Broadcaster", category: "utility", summary: "Shares a value.", variants: ["number", "boolean"], settings, inputs: [port("value", "variant", { default: 0 })], outputs: [] },
    { type: "variableReceiver", name: "Variable Receiver", category: "utility", summary: "Reads a value.", variants: ["number", "boolean"], settings, inputs: [], outputs: [port("output", "variant")] },
  ]);
  const global = (name: string) => ({ name, scope: "global" });

  function deck(): SonobeDocument {
    const r = applyOps(
      emptyDoc(),
      [
        { op: "addComponent", component: { id: "card", name: "Card", kind: "patchComponent" } },
        { op: "addPatch", patch: { id: "distance", type: "variableBroadcaster", typeParam: "number", name: "Commit Distance (app: 95)", settings: global("Commit Distance"), inputs: { value: 95 } } },
        { op: "addPatch", patch: { id: "tilt", type: "variableBroadcaster", typeParam: "boolean", settings: global("Grab Tilt"), inputs: { value: true } } },
        { op: "addPatch", patch: { id: "clock", type: "counter" } },
        { op: "addPatch", patch: { id: "scroll", type: "variableBroadcaster", typeParam: "number", settings: global("Scroll Y"), inputs: { value: { link: "clock.count" } } } },
        { op: "addPatch", patch: { id: "distance_rx", type: "variableReceiver", typeParam: "number", settings: global("Commit Distance") } },
        { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { number: { link: "distance_rx.output" }, speed: { link: "distance_rx.output" } } } },
        { op: "addPatch", component: "card", patch: { id: "tilt_rx", type: "variableReceiver", typeParam: "boolean", settings: global("Grab Tilt") } },
        { op: "addPatch", component: "card", patch: { id: "spring", type: "popAnimation", inputs: { bounciness: { link: "tilt_rx.output" } } } },
        { op: "addPatch", component: "card", patch: { id: "scroll_rx", type: "variableReceiver", typeParam: "number", settings: global("Scroll Y") } },
        { op: "addPatch", component: "card", patch: { id: "follow", type: "popAnimation", inputs: { number: { link: "scroll_rx.output" } } } },
        { op: "addPatch", patch: { id: "card_1", type: "component", component: "card" } },
      ],
      { registry },
    );
    expect(r.errors).toEqual([]);
    return r.doc;
  }

  it("turns constant broadcasters into knobs read where their receivers were read, as one undoable batch", () => {
    const doc = deck();
    const plan = planVariablesToKnobs(doc, registry);
    expect(plan.knobs).toEqual([
      { id: "commit_distance", name: "Commit Distance", component: "main", from: "distance", readers: 2 },
      { id: "grab_tilt", name: "Grab Tilt", component: "main", from: "tilt", readers: 1 },
    ]);
    expect(plan.refused).toEqual([{ component: "main", id: "scroll", reason: "Scroll Y is driven by clock.count, so it's a live signal. Keep it a variable." }]);
    const r = applyOps(doc, plan.ops, { registry });
    expect(r.errors).toEqual([]);
    expect(r.doc.knobs!.knobs).toEqual([
      { id: "commit_distance", name: "Commit Distance", type: "number", values: { default: 95 }, description: "Commit Distance (app: 95)", min: 0, max: 200, step: 1 },
      { id: "grab_tilt", name: "Grab Tilt", type: "boolean", values: { default: true } },
    ]);
    const main = r.doc.components.main!;
    expect(main.patches.pop!.inputs).toEqual({ number: { link: "$knob.commit_distance" }, speed: { link: "$knob.commit_distance" } });
    expect(Object.keys(main.patches).sort()).toEqual(["card_1", "clock", "pop", "scroll"]);
    expect(r.doc.components.card!.patches.spring!.inputs).toEqual({ bounciness: { link: "$knob.grab_tilt" } });
    expect(Object.keys(r.doc.components.card!.patches).sort()).toEqual(["follow", "scroll_rx", "spring"]);
    const undo = applyOps(r.doc, r.inverse, { registry });
    expect(undo.ok).toBe(true);
    expect(undo.doc).toStrictEqual(doc);
  });

  it("refuses a broadcaster whose receiver feeds a published output, and says why for the ids it's asked about", () => {
    const withOutput = applyOps(
      deck(),
      [
        { op: "updateInterface", component: "card", outputs: { tilt: { type: "boolean" } } },
        { op: "connect", component: "card", from: "tilt_rx.output", to: "$out.tilt" },
      ],
      { registry },
    ).doc;
    const plan = planVariablesToKnobs(withOutput, registry, { ids: ["tilt", "distance"] });
    expect(plan.knobs.map((k) => k.id)).toEqual(["commit_distance"]);
    expect(plan.refused).toEqual([{ component: "main", id: "tilt", reason: expect.stringContaining('published output "tilt"') }]);
    const unnamed = applyOps(withOutput, [{ op: "addPatch", patch: { id: "blank", type: "variableBroadcaster", typeParam: "number" } }] as Op[], { registry }).doc;
    expect(planVariablesToKnobs(unnamed, registry, { ids: ["blank"] }).refused[0]!.reason).toContain("no variable name");
  });
});
