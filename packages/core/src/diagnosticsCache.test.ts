import { describe, expect, it } from "vitest";
import { createDiagnosticsCache, getDiagnostics } from "./diagnostics.ts";
import { applyOps } from "./ops/index.ts";
import { buildSampleDocument, emptyDoc, mockRegistry, mustApply } from "./testing/fixtures.ts";
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
