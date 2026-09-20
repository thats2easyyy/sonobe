import { applyOps, createEmptyDocument, type KnobSet, type ResolvedPort } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { differenceCount, knobFitsPort, knobGroups, newPresetName, partnerPreset, planMakeKnob, planUnlinkKnob, planUseKnob, suggestMakeKnob } from "./model.ts";

const registry = getRegistry();

const set: KnobSet = {
  active: "proposal",
  presets: [
    { id: "proposal", name: "Proposal" },
    { id: "shipped", name: "Shipped app", locked: true },
    { id: "wild", name: "Wild" },
  ],
  knobs: [
    { id: "commit", name: "Commit Distance", group: "Throw", type: "number", values: { proposal: 95, shipped: 95, wild: 60 } },
    { id: "tilt", name: "Grab Tilt", group: "Tilt", type: "boolean", values: { proposal: true, shipped: false, wild: true } },
    { id: "lookahead", name: "Throw Lookahead", group: "Throw", type: "number", values: { proposal: 0.2, shipped: 0, wild: 0.4 } },
    { id: "radius", name: "Card Radius", type: "number", values: { proposal: 12, shipped: 12, wild: 12 } },
  ],
};

const port = (p: Partial<ResolvedPort> & Pick<ResolvedPort, "type">): ResolvedPort => ({ key: "value", name: "Value", description: "", ...p });

describe("knobs model", () => {
  it("compares against the preset that ran before, else the next one in order", () => {
    expect(partnerPreset(set, null)).toBe("shipped");
    expect(partnerPreset(set, "wild")).toBe("wild");
    expect(partnerPreset(set, "proposal")).toBe("shipped");
    expect(partnerPreset(set, "gone")).toBe("shipped");
    expect(partnerPreset({ ...set, active: "wild" }, null)).toBe("proposal");
    expect(partnerPreset({ ...set, presets: [set.presets[0]!] }, "shipped")).toBeNull();
    expect(partnerPreset(undefined, null)).toBeNull();
  });

  it("groups rows in panel order, keeps a group's place when the filter hides its first knob, and marks differences", () => {
    const uses = new Map([["commit", [1, 2]]]);
    const all = knobGroups(set, uses, "shipped");
    expect(all.map((g) => [g.name, g.rows.map((r) => r.knob.id)])).toEqual([
      [null, ["radius"]],
      ["Throw", ["commit", "lookahead"]],
      ["Tilt", ["tilt"]],
    ]);
    expect(all[1]!.rows[0]).toMatchObject({ uses: 2, differs: false, value: 95, partnerValue: 95 });
    expect(all[1]!.rows[1]!.ticks.map((t) => [t.name, t.value])).toEqual([
      ["Shipped app", 0],
      ["Wild", 0.4],
    ]);
    const different = knobGroups(set, uses, "shipped", true);
    expect(different.map((g) => [g.name, g.rows.map((r) => r.knob.id)])).toEqual([
      ["Throw", ["lookahead"]],
      ["Tilt", ["tilt"]],
    ]);
    expect(differenceCount(set, "shipped")).toBe(2);
    expect(differenceCount(set, "wild")).toBe(2);
  });

  it("offers a knob to a port when the link rules allow it, with an enum knob's options inside the port's", () => {
    const choice = { type: "enum" as const, options: [{ key: "snappy", name: "Snappy" }, { key: "soft", name: "Soft" }] };
    expect(knobFitsPort({ type: "boolean" }, port({ type: "number" }))).toBe(true);
    expect(knobFitsPort({ type: "color" }, port({ type: "number" }))).toBe(false);
    expect(knobFitsPort({ type: "number" }, port({ type: "pulse" }))).toBe(false);
    expect(knobFitsPort(choice, port({ type: "enum", enumOptions: [{ key: "snappy", name: "Snappy" }, { key: "soft", name: "Soft" }, { key: "stiff", name: "Stiff" }] }))).toBe(true);
    expect(knobFitsPort(choice, port({ type: "enum", enumOptions: [{ key: "snappy", name: "Snappy" }] }))).toBe(false);
  });

  it("plans Make Knob: the field's value in every preset, a stored range, and a link on every target, skipping ids used this session", () => {
    const doc = createEmptyDocument();
    const field = { port: port({ type: "number", name: "Response", min: 0, max: 2, subtype: "duration" }), value: 0.5, targets: [{ address: "spring.response" }, { address: "other.response" }] };
    const draft = suggestMakeKnob(field.port, field.value, "Feel");
    expect(draft).toEqual({ name: "Response", group: "Feel", min: 0, max: 2, step: 0.01, unit: "s" });
    const plan = planMakeKnob(doc, "main", field, draft, (id) => id === "response")!;
    expect(plan.id).toBe("response_2");
    expect(plan.ops).toEqual([
      { op: "addKnob", knob: { id: "response_2", name: "Response", type: "number", group: "Feel", min: 0, max: 2, step: 0.01, unit: "s", value: 0.5 } },
      { op: "setInput", component: "main", target: "spring.response", value: { link: "$knob.response_2" } },
      { op: "setInput", component: "main", target: "other.response", value: { link: "$knob.response_2" } },
    ]);
    // Sizes become points and choices keep the port's options.
    expect(planMakeKnob(doc, "main", { port: port({ type: "size", name: "Size" }), value: [300, 200], targets: [] }, { name: "Size" })!.ops[0]).toMatchObject({ knob: { type: "point", value: [300, 200] } });
    const mode = planMakeKnob(doc, "main", { port: port({ type: "enum", name: "Mode", enumOptions: [{ key: "a", name: "A" }, { key: "b", name: "B" }] }), value: "b", targets: [] }, { name: "Mode" })!;
    expect(mode.ops[0]).toMatchObject({ knob: { type: "enum", options: [{ key: "a", name: "A" }, { key: "b", name: "B" }], value: "b" } });
    expect(planMakeKnob(doc, "main", { port: port({ type: "layer" }), value: null, targets: [] }, { name: "Nope" })).toBeUndefined();
  });

  it("links with Use Knob and unlinks to the running value converted to the port's type", () => {
    expect(planUseKnob("main", [{ address: "a.x", stored: { link: "$knob.commit" } }, { address: "b.x", stored: 3 }], "commit")).toEqual([{ op: "setInput", component: "main", target: "b.x", value: { link: "$knob.commit" } }]);
    const doc = applyOps(createEmptyDocument(), [{ op: "addKnob", knob: { id: "tilt", name: "Tilt", type: "boolean", value: true } }], { registry }).doc;
    expect(planUnlinkKnob(doc.knobs!, doc.knobs!.knobs[0]!, "main", [{ address: "pop.number", type: "number" }, { address: "sw.on", type: "boolean" }])).toEqual([
      { op: "setInput", component: "main", target: "pop.number", value: 1 },
      { op: "setInput", component: "main", target: "sw.on", value: true },
    ]);
  });

  it("names new presets after the running one", () => {
    expect(newPresetName(set)).toBe("Proposal 2");
    expect(newPresetName({ ...set, presets: [...set.presets, { id: "p2", name: "Proposal 2" }] })).toBe("Proposal 3");
    expect(newPresetName({ active: "default", presets: [{ id: "default", name: "Default" }], knobs: [] })).toBe("Preset 2");
    expect(newPresetName(undefined)).toBe("Preset 2");
  });
});
