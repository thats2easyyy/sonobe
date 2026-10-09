import { applyOps, getDiagnostics, type Op, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { graphDocumentSelector, sameGraph } from "./graphDocument.ts";

const registry = createPatchRegistry();
const demo = createDemoDocument(registry);

function edit(doc: SonobeDocument, ops: Op[]): SonobeDocument {
  const r = applyOps(doc, ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
}

describe("graphDocumentSelector", () => {
  it("keeps the document it has through edits the graph can't show, and takes one it can", () => {
    const select = graphDocumentSelector("main", registry);
    expect(select({ doc: demo })).toBe(demo);
    let doc = demo;
    for (let x = 1; x <= 5; x++) {
      doc = edit(doc, [{ op: "updateLayer", id: "next_card", props: { position: [16 + x, 700] } }]);
      expect(select({ doc })).toBe(demo);
    }
    const connected = edit(doc, [{ op: "setInput", target: "@next_card.opacity", value: { link: "zoom_spring.output" } }]);
    expect(select({ doc: connected })).toBe(connected);
    // From here the document it holds is the connected one, with the moves before it.
    expect(select({ doc: edit(connected, [{ op: "updateLayer", id: "next_card", props: { position: [0, 700] } }]) })).toBe(connected);
  });

  it("takes a document whose literal edit raised a diagnostic, since badges are part of the graph", () => {
    const select = graphDocumentSelector("main", registry);
    select({ doc: demo });
    // The card is what Tap Photo listens to: at opacity 0 it can't be touched, and the patch gets a badge.
    const hidden = edit(demo, [{ op: "updateLayer", id: "card", props: { opacity: 0 } }]);
    expect(getDiagnostics(hidden, registry).length).toBeGreaterThan(getDiagnostics(demo, registry).length);
    expect(select({ doc: hidden })).toBe(hidden);
    expect(sameGraph(demo, hidden, "main", registry)).toBe(false);
    expect(sameGraph(hidden, edit(hidden, [{ op: "updateLayer", id: "card", props: { cornerRadius: 4 } }]), "main", registry)).toBe(true);
  });

  it("keeps one memory per selector", () => {
    const first = graphDocumentSelector("main", registry);
    const second = graphDocumentSelector("main", registry);
    const moved = edit(demo, [{ op: "updateLayer", id: "next_card", props: { position: [20, 700] } }]);
    expect(first({ doc: demo })).toBe(demo);
    expect(second({ doc: moved })).toBe(moved);
    expect(first({ doc: moved })).toBe(demo);
  });
});
