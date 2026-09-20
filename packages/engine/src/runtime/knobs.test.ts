import { applyOps, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port, type PatchInput } from "../testing/index.ts";
import { compileDocument, updateLiterals } from "./compile.ts";

const registry = createMockRegistry();

const apply = (doc: SonobeDocument, ops: Op[]) => {
  const r = applyOps(doc, ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
};

/**
 * Knobs read in every kind of place: a root patch input, a patch component placed twice and
 * replicated by a loop, a layer component instance's published input, a layer property, and a
 * Variable Broadcaster's value read by a receiver.
 */
function knobDoc(): SonobeDocument {
  const doc = buildDoc({
    components: [
      {
        id: "logic",
        kind: "patchComponent",
        inputs: { index: { type: "number" } },
        patches: { scale: { type: "multiply", inputs: { a: { link: "$in.index" }, b: 1 } } },
        outputs: { out: { type: "number", link: "scale.output" } },
      },
      {
        id: "chip",
        kind: "layerComponent",
        inputs: { radius: { type: "number" } },
        layers: [{ id: "face", type: "rectangle", name: "Face", props: { cornerRadius: { link: "$in.radius" } } }],
      },
    ],
    layers: [
      { id: "card", type: "rectangle", name: "Card", props: { opacity: 1, position: { link: "drift.output" } } },
      { id: "chip_1", type: "componentInstance", name: "Chip", component: "chip", props: { radius: 4 } },
    ],
    patches: {
      clock: { type: "time" },
      drift: { type: "transition", typeParam: "point", inputs: { progress: { link: "clock.time" }, start: [0, 0], end: [100, 40] } },
      pop: { type: "popAnimation", inputs: { number: { link: "clock.time" }, bounciness: 5 } },
      rows: { type: "loop", inputs: { count: 3 } },
      logic_1: { type: "component", component: "logic", inputs: { index: { link: "rows.index" } } },
      logic_2: { type: "component", component: "logic", inputs: { index: 2 } },
      share: { type: "variableBroadcaster", typeParam: "number", settings: { name: "Speed" }, inputs: { value: 10 } },
      share_rx: { type: "variableReceiver", typeParam: "number", settings: { name: "Speed" } },
      chase: { type: "popAnimation", inputs: { number: { link: "clock.time" }, speed: { link: "share_rx.output" } } },
    },
  });
  return apply(doc, [
    { op: "addKnobPreset", preset: { name: "Proposal" } },
    { op: "addKnobPreset", preset: { name: "Shipped app" } },
    { op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", value: 12, values: { shipped_app: 3 } } },
    { op: "addKnob", knob: { id: "gap", name: "Gap", type: "number", value: 7, values: { shipped_app: 2 } } },
    { op: "addKnob", knob: { id: "fade", name: "Fade", type: "boolean", value: true, values: { shipped_app: false } } },
    { op: "setInput", target: "pop.bounciness", value: { link: "$knob.bounce" } },
    { op: "setInput", component: "logic", target: "scale.b", value: { link: "$knob.gap" } },
    { op: "setInput", target: "@chip_1.radius", value: { link: "$knob.gap" } },
    { op: "setInput", target: "@card.opacity", value: { link: "$knob.fade" } },
    { op: "setInput", target: "share.value", value: { link: "$knob.bounce" } },
  ]);
}

const TARGETS = ["pop.output", "logic_1/scale.output", "logic_1#2/scale.output", "logic_2/scale.output", "@card.opacity", "@chip_1/face.cornerRadius", "chase.output", "@card.position"];

function run(doc: SonobeDocument, frames: number, edit?: { at: number; doc: SonobeDocument }): unknown[][] {
  const rt = createTestRuntime(doc, registry);
  const out: unknown[][] = [];
  for (let i = 0; i < frames; i++) {
    if (edit && i === edit.at) rt.updateDocument(edit.doc);
    rt.step();
    out.push(TARGETS.map((t) => rt.getValue(t)));
  }
  rt.dispose();
  return out;
}

/** The document with every knob removed: each reader holds the value it read (core's removeKnob). */
const baked = (doc: SonobeDocument) => apply(doc, doc.knobs!.knobs.map((k): Op => ({ op: "removeKnob", id: k.id })));

describe("knobs in the engine", () => {
  it("reads a knob exactly like the literal it holds, in every kind of reader", () => {
    const doc = knobDoc();
    const knobs = run(doc, 40);
    expect(knobs).toEqual(run(baked(doc), 40));
    const last = knobs.at(-1)!;
    expect(last[1]).toBe(0);
    expect(last[2]).toBe(14);
    expect(last[3]).toBe(14);
    expect(last[4]).toBe(1);
    expect(last[5]).toBe(7);
    const shipped = apply(doc, [{ op: "applyKnobPreset", id: "shipped_app" }]);
    expect(run(shipped, 40)).toEqual(run(baked(shipped), 40));
  });

  it("hot-patches value edits and preset switches in place, and recompiles structural knob changes", () => {
    const doc = knobDoc();
    const fast: Op[][] = [
      [{ op: "setKnobValue", id: "bounce", value: 20 }],
      [{ op: "applyKnobPreset", id: "shipped_app" }],
      [{ op: "updateKnob", id: "gap", name: "Spacing", min: 0, max: 50, group: "Layout" }],
      [{ op: "addKnobPreset", preset: { name: "Wild" } }, { op: "updateKnobPreset", id: "wild", name: "Wilder", locked: true }],
      [{ op: "addKnob", knob: { name: "Unused", type: "number", value: 1 } }],
      [{ op: "setKnobValue", id: "gap", value: 9 }, { op: "setInput", target: "drift.end", value: [120, 40] }],
    ];
    for (const ops of fast) {
      const graph = compileDocument(doc, registry);
      expect(updateLiterals(graph, apply(doc, ops)), JSON.stringify(ops)).toBe(true);
    }
    const graph = compileDocument(doc, registry);
    const pop = graph.root!.nodes.get("pop")!;
    const bounciness = pop.bindings[pop.inputIndex.get("bounciness")!]!;
    expect(updateLiterals(graph, apply(doc, [{ op: "applyKnobPreset", id: "shipped_app" }]))).toBe(true);
    expect(pop.bindings[pop.inputIndex.get("bounciness")!]).toBe(bounciness);
    expect(bounciness).toMatchObject({ kind: "const", value: 3 });
    expect(graph.knobs.values.get("fade")).toBe(false);

    const structural: Op[][] = [[{ op: "updateKnob", id: "fade", type: "number" }], [{ op: "removeKnob", id: "gap" }]];
    for (const ops of structural) {
      const g = compileDocument(doc, registry);
      expect(updateLiterals(g, apply(doc, ops)), JSON.stringify(ops)).toBe(false);
    }
    // A reader whose ports come from its node recompiles on a new value, like a literal edit does.
    const dyn = defineMock({
      type: "dyn",
      name: "Dynamic",
      inputs: [],
      outputs: [port("output", "number")],
      dynamicPorts: () => ({ inputs: [port("amount", "number")], outputs: [port("output", "number")] }),
      evaluate(ctx) {
        ctx.output("output", ctx.input<number>("amount"));
      },
    });
    const dynRegistry = createMockRegistry([dyn]);
    const withDyn = applyOps(doc, [{ op: "addPatch", patch: { id: "d", type: "dyn", inputs: { amount: { link: "$knob.bounce" } } } }], { registry: dynRegistry }).doc;
    const tune = (ops: Op[]) => updateLiterals(compileDocument(withDyn, dynRegistry), applyOps(withDyn, ops, { registry: dynRegistry }).doc);
    expect(tune([{ op: "setKnobValue", id: "bounce", value: 4 }])).toBe(false);
    expect(tune([{ op: "setKnobValue", id: "gap", value: 4 }])).toBe(true);
    expect(tune([{ op: "updateKnob", id: "bounce", name: "Springiness" }])).toBe(true);
  });

  it("recompiles when a knob a link names appears, so no reader keeps a stale default", () => {
    const doc = knobDoc();
    const missing = structuredClone(doc);
    missing.components.main!.patches.pop!.inputs.bounciness = { link: "$knob.later" };
    const rt = createTestRuntime(missing, registry);
    rt.step();
    expect(rt.issues().find((i) => i.code === "unknown_knob")).toMatchObject({ severity: "warning", patchId: "pop", message: expect.stringContaining('the knob "later"') });
    expect(rt.getValue("pop.bounciness")).toBe(5);
    const added = apply(missing, [{ op: "addKnob", knob: { id: "later", name: "Later", type: "number", value: 9 } }]);
    expect(updateLiterals(compileDocument(missing, registry), added)).toBe(false);
    rt.updateDocument(added);
    rt.step();
    expect(rt.getValue("pop.bounciness")).toBe(9);
    expect(rt.issues().some((i) => i.code === "unknown_knob")).toBe(false);
  });

  it("keeps state across a tune mid-animation, exactly as a recompile would", () => {
    const doc = knobDoc();
    const tuned = apply(doc, [{ op: "setKnobValue", id: "bounce", value: 1 }, { op: "setKnobValue", id: "gap", value: 11 }]);
    // Renaming the project forces the recompile path; state carries over there too.
    const recompiled = apply(tuned, [{ op: "setProject", changes: { name: "Renamed" } }]);
    expect(updateLiterals(compileDocument(doc, registry), recompiled)).toBe(false);
    const inPlace = run(doc, 60, { at: 12, doc: tuned });
    expect(inPlace).toEqual(run(doc, 60, { at: 12, doc: recompiled }));
    // The spring kept its motion: a fresh start from the tuned document reads differently.
    expect(inPlace.slice(12).map((row) => row[0])).not.toEqual(run(tuned, 48).map((row) => row[0]));
  });

  it("reads knobs with getValue and inspect, and replays tunes in traces", () => {
    const doc = knobDoc();
    const rt = createTestRuntime(doc, registry);
    for (let i = 0; i < 5; i++) rt.step();
    expect(rt.getValue("$knob.bounce")).toBe(12);
    expect(rt.getValue("$knob.fade")).toBe(true);
    expect(rt.inspect("$knob.gap")).toEqual({ value: 7 });
    expect(rt.getValue("$knob.nope")).toBeUndefined();
    expect(rt.getValue("logic_1/$knob.gap")).toBeUndefined();
    rt.updateDocument(apply(doc, [{ op: "setKnobValue", id: "bounce", value: 2 }]));
    expect(rt.getValue("$knob.bounce")).toBe(2);
    rt.step();
    const trace = rt.trace(["pop.output", "$knob.bounce"], 200);
    const live: unknown[] = [];
    for (let i = 0; i < trace.times.length; i++) {
      rt.step();
      live.push(rt.getValue("pop.output"));
    }
    expect(trace.values["pop.output"]).toEqual(live);
    expect(new Set(trace.values["$knob.bounce"])).toEqual(new Set([2]));
  });
});

describe("knobs and empty loops", () => {
  it("treat a knob as a constant: a knob that empties a loop is explained, and tuning it back refills it", () => {
    let doc = buildDoc({
      layers: [{ id: "row", type: "rectangle", name: "Row", props: { position: { link: "place.output" } } }],
      patches: { rows: { type: "loop", inputs: { count: 3 } }, place: { type: "transition", typeParam: "point", inputs: { progress: { link: "rows.index" }, end: [0, 80] } } },
    });
    doc = apply(doc, [{ op: "addKnob", knob: { id: "count", name: "Count", type: "number", value: 0 } }, { op: "setInput", target: "rows.count", value: { link: "$knob.count" } }]);
    const rt = createTestRuntime(doc, registry);
    rt.step();
    rt.step();
    expect(rt.inspect("@row.position")).toMatchObject({ copies: 0, note: expect.stringContaining("0 copies") });
    rt.updateDocument(apply(doc, [{ op: "setKnobValue", id: "count", value: 2 }]));
    rt.step();
    rt.step();
    expect(rt.inspect("@row.position").copies).toBe(2);
    expect(rt.issues().some((i) => i.code === "empty_loop")).toBe(false);
  });
});

describe("knob tick cost", () => {
  it("hot-patches a knob about as fast as an ordinary literal edit", { retry: 2 }, () => {
    const patches: Record<string, PatchInput> = { p0: { type: "splitter", inputs: { value: 1 } } };
    for (let i = 1; i < 400; i++) patches[`p${i}`] = { type: "add", inputs: { value1: { link: `p${i - 1}.output` }, value2: 1 } };
    let doc = buildDoc({ patches });
    doc = apply(doc, [{ op: "addKnob", knob: { id: "step", name: "Step", type: "number", value: 1 } }, { op: "setInput", target: "p200.value2", value: { link: "$knob.step" } }]);
    const median = (edit: (i: number) => Op[]) => {
      const rt = createTestRuntime(doc, registry);
      rt.step();
      let current = doc;
      const times: number[] = [];
      for (let i = 0; i < 60; i++) {
        current = apply(current, edit(i));
        const t0 = performance.now();
        rt.updateDocument(current);
        times.push(performance.now() - t0);
        rt.step();
      }
      rt.dispose();
      return times.sort((a, b) => a - b)[30]!;
    };
    const literal = median((i) => [{ op: "setInput", target: "p300.value2", value: 1 + i / 100 }]);
    const knob = median((i) => [{ op: "setKnobValue", id: "step", value: 1 + i / 100 }]);
    expect(knob).toBeLessThan(literal * 3 + 0.05);
  });
});
