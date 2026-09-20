import { describe, expect, it } from "vitest";
import { createDiagnosticsCache, getDiagnostics } from "./diagnostics.ts";
import { applyOps } from "./ops/index.ts";
import { buildSampleDocument, emptyDoc, loopRegistry, mockRegistry, mustApply } from "./testing/fixtures.ts";
import type { LayerNode, Op, SonobeDocument } from "./types.ts";

/** Apply ops leniently (so documents can hold problems) and check the cache against a full pass. */
function step(cache: ReturnType<typeof createDiagnosticsCache>, doc: SonobeDocument, ops: Op[]): SonobeDocument {
  const result = applyOps(doc, ops, { registry: mockRegistry, lenient: true, atomic: false });
  const next = result.doc;
  expect(cache.get(next)).toEqual(getDiagnostics(next, mockRegistry));
  return next;
}

describe("createDiagnosticsCache", () => {
  it("equals getDiagnostics across literal scrubs, moves, structural edits, and component changes", () => {
    const cache = createDiagnosticsCache(mockRegistry);
    let doc = buildSampleDocument();
    expect(cache.get(doc)).toEqual(getDiagnostics(doc, mockRegistry));
    const edits: Op[][] = [
      // literal scrubs on a patch and a layer
      [{ op: "setInput", target: "pop.bounciness", value: 3 }],
      [{ op: "setInput", target: "pop.bounciness", value: "not a number" }],
      [{ op: "setInput", target: "pop.bounciness", value: 9 }],
      [{ op: "setInput", target: "@card.position", value: [10, 20] }],
      [{ op: "setInput", target: "@card.position", value: [11, 21] }],
      // touchability props change another item's warning
      [{ op: "setInput", target: "@card.opacity", value: 0 }],
      [{ op: "setInput", target: "@card.opacity", value: 1 }],
      [{ op: "setInput", target: "@title.hitTest", value: false }],
      [{ op: "setInput", target: "@title.hitTest", value: null }],
      // adding and clearing literals
      [{ op: "setInput", target: "grow.end", value: null }],
      [{ op: "setInput", target: "grow.end", value: 2 }],
      // links and structure
      [{ op: "addPatch", patch: { id: "sum", type: "add", ui: { x: 400, y: 300 } } }],
      [{ op: "connect", from: "pop.output", to: "sum.value1" }],
      [{ op: "setInput", target: "sum.value2", value: 4 }],
      [{ op: "disconnect", to: "sum.value1" }],
      [{ op: "updatePatch", id: "sum", name: "Total" }],
      [{ op: "updatePatch", id: "sum", ui: { x: 20, y: 30 } }],
      [{ op: "removePatch", id: "sum" }],
      // a feedback loop, then moves that change which cable reads last frame
      [
        { op: "addPatch", patch: { id: "a", type: "add", ui: { x: 0, y: 500 } } },
        { op: "addPatch", patch: { id: "b", type: "add", ui: { x: 300, y: 500 } } },
        { op: "connect", from: "a.output", to: "b.value1" },
        { op: "connect", from: "b.output", to: "a.value1" },
      ],
      [{ op: "updatePatch", id: "b", ui: { x: -300, y: 500 } }],
      [{ op: "setInput", target: "a.value2", value: 1 }],
      // layers in and out
      [{ op: "addLayer", layer: { id: "chip", type: "rectangle", name: "Chip", props: { position: [0, 0] } } }],
      [{ op: "setInput", target: "@chip.size", value: [40, 40] }],
      [{ op: "updateLayer", id: "chip", name: "Badge" }],
      [{ op: "removeLayer", id: "chip" }],
    ];
    for (const ops of edits) doc = step(cache, doc, ops);
  });

  it("equals getDiagnostics across knob value edits, preset switches, declaration edits and removals", () => {
    const cache = createDiagnosticsCache(mockRegistry);
    let doc = mustApply(buildSampleDocument(), [
      { op: "addKnobPreset", preset: { name: "Proposal" } },
      { op: "addKnobPreset", preset: { name: "Shipped app" } },
      { op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", value: 8, min: 0, max: 20 } },
      { op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } },
      { op: "addPatch", component: "logic", patch: { id: "spring", type: "popAnimation", inputs: { speed: { link: "$knob.bounce" } } } },
    ]).doc;
    expect(cache.get(doc)).toEqual(getDiagnostics(doc, mockRegistry));
    const edits: Op[][] = [
      [{ op: "setInput", target: "pop.bounciness", value: { link: "$knob.bounce" } }],
      [{ op: "setKnobValue", id: "bounce", value: 30 }],
      [{ op: "applyKnobPreset", id: "shipped_app" }],
      [{ op: "setKnobValue", id: "bounce", value: 3 }],
      [{ op: "updateKnob", id: "bounce", max: 50, name: "Bounciness" }],
      [{ op: "updateKnob", id: "bounce", type: "boolean" }],
      [{ op: "updateKnob", id: "bounce", type: "number" }],
      [{ op: "addKnob", knob: { id: "tint", name: "Tint", type: "color", value: "#FF0000FF" } }],
      [{ op: "setInput", target: "grow.start", value: { link: "$knob.tint" } }],
      [{ op: "updateKnob", id: "tint", type: "text" }],
      [{ op: "removeKnob", id: "tint" }],
      [{ op: "addKnobPreset", preset: { name: "Wild" } }],
      [{ op: "removeKnobPreset", id: "wild" }],
      [{ op: "removeKnob", id: "bounce" }],
    ];
    for (const ops of edits) doc = step(cache, doc, ops);
  });

  it("re-checks copies when a Repeat, a Loop's Count or a loop literal changes", () => {
    const cache = createDiagnosticsCache(loopRegistry);
    const stepWith = (doc: SonobeDocument, ops: Op[]) => {
      const next = applyOps(doc, ops, { registry: loopRegistry, lenient: true, atomic: false }).doc;
      expect(cache.get(next)).toEqual(getDiagnostics(next, loopRegistry));
      return next;
    };
    let doc = stepWith(emptyDoc(), [
      { op: "addLayer", layer: { id: "row", type: "group", name: "Row", props: { repeat: 4 } } },
      { op: "addLayer", parent: "row", layer: { id: "label", type: "text", name: "Label" } },
      { op: "addPatch", patch: { id: "rows", type: "loop", inputs: { count: 4 } } },
      { op: "connect", from: "rows.index", to: "@label.opacity" },
      { op: "addPatch", patch: { id: "sum", type: "add", inputs: { value1: { link: "rows.index" }, value2: { loop: [1, 2, 3, 4] } } } },
    ]);
    const mismatches = () => cache.get(doc).filter((d) => d.code === "loop_length_mismatch").length;
    expect(mismatches()).toBe(0);
    doc = stepWith(doc, [{ op: "setInput", target: "@row.repeat", value: 5 }]);
    expect(mismatches()).toBe(1);
    doc = stepWith(doc, [{ op: "setInput", target: "rows.count", value: 5 }]);
    expect(mismatches()).toBe(1);
    doc = stepWith(doc, [{ op: "setInput", target: "sum.value2", value: { loop: [1, 2, 3, 4, 5] } }]);
    expect(mismatches()).toBe(0);
  });

  it("re-checks components that show a changed component", () => {
    const cache = createDiagnosticsCache(mockRegistry);
    let doc = mustApply(emptyDoc(), [
      { op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent" } },
      { op: "addLayer", layer: { id: "inst", type: "componentInstance", name: "Inst", component: "button", props: {} } },
    ]).doc;
    expect(cache.get(doc)).toEqual(getDiagnostics(doc, mockRegistry));
    doc = step(cache, doc, [{ op: "updateInterface", component: "button", inputs: { label: { key: "label", name: "Label", type: "text" } } }]);
    doc = step(cache, doc, [{ op: "setInput", target: "@inst.label", value: "Go" }]);
    doc = step(cache, doc, [{ op: "setInput", target: "@inst.label", value: 12 }]);
    doc = step(cache, doc, [{ op: "updateInterface", component: "button", inputs: { label: null } }]);
    doc = step(cache, doc, [{ op: "updateComponent", id: "button", name: "Big Button" }]);
    doc = step(cache, doc, [{ op: "updateLayer", id: "inst", component: "nowhere" }]);
  });

  it("follows published ports read inside and outputs read on the host", () => {
    const cache = createDiagnosticsCache(mockRegistry);
    let doc = mustApply(emptyDoc(), [
      { op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } },
      { op: "updateInterface", component: "logic", inputs: { down: { name: "Down", type: "boolean" } }, outputs: { on: { name: "On", type: "boolean" } } },
      { op: "addPatch", component: "logic", patch: { id: "held", type: "switch" } },
      { op: "addPatch", patch: { id: "inst", type: "component", component: "logic" } },
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card", props: { opacity: { link: "inst.on" } } } },
    ]).doc;
    expect(cache.get(doc)).toEqual(getDiagnostics(doc, mockRegistry));
    // unused_input comes and goes as an inner $in link is added and removed.
    doc = step(cache, doc, [{ op: "connect", component: "logic", from: "$in.down", to: "held.turnOn" }]);
    doc = step(cache, doc, [{ op: "disconnect", component: "logic", to: "held.turnOn" }]);
    // undriven_output (on main) follows the output's link inside the component.
    doc = step(cache, doc, [{ op: "connect", component: "logic", from: "held.on", to: "$out.on" }]);
    doc = step(cache, doc, [{ op: "disconnect", component: "logic", to: "$out.on" }]);
    expect(cache.get(doc).map((d) => d.code)).toContain("undriven_output");
  });

  it("follows asset changes, hand-edited files and unrelated documents", () => {
    const cache = createDiagnosticsCache(mockRegistry);
    const base = buildSampleDocument();
    expect(cache.get(base)).toEqual(getDiagnostics(base, mockRegistry));
    const broken: SonobeDocument = structuredClone(base);
    broken.components.main!.patches.pop!.inputs.speed = { link: "nowhere.output" };
    (broken.components.main!.layers[0] as LayerNode).props.color = { asset: "missing_asset" };
    expect(cache.get(broken)).toEqual(getDiagnostics(broken, mockRegistry));
    expect(cache.get(base)).toEqual(getDiagnostics(base, mockRegistry));
    const other = emptyDoc();
    expect(cache.get(other)).toEqual(getDiagnostics(other, mockRegistry));
  });

  it("reuses the diagnostics of items a literal edit didn't touch", () => {
    const cache = createDiagnosticsCache(mockRegistry);
    const doc = mustApply(buildSampleDocument(), [
      { op: "setInput", target: "grow.start", value: "wide" },
      { op: "setInput", target: "pop.speed", value: "fast" },
    ], { lenient: true }).doc;
    const before = cache.get(doc);
    const startIssue = before.find((d) => d.port === "start")!;
    expect(startIssue).toBeDefined();
    const scrubbed = mustApply(doc, [{ op: "setInput", target: "pop.bounciness", value: 2 }]).doc;
    const after = cache.get(scrubbed);
    expect(after).toEqual(getDiagnostics(scrubbed, mockRegistry));
    expect(after.find((d) => d.port === "start")).toBe(startIssue);
    expect(cache.get(scrubbed)).toBe(after);
  });
});

describe("diagnostics scale", () => {
  /** `groups` groups of 8 rectangles and a title, with a rotation link on half the rectangles. */
  function layerDoc(groups: number): SonobeDocument {
    const ops: Op[] = [{ op: "addPatch", patch: { id: "spin", type: "popAnimation", ui: { x: 0, y: 0 } } }];
    for (let g = 0; g < groups; g++) {
      ops.push({ op: "addLayer", layer: { id: `g${g}`, type: "group", name: `Group ${g}`, props: { position: [0, g * 80] } } });
      for (let r = 0; r < 8; r++) {
        ops.push({ op: "addLayer", parent: `g${g}`, layer: { id: `g${g}_r${r}`, type: "rectangle", name: `Rect ${r}`, props: { position: [r * 40, 10], size: [30, 30] } } });
        if (r % 2 === 0) ops.push({ op: "setInput", target: `@g${g}_r${r}.rotation`, value: { link: "spin.output" } });
      }
      ops.push({ op: "addLayer", parent: `g${g}`, layer: { id: `g${g}_t`, type: "text", name: "Title", props: { text: `Row ${g}` } } });
    }
    return mustApply(emptyDoc(), ops).doc;
  }

  const fastest = (doc: SonobeDocument) => {
    let best = Infinity;
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      getDiagnostics(doc, mockRegistry);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };

  it("grows linearly with the number of layers", { retry: 2 }, () => {
    const small = layerDoc(60);
    const large = layerDoc(120);
    fastest(small);
    fastest(large);
    // Linear growth doubles the time; the old findLayer walk per property made it about 4x.
    expect(fastest(large) / fastest(small)).toBeLessThan(3);
  });
});
