import { describe, expect, it } from "vitest";
import { feedbackEdges, feedbackLoops, patchEdges } from "./graph.ts";
import { emptyDoc, mockRegistry, mustApply } from "./testing/fixtures.ts";
import type { Op, SonobeDocument } from "./types.ts";

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
