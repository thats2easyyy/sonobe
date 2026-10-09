import { applyOps, getDiagnostics, type Op, type SonobeDocument } from "@sonobe/core";
import { deriveGraph } from "@sonobe/core/graph";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { diagnosticsFor } from "../../../state/registry.ts";
import { graphDocumentSelector, sameGraph } from "./graphDocument.ts";

const registry = createPatchRegistry();
const demo = createDemoDocument(registry);

function edit(doc: SonobeDocument, ops: Op[]): SonobeDocument {
  const r = applyOps(doc, ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
}

/** The graph of "main" as the patch editor derives it: from a document and that document's diagnostics. */
function graph(doc: SonobeDocument) {
  const { nodes, edges } = deriveGraph({ doc, componentId: "main", registry, diagnostics: diagnosticsFor(doc, registry) });
  return { nodes, edges };
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

  it("keeps the document it has when the only diagnostics that changed are ones the graph never draws", () => {
    // A knob nothing reads yet: an info diagnostic on the knob table, made again for every document.
    const withKnob = edit(demo, [{ op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", value: 8 } }]);
    const unused = (doc: SonobeDocument) => getDiagnostics(doc, registry).filter((d) => d.code === "unused_knob");
    expect(unused(withKnob)).toHaveLength(1);
    const select = graphDocumentSelector("main", registry);
    expect(select({ doc: withKnob })).toBe(withKnob);
    let doc = withKnob;
    for (let x = 1; x <= 5; x++) {
      doc = edit(doc, [{ op: "updateLayer", id: "next_card", props: { position: [16 + x, 700] } }]);
      expect(diagnosticsFor(doc, registry).find((d) => d.code === "unused_knob")).not.toBe(diagnosticsFor(withKnob, registry).find((d) => d.code === "unused_knob"));
      expect(select({ doc })).toBe(withKnob);
    }
  });

  it("keeps the document it has when a badge is checked again and says the same", () => {
    const hidden = edit(demo, [
      { op: "updateLayer", id: "card", props: { opacity: 0 } },
      { op: "updateLayer", id: "next_card", props: { opacity: 1 } },
    ]);
    const untouchable =(doc: SonobeDocument) => diagnosticsFor(doc, registry).filter((d) => d.code === "untouchable_layer");
    expect(untouchable(hidden).length).toBeGreaterThan(0);
    const select = graphDocumentSelector("main", registry);
    select({ doc: hidden });
    // Another layer's opacity is scrubbed: every step checks what can be touched again, and the card's badge comes back as a new object.
    let doc = hidden;
    for (const opacity of [0.8, 0.6, 0.4]) {
      doc = edit(doc, [{ op: "updateLayer", id: "next_card", props: { opacity } }]);
      expect(untouchable(doc)).toEqual(untouchable(hidden));
      expect(untouchable(doc)[0]).not.toBe(untouchable(hidden)[0]);
      expect(select({ doc })).toBe(hidden);
      // What it kept draws the same graph, badges included.
      expect(graph(doc)).toEqual(graph(hidden));
    }
    // The card shows again: its badge goes, and the graph with it.
    const shown = edit(doc, [{ op: "updateLayer", id: "card", props: { opacity: 1 } }]);
    expect(select({ doc: shown })).toBe(shown);
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
