import { describe, expect, it } from "vitest";
import { createIdLedger } from "../idLedger.ts";
import { DEFAULT_KNOB_PRESET, effectiveKnobLiteral, MAX_KNOB_PRESETS } from "../knobs.ts";
import { createRegistry } from "../registry.ts";
import { KNOBS_FILE, parseDocumentFiles, serializeDocument } from "../serialize.ts";
import { buildSampleDocument, emptyDoc, expectRoundTrip, MOCK_PATCH_SPECS, mockRegistry, mustApply, port } from "../testing/fixtures.ts";
import type { Op, SonobeDocument, SonobeError } from "../types.ts";
import { applyOps, type ApplyOpsOptions } from "./index.ts";

const apply = (doc: SonobeDocument, ops: Op[], extra: Partial<ApplyOpsOptions> = {}) => applyOps(doc, ops, { registry: mockRegistry, ...extra });

function firstError(doc: SonobeDocument, ops: Op[], extra: Partial<ApplyOpsOptions> = {}): SonobeError {
  const r = apply(doc, ops, extra);
  expect(r.ok).toBe(false);
  expect(r.doc).toBe(doc);
  return r.errors[0]!;
}

const distance: Op = { op: "addKnob", knob: { id: "commit_distance", name: "Commit Distance", type: "number", value: 95, min: 40, max: 200, step: 1, unit: "pt" } };

/** Proposal (running) and a locked Shipped app, with Commit Distance 95 / 80. */
function twoPresets(): SonobeDocument {
  return mustApply(emptyDoc(), [
    { op: "addKnobPreset", preset: { name: "Proposal" } },
    { op: "addKnobPreset", preset: { name: "Shipped app" } },
    distance,
    { op: "setKnobValue", id: "commit_distance", preset: "shipped_app", value: 80 },
    { op: "updateKnobPreset", id: "shipped_app", locked: true },
  ]).doc;
}

describe("addKnob", () => {
  it("creates the knob set with a Default preset, and its inverse removes the set again", () => {
    const before = emptyDoc();
    const r = mustApply(before, [distance]);
    expect(r.doc.knobs).toEqual({
      active: "default",
      presets: [{ id: "default", name: "Default" }],
      knobs: [{ id: "commit_distance", name: "Commit Distance", type: "number", values: { default: 95 }, min: 40, max: 200, step: 1, unit: "pt" }],
    });
    expect(r.results[0]!.ids).toEqual(["commit_distance"]);
    expect(r.affected).toEqual({ components: [], layers: [], patches: [], knobs: ["commit_distance"], presets: ["default"] });
    expectRoundTrip(before, r);
    const undo = apply(r.doc, r.inverse);
    expect("knobs" in undo.doc).toBe(false);
  });

  it("derives ids from names, gives every preset a value, and checks the fields fit the type", () => {
    const doc = twoPresets();
    const r = mustApply(doc, [
      { op: "addKnob", knob: { name: "Grab Tilt", type: "boolean", value: true, values: { shipped_app: false } } },
      { op: "addKnob", knob: { name: "Mode", type: "enum", options: [{ key: "snappy", name: "Snappy" }, { key: "soft", name: "Soft" }] } },
    ]);
    const [, tilt, mode] = r.doc.knobs!.knobs;
    expect(tilt).toMatchObject({ id: "grab_tilt", values: { proposal: true, shipped_app: false } });
    // Creating a knob may set a value in a locked preset: it adds a dimension.
    expect(mode).toMatchObject({ id: "mode", values: { proposal: "snappy", shipped_app: "snappy" } });
    expectRoundTrip(doc, r);
    expect(firstError(doc, [{ op: "addKnob", knob: { name: "Tilt", type: "boolean", min: 0 } }])).toMatchObject({ code: "invalid_knob", message: expect.stringContaining("has no min") });
    expect(firstError(doc, [{ op: "addKnob", knob: { name: "Mode 2", type: "enum", options: [{ key: "a", name: "A" }] } }]).message).toContain("at least 2 options");
    expect(firstError(doc, [{ op: "addKnob", knob: { name: "Far", type: "number", min: 10, max: 5 } }]).message).toContain("min must be below max");
    expect(firstError(doc, [{ op: "addKnob", knob: { name: "commit distance", type: "number" } }]).message).toContain('already a knob named "Commit Distance"');
    expect(firstError(doc, [{ op: "addKnob", knob: { name: "Width", type: "number", value: "95" } }])).toMatchObject({ code: "invalid_value", hint: expect.stringContaining("without quotes") });
    expect(firstError(doc, [{ op: "addKnob", knob: { name: "Width", type: "number", values: { nope: 1 } } }]).code).toBe("unknown_knob_preset");
    expect(firstError(doc, [{ op: "addKnob", knob: { name: "Width", type: "number", vaule: 1 } as never }])).toMatchObject({ code: "unknown_field", message: expect.stringContaining('Did you mean "value"') });
    expect(firstError(doc, [{ op: "addKnob", knob: { name: "Width", type: "slider" as never } }]).message).toContain("number, boolean, color, enum, point, text");
  });

  it("never reuses a removed knob id in the same session, and refuses past the limits", () => {
    const ledger = createIdLedger();
    const one = mustApply(emptyDoc(), [distance]).doc;
    ledger.observe(one);
    const gone = mustApply(one, [{ op: "removeKnob", id: "commit_distance" }]).doc;
    ledger.observe(gone);
    const again = mustApply(gone, [{ op: "addKnob", knob: { name: "Commit Distance", type: "number" } }], { seenIds: ledger });
    expect(again.doc.knobs!.knobs[0]!.id).toBe("commit_distance_2");
    expect(again.results[0]!.retired).toEqual({ commit_distance_2: "commit_distance" });
    expect(firstError(gone, [distance], { seenIds: ledger })).toMatchObject({ code: "id_retired" });
    // A batch may still remove a knob and add one under its id.
    expect(apply(one, [{ op: "removeKnob", id: "commit_distance" }, distance], { seenIds: ledger }).ok).toBe(true);

    let presets = emptyDoc();
    for (let i = 0; i < MAX_KNOB_PRESETS; i++) presets = mustApply(presets, [{ op: "addKnobPreset", preset: { name: `P${i}` } }]).doc;
    expect(firstError(presets, [{ op: "addKnobPreset", preset: { name: "One more" } }])).toMatchObject({ code: "limit_exceeded" });
  });
});

describe("setKnobValue", () => {
  it("tunes the running preset and refuses a locked one unless lenient", () => {
    const doc = twoPresets();
    const r = mustApply(doc, [{ op: "setKnobValue", id: "commit_distance", value: 110 }]);
    expect(r.doc.knobs!.knobs[0]!.values).toEqual({ proposal: 110, shipped_app: 80 });
    expectRoundTrip(doc, r);
    const locked = firstError(doc, [{ op: "setKnobValue", id: "commit_distance", preset: "shipped_app", value: 70 }]);
    expect(locked).toMatchObject({ code: "preset_locked", message: "Shipped app is locked, so its values stay as they are.", hint: "Switch to Proposal to tune, or unlock Shipped app." });
    expect(locked.suggestions?.map((s) => s.ops)).toEqual([[{ op: "applyKnobPreset", id: "proposal" }], [{ op: "updateKnobPreset", id: "shipped_app", locked: false }]]);
    expect(apply(doc, [{ op: "setKnobValue", id: "commit_distance", preset: "shipped_app", value: 70 }], { lenient: true }).ok).toBe(true);
    expect(firstError(doc, [{ op: "setKnobValue", id: "Commit Distance", value: 1 }]).message).toContain("ops name knobs by id");
    expect(firstError(doc, [{ op: "setKnobValue", id: "comit_distance", value: 1 }]).message).toContain("Did you mean Commit Distance (commit_distance)?");
  });
});

describe("presets", () => {
  it("adds presets copied from the running one, renames, locks, reorders and switches them", () => {
    const doc = twoPresets();
    const add = mustApply(doc, [{ op: "setKnobValue", id: "commit_distance", value: 120 }, { op: "addKnobPreset", preset: { name: "Wild" }, index: 0 }]);
    expect(add.doc.knobs!.presets.map((p) => p.id)).toEqual(["wild", "proposal", "shipped_app"]);
    expect(add.doc.knobs!.knobs[0]!.values.wild).toBe(120);
    expectRoundTrip(doc, add);
    const copied = mustApply(doc, [{ op: "addKnobPreset", preset: { name: "From shipped" }, copyFrom: "shipped_app" }]);
    expect(copied.doc.knobs!.knobs[0]!.values.from_shipped).toBe(80);
    const update = mustApply(doc, [{ op: "updateKnobPreset", id: "shipped_app", name: "Shipped", locked: false, index: 0 }]);
    expect(update.doc.knobs!.presets).toEqual([{ id: "shipped_app", name: "Shipped" }, { id: "proposal", name: "Proposal" }]);
    expectRoundTrip(doc, update);
    const flip = mustApply(doc, [{ op: "applyKnobPreset", id: "shipped_app" }]);
    expect(flip.doc.knobs!.active).toBe("shipped_app");
    expect(flip.inverse).toEqual([{ op: "applyKnobPreset", id: "proposal" }]);
    expectRoundTrip(doc, flip);
  });

  it("refuses to remove the last preset or a locked one, and moves the running preset on", () => {
    const doc = twoPresets();
    expect(firstError(doc, [{ op: "removeKnobPreset", id: "shipped_app" }])).toMatchObject({ code: "preset_locked", message: "Shipped app is locked. Unlock Shipped app first." });
    const unlocked = mustApply(doc, [{ op: "updateKnobPreset", id: "shipped_app", locked: false }]).doc;
    const r = mustApply(unlocked, [{ op: "removeKnobPreset", id: "proposal" }]);
    expect(r.doc.knobs!.active).toBe("shipped_app");
    expect(r.doc.knobs!.knobs[0]!.values).toEqual({ shipped_app: 80 });
    expectRoundTrip(unlocked, r);
    expect(firstError(r.doc, [{ op: "removeKnobPreset", id: "shipped_app" }])).toMatchObject({ code: "last_preset" });
    // Without knobs the last preset can go, and takes the set with it.
    const lone = mustApply(emptyDoc(), [{ op: "addKnobPreset", preset: { name: "Proposal", locked: true } }]);
    expect(lone.doc.knobs).toEqual({ active: "proposal", presets: [{ id: "proposal", name: "Proposal", locked: true }], knobs: [] });
    expectRoundTrip(emptyDoc(), lone);
  });
});

describe("updateKnob", () => {
  it("changes metadata and ranges, and drops fields the new type can't have", () => {
    const doc = twoPresets();
    const r = mustApply(doc, [{ op: "updateKnob", id: "commit_distance", name: "Throw Distance", group: "Throw", max: null, unit: "px", index: 0 }]);
    expect(r.doc.knobs!.knobs[0]).toMatchObject({ name: "Throw Distance", group: "Throw", min: 40, unit: "px" });
    expect(r.doc.knobs!.knobs[0]!.max).toBeUndefined();
    expectRoundTrip(doc, r);
    const retyped = mustApply(doc, [{ op: "updateKnob", id: "commit_distance", type: "boolean" }]);
    // A type change may write a locked preset: the values convert.
    expect(retyped.doc.knobs!.knobs[0]).toEqual({ id: "commit_distance", name: "Commit Distance", type: "boolean", values: { proposal: true, shipped_app: true } });
    expectRoundTrip(doc, retyped);
    expect(firstError(doc, [{ op: "updateKnob", id: "commit_distance", type: "color" }]).message).toContain("can't turn from number into color");
  });

  it("refuses a type or options change that its readers or values can't take", () => {
    const doc = mustApply(twoPresets(), [
      { op: "addPatch", patch: { id: "hex", type: "hexColor", inputs: { hex: { link: "$knob.commit_distance" } } } },
      { op: "addKnob", knob: { id: "mode", name: "Mode", type: "enum", options: [{ key: "a", name: "A" }, { key: "b", name: "B" }], value: "b" } },
    ]).doc;
    // A number reaches a text input, but a point doesn't.
    const readers = firstError(doc, [{ op: "updateKnob", id: "commit_distance", type: "point" }]);
    expect(readers).toMatchObject({ code: "knob_type_mismatch", message: expect.stringContaining("hex.hex") });
    expect(readers.suggestions?.[0]?.ops).toEqual([{ op: "setInput", component: "main", target: "hex.hex", value: "95" }]);
    expect(firstError(doc, [{ op: "updateKnob", id: "mode", options: [{ key: "a", name: "A" }, { key: "c", name: "C" }] }]).message).toContain('has no option "b"');
  });
});

describe("removeKnob", () => {
  const registry = createRegistry([
    ...MOCK_PATCH_SPECS,
    { type: "picker", name: "Picker", category: "state", summary: "Picks.", inputs: [port("count", "index", { default: 0 }), port("label", "text", { default: "" })], outputs: [port("output", "number")] },
  ]);

  it("leaves every reader holding the running value, converted to its type, and its inverse relinks them", () => {
    const build = applyOps(
      emptyDoc(),
      [
        { op: "addKnobPreset", preset: { name: "Proposal" } },
        { op: "addKnob", knob: { id: "gap", name: "Gap", type: "number", value: 2.6 } },
        { op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent", interface: { inputs: { amount: { key: "amount", name: "Amount", type: "number" } }, outputs: {} } } },
        { op: "addComponent", component: { id: "chip", name: "Chip", kind: "layerComponent", interface: { inputs: { spacing: { key: "spacing", name: "Spacing", type: "number" } }, outputs: {} } } },
        { op: "addPatch", patch: { id: "pick", type: "picker", inputs: { count: { link: "$knob.gap" }, label: { link: "$knob.gap" } } } },
        { op: "addPatch", patch: { id: "logic_1", type: "component", component: "logic", inputs: { amount: { link: "$knob.gap" } } } },
        { op: "addLayer", layer: { id: "card", type: "rectangle", props: { opacity: { link: "$knob.gap" }, size: { link: "$knob.gap" } } } },
        { op: "addLayer", layer: { id: "chip_1", type: "componentInstance", component: "chip", props: { spacing: { link: "$knob.gap" } } } },
        { op: "addPatch", component: "logic", patch: { id: "inner", type: "popAnimation", inputs: { speed: { link: "$knob.gap" } } } },
      ],
      { registry },
    );
    expect(build.ok).toBe(true);
    const doc = build.doc;
    const r = applyOps(doc, [{ op: "removeKnob", id: "gap" }], { registry });
    expect(r.ok).toBe(true);
    const main = r.doc.components.main!;
    expect(main.patches.pick!.inputs).toEqual({ count: 2, label: "2.6" });
    expect(main.patches.logic_1!.inputs).toEqual({ amount: 2.6 });
    expect(main.layers.find((l) => l.id === "card")!.props).toEqual({ opacity: 2.6, size: [2.6, 2.6] });
    expect(main.layers.find((l) => l.id === "chip_1")!.props).toEqual({ spacing: 2.6 });
    expect(r.doc.components.logic!.patches.inner!.inputs).toEqual({ speed: 2.6 });
    expect(r.doc.knobs).toEqual({ active: "proposal", presets: [{ id: "proposal", name: "Proposal" }], knobs: [] });
    expect(r.affected.components).toEqual(["logic", "main"]);
    const undo = applyOps(r.doc, r.inverse, { registry });
    expect(undo.ok).toBe(true);
    expect(undo.doc).toStrictEqual(doc);
  });
});

describe("knob links", () => {
  it("connect into patch inputs, layer properties, instance inputs and broadcaster values", () => {
    const registry = createRegistry([
      ...MOCK_PATCH_SPECS,
      { type: "variableBroadcaster", name: "Variable Broadcaster", category: "utility", summary: "Shares a value.", variants: ["number", "boolean"], inputs: [port("value", "variant", { default: 0 })], outputs: [] },
      { type: "chooser", name: "Chooser", category: "state", summary: "Chooses.", inputs: [port("mode", "enum", { enumOptions: [{ key: "a", name: "A" }, { key: "b", name: "B" }], default: "a" })], outputs: [] },
    ]);
    const base = applyOps(
      emptyDoc(),
      [
        distance,
        { op: "addKnob", knob: { id: "on", name: "On", type: "boolean", value: true } },
        { op: "addKnob", knob: { id: "mode", name: "Mode", type: "enum", options: [{ key: "a", name: "A" }, { key: "c", name: "C" }], value: "a" } },
        { op: "addComponent", component: { id: "chip", name: "Chip", kind: "layerComponent", interface: { inputs: { size: { key: "size", name: "Size", type: "number" } }, outputs: {} } } },
        { op: "addPatch", patch: { id: "pop", type: "popAnimation" } },
        { op: "addPatch", patch: { id: "share", type: "variableBroadcaster", typeParam: "number" } },
        { op: "addPatch", patch: { id: "choose", type: "chooser" } },
        { op: "addLayer", layer: { id: "card", type: "rectangle" } },
        { op: "addLayer", layer: { id: "chip_1", type: "componentInstance", component: "chip" } },
      ],
      { registry },
    );
    expect(base.ok).toBe(true);
    const doc = base.doc;
    const ok = applyOps(
      doc,
      [
        { op: "connect", from: "$knob.commit_distance", to: "pop.number" },
        { op: "setInput", target: "@card.cornerRadius", value: { link: "$knob.commit_distance" } },
        { op: "setInput", target: "@chip_1.size", value: { link: "$knob.commit_distance" } },
        { op: "setInput", target: "share.value", value: { link: "$knob.commit_distance" } },
        { op: "connect", from: "$knob.on", to: "pop.speed" },
      ],
      { registry },
    );
    expect(ok.ok).toBe(true);
    expect(ok.doc.components.main!.patches.pop!.inputs).toEqual({ number: { link: "$knob.commit_distance" }, speed: { link: "$knob.on" } });
    const err = (ops: Op[]) => applyOps(doc, ops, { registry }).errors[0]!;
    expect(err([{ op: "connect", from: "$knob.commit_distance", to: "@card.color" }])).toMatchObject({
      code: "knob_type_mismatch",
      message: 'Knob "Commit Distance" is a number, but Rectangle\'s Color needs a color.',
    });
    expect(err([{ op: "connect", from: "$knob.mode", to: "choose.mode" }])).toMatchObject({ code: "knob_type_mismatch", message: expect.stringContaining("the option c") });
    expect(err([{ op: "connect", from: "$knob.nope", to: "pop.number" }])).toMatchObject({ code: "unknown_knob" });
    expect(err([{ op: "connect", from: "$knob.comit_distance", to: "pop.number" }]).message).toContain("Did you mean Commit Distance (commit_distance)?");
    expect(err([{ op: "setInput", target: "$knob.commit_distance", value: 3 }])).toMatchObject({ code: "invalid_address", message: expect.stringContaining("Knobs are read, not written") });
    expect(err([{ op: "connect", from: "pop.output", to: "$knob.commit_distance" }]).message).toContain("Knobs are read, not written");
    expect(err([{ op: "connect", from: "$knob.commit_distance#1", to: "pop.number" }]).message).toContain("a knob is one value for every copy");
    expect(err([{ op: "addPatch", patch: { ref: "knob", type: "switch" } }])).toMatchObject({ code: "invalid_ref" });
    const outputs = applyOps(doc, [{ op: "updateInterface", component: "chip", outputs: { size: { type: "number" } } }, { op: "connect", component: "chip", from: "$knob.commit_distance", to: "$out.size" }], { registry });
    expect(outputs.errors[0]).toMatchObject({ code: "knob_into_output", hint: expect.stringContaining("Splitter") });
  });

  it("stay inside a new component instead of becoming published inputs", () => {
    const doc = mustApply(emptyDoc(), [distance, { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { number: { link: "$knob.commit_distance" } } } }]).doc;
    const r = mustApply(doc, [{ op: "createComponent", name: "Spring", patchIds: ["pop"] }]);
    expect(r.doc.components.spring!.interface.inputs).toEqual({});
    expect(r.doc.components.spring!.patches.pop!.inputs).toEqual({ number: { link: "$knob.commit_distance" } });
  });

  it("carry through replacePatch when the new port takes the knob, and drop (undoably) when it doesn't", () => {
    const doc = mustApply(emptyDoc(), [
      distance,
      { op: "addKnob", knob: { id: "on", name: "On", type: "boolean", value: true } },
      { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { number: { link: "$knob.commit_distance" }, bounciness: { link: "$knob.on" } } } },
    ]).doc;
    const r = mustApply(doc, [{ op: "replacePatch", id: "pop", patch: { type: "transition" }, inputMap: { number: "progress" } }]);
    expect(r.doc.components.main!.patches.pop!.inputs).toEqual({ progress: { link: "$knob.commit_distance" } });
    expect(r.results[0]).toMatchObject({ dropped: [{ to: "pop.bounciness", value: { link: "$knob.on" } }] });
    expectRoundTrip(doc, r);
  });

  it("keep the Default preset a set started with through a first knob and its undo", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addKnobPreset", preset: { ...DEFAULT_KNOB_PRESET } }]).doc;
    const r = mustApply(doc, [distance]);
    expectRoundTrip(doc, r);
  });
});

describe("undo and redo on knob sets a hand edit left (they load, with diagnostics)", () => {
  type KnobsJson = { active: string; presets: { id: string; name: string }[]; knobs: { id: string; name: string; group?: string; options?: unknown[]; values: Record<string, unknown> }[] };
  /** Knobs Gap (read by pop.bounciness), Width and Mode in presets Default and B, saved, then knobs.json edited by hand and read back. */
  function loaded(edit: (file: KnobsJson) => void): SonobeDocument {
    const doc = mustApply(buildSampleDocument(), [
      { op: "addKnob", knob: { id: "gap", name: "Gap", type: "number", value: 8 } },
      { op: "addKnob", knob: { id: "width", name: "Width", type: "number", value: 100 } },
      { op: "addKnob", knob: { id: "mode", name: "Mode", type: "enum", options: [{ key: "a", name: "A" }, { key: "b", name: "B" }] } },
      { op: "addKnobPreset", preset: { id: "b", name: "B" } },
      { op: "setKnobValue", id: "gap", preset: "b", value: 5 },
      { op: "setInput", target: "pop.bounciness", value: { link: "$knob.gap" } },
    ]).doc;
    const files = serializeDocument(doc);
    const file = JSON.parse(files[KNOBS_FILE]!) as KnobsJson;
    edit(file);
    return parseDocumentFiles({ ...files, [KNOBS_FILE]: JSON.stringify(file) });
  }
  const knob = (file: KnobsJson, id: string) => file.knobs.find((k) => k.id === id)!;
  const cases: { name: string; edit: (file: KnobsJson) => void; ops: Op[] }[] = [
    { name: "a value for a preset that isn't there", edit: (f) => void (knob(f, "gap").values.old = 3), ops: [{ op: "removeKnob", id: "gap" }, { op: "updateKnob", id: "gap", type: "boolean" }, { op: "updateKnob", id: "gap", type: "text" }] },
    { name: "a preset without a value of its own", edit: (f) => void delete knob(f, "gap").values.default, ops: [{ op: "removeKnob", id: "gap" }, { op: "updateKnob", id: "gap", type: "boolean" }] },
    { name: "a running preset that isn't one", edit: (f) => void (f.active = "proposal"), ops: [{ op: "applyKnobPreset", id: "default" }, { op: "removeKnobPreset", id: "b" }, { op: "removeKnob", id: "gap" }] },
    { name: "knob names alike ignoring case", edit: (f) => void (knob(f, "width").name = "GAP"), ops: [{ op: "removeKnob", id: "gap" }, { op: "removeKnob", id: "width" }, { op: "updateKnob", id: "width", name: "Wide" }] },
    { name: "preset names alike ignoring case", edit: (f) => void (f.presets[1]!.name = "DEFAULT"), ops: [{ op: "removeKnobPreset", id: "b" }, { op: "removeKnobPreset", id: "default" }, { op: "updateKnobPreset", id: "b", name: "Other" }] },
    {
      name: "a group with spaces and an option listed twice",
      edit: (f) => void Object.assign(knob(f, "mode"), { group: " Throw ", options: [{ key: "a", name: "A" }, { key: "a", name: "" }, { key: "b", name: "B" }] }),
      ops: [{ op: "removeKnob", id: "mode" }, { op: "updateKnob", id: "mode", group: "Tilt", options: [{ key: "a", name: "A" }, { key: "b", name: "B" }] }],
    },
  ];
  for (const c of cases) {
    it(`restore ${c.name}`, () => {
      const doc = loaded(c.edit);
      for (const op of c.ops) {
        const r = apply(doc, [op]);
        expect(r.errors, JSON.stringify(op)).toEqual([]);
        // History replays undo and redo leniently.
        const undo = apply(r.doc, r.inverse, { lenient: true });
        expect(undo.errors, `undo of ${JSON.stringify(op)}`).toEqual([]);
        expect(undo.doc, `undo of ${JSON.stringify(op)}`).toStrictEqual(doc);
        expect(apply(doc, r.applied, { lenient: true }).doc, `redo of ${JSON.stringify(op)}`).toStrictEqual(r.doc);
      }
    });
  }

  it("keep what a preset without a value of its own runs", () => {
    const doc = loaded((f) => void delete knob(f, "gap").values.default);
    expect(effectiveKnobLiteral(doc.knobs!, "gap")).toBe(5);
    const r = mustApply(doc, [{ op: "removeKnob", id: "gap" }]);
    expect(r.doc.components.main!.patches.pop!.inputs.bounciness).toBe(5);
    const undo = apply(r.doc, r.inverse, { lenient: true });
    expect(effectiveKnobLiteral(undo.doc.knobs!, "gap")).toBe(5);
  });
});
