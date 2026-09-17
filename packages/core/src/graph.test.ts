import { describe, expect, it } from "vitest";
import { feedbackEdges, feedbackLoops, patchEdges } from "./graph.ts";
import { createRegistry } from "./registry.ts";
import { emptyDoc, MOCK_PATCH_SPECS, mockRegistry, mustApply, port } from "./testing/fixtures.ts";
import type { Op, PatchSpec, SonobeDocument } from "./types.ts";

/** Patches placed at x positions, then cables written "from>to". */
function graph(patches: Record<string, [type: string, x: number]>, cables: string[]): SonobeDocument {
  const ops: Op[] = Object.entries(patches).map(([id, [type, x]]): Op => ({ op: "addPatch", patch: { id, type, ui: { x, y: 0 } } }));
  for (const cable of cables) {
    const [from, to] = cable.split(">") as [string, string];
    ops.push({ op: "connect", from, to });
  }
  return mustApply(emptyDoc(), ops).doc;
}

const summary = (doc: SonobeDocument) => feedbackEdges(doc, "main", mockRegistry).map((e) => `${e.from}>${e.to}:${e.reason}`);

describe("patchEdges", () => {
  it("lists real cables between patches in edge order", () => {
    const doc = graph({ a: ["transition", 0], b: ["transition", 200], c: ["logger", 400] }, ["a.output>b.progress", "b.output>c.value", "a.output>b.start"]);
    expect(patchEdges(doc, "main", mockRegistry)[0]).toEqual({ from: "a.output", to: "b.progress", sourceId: "a", sourceKey: "output", targetId: "b", targetKey: "progress" });
    const broken = structuredClone(doc);
    broken.components.main!.patches.a!.inputs = { progress: { link: "a.output" }, start: { link: "ghost.output" }, end: { link: "b.nope" } };
    expect(patchEdges(broken, "main", mockRegistry).map((e) => `${e.from}>${e.to}`)).toEqual(["a.output>b.progress", "a.output>b.start", "b.output>c.value"]);
    expect(patchEdges(doc, "nope", mockRegistry)).toEqual([]);
  });
});

describe("feedbackEdges", () => {
  it("picks the cable that runs right to left", () => {
    const doc = graph({ a: ["transition", 0], b: ["transition", 200], c: ["transition", 400] }, ["a.output>b.progress", "b.output>c.progress", "c.output>a.progress"]);
    expect(summary(doc)).toEqual(["c.output>a.progress:backwards"]);
  });

  it("prefers a cable into Delay One Frame wherever it sits", () => {
    const doc = graph({ a: ["transition", 0], d: ["delay1", 300], b: ["transition", 100] }, ["a.output>d.value", "d.output>b.progress", "b.output>a.progress"]);
    expect(summary(doc)).toEqual(["a.output>d.value:delay1"]);
  });

  it("breaks ties by target id, and falls back to it without positions", () => {
    const doc = graph({ b: ["transition", 0], a: ["transition", 0] }, ["a.output>b.progress", "b.output>a.progress"]);
    expect(summary(doc)).toEqual(["b.output>a.progress:backwards"]);
    const unplaced = structuredClone(doc);
    for (const p of Object.values(unplaced.components.main!.patches)) p.ui.x = Number.NaN;
    expect(summary(unplaced)).toEqual(["b.output>a.progress:id"]);
  });

  it("gives up one cable per loop, then checks what's left", () => {
    const doc = graph({ a: ["transition", 0], b: ["transition", 100], c: ["transition", 200] }, ["a.output>b.progress", "b.output>a.progress", "b.output>c.progress", "c.output>b.start"]);
    expect(summary(doc)).toEqual(["b.output>a.progress:backwards", "c.output>b.start:backwards"]);
    const loops = feedbackLoops(doc, "main", mockRegistry);
    expect(loops.map((l) => l.patchIds)).toEqual([["a", "b", "c"]]);
    expect(loops[0]!.feedback.map((e) => e.to)).toEqual(["a.progress", "b.start"]);
  });

  it("reports separate loops separately and nothing for acyclic graphs", () => {
    const doc = graph(
      { a: ["transition", 0], b: ["transition", 100], x: ["transition", 0], y: ["transition", 100], z: ["logger", 300] },
      ["a.output>b.progress", "b.output>a.progress", "x.output>y.progress", "y.output>x.progress", "y.output>z.value"],
    );
    expect(feedbackLoops(doc, "main", mockRegistry).map((l) => l.patchIds)).toEqual([["a", "b"], ["x", "y"]]);
    expect(summary(doc)).toEqual(["b.output>a.progress:backwards", "y.output>x.progress:backwards"]);
    expect(summary(graph({ a: ["transition", 400], b: ["transition", 0] }, ["a.output>b.progress"]))).toEqual([]);
  });
});

describe("implicit edges (the engine's dependencies without a cable)", () => {
  const variableSettings: PatchSpec["settings"] = [
    { key: "name", name: "Name", type: "text", default: "", description: "The variable's name." },
    { key: "scope", name: "Scope", type: "enum", default: "local", enumOptions: [{ key: "local", name: "Local" }, { key: "global", name: "Global" }], description: "Where it reaches." },
  ];
  const registry = createRegistry([
    ...MOCK_PATCH_SPECS,
    { type: "variableBroadcaster", name: "Variable Broadcaster", category: "utility", summary: "Sends a value.", variants: ["number", "text"], settings: variableSettings, inputs: [port("value", "variant", { default: 0 })], outputs: [] },
    { type: "variableReceiver", name: "Variable Receiver", category: "utility", summary: "Receives a value.", variants: ["number", "text"], settings: variableSettings, inputs: [], outputs: [port("output", "variant")] },
  ]);
  const edgeSummary = (doc: SonobeDocument) => patchEdges(doc, "main", registry).map((e) => `${e.from}>${e.to} (${e.sourceId}.${e.sourceKey}${e.via ? `, ${e.via.kind}` : ""})`);

  it("follows reads through layer properties, over any number of hops, to the patch that drives them", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
      { op: "addLayer", layer: { id: "shadow", type: "rectangle", name: "Shadow" } },
      { op: "addPatch", patch: { id: "a", type: "transition", ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "b", type: "transition", ui: { x: 200, y: 0 } } },
      { op: "connect", from: "a.output", to: "b.progress" },
      { op: "setInput", target: "@card.opacity", value: { link: "b.output" } },
      { op: "setInput", target: "@shadow.opacity", value: { link: "@card.opacity" } },
      { op: "setInput", target: "a.progress", value: { link: "@shadow.opacity" } },
    ]).doc;
    expect(edgeSummary(doc)).toEqual(["@shadow.opacity>a.progress (b.output, layerProp)", "a.output>b.progress (a.output)"]);
    expect(patchEdges(doc, "main", registry)[0]!.via).toEqual({ kind: "layerProp", address: "@shadow.opacity" });
    expect(feedbackLoops(doc, "main", registry).map((l) => [l.patchIds, l.feedback.map((e) => `${e.from}>${e.to}:${e.reason}`)])).toEqual([[["a", "b"], ["@shadow.opacity>a.progress:backwards"]]]);

    // Literal props and property links that only reach each other lead to no patch.
    const noDriver = structuredClone(doc);
    noDriver.components.main!.layers[0]!.props.opacity = { link: "@shadow.opacity" };
    expect(edgeSummary(noDriver)).toEqual(["a.output>b.progress (a.output)"]);
    const literal = structuredClone(doc);
    literal.components.main!.layers[0]!.props.opacity = 0.5;
    expect(feedbackLoops(literal, "main", registry)).toEqual([]);
  });

  it("links a Variable Receiver to whatever drives its broadcaster, and names the receiver when that read lags", () => {
    const doc = mustApply(
      emptyDoc(),
      [
        { op: "addPatch", patch: { id: "acc", type: "transition", ui: { x: 300, y: 0 } } },
        { op: "addPatch", patch: { id: "send", type: "variableBroadcaster", settings: { name: " total " }, ui: { x: 500, y: 0 } } },
        { op: "addPatch", patch: { id: "other", type: "variableBroadcaster", settings: { name: "total" }, typeParam: "text", ui: { x: 500, y: 200 } } },
        { op: "addPatch", patch: { id: "r", type: "variableReceiver", settings: { name: "total" }, ui: { x: 0, y: 0 } } },
        { op: "connect", from: "acc.output", to: "send.value" },
        { op: "connect", from: "r.output", to: "acc.progress" },
      ],
      { registry },
    ).doc;
    expect(edgeSummary(doc)).toEqual(["r.output>acc.progress (r.output)", "acc.output>r.name (acc.output, variable)", "acc.output>send.value (acc.output)"]);
    expect(feedbackEdges(doc, "main", registry).map((e) => ({ to: e.to, reason: e.reason, via: e.via }))).toEqual([{ to: "r.name", reason: "backwards", via: { kind: "variable", name: "total", broadcasterId: "send" } }]);

    const muted = structuredClone(doc);
    muted.components.main!.patches.send!.muted = true;
    expect(feedbackLoops(muted, "main", registry)).toEqual([]);
    const global = structuredClone(doc);
    global.components.main!.patches.r!.settings = { name: "total", scope: "global" };
    expect(feedbackLoops(global, "main", registry)).toEqual([]);
  });
});
