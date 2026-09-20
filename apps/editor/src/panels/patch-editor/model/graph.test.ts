// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, getDiagnostics, type Op, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { deriveGraph, type CableEdge, type LayerGraphNode, type PatchGraphNode } from "@sonobe/core/graph";
import { reconcileNodes } from "./reconcile.ts";

const registry = createPatchRegistry();

function build(ops: Op[]): SonobeDocument {
  const r = applyOps(createEmptyDocument(), ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
}

const patchNode = (model: ReturnType<typeof deriveGraph>, id: string) => model.nodes.find((n): n is PatchGraphNode => n.id === id && n.type === "patch")!;
const cable = (model: ReturnType<typeof deriveGraph>, to: string) => model.edges.find((e): e is CableEdge => e.data?.to === to)!;

describe("deriveGraph", () => {
  const doc = createDemoDocument(registry);
  const model = deriveGraph({ doc, componentId: "main", registry, diagnostics: getDiagnostics(doc, registry) });

  it("turns patches, driven layers, and comments into nodes", () => {
    expect(model.nodes.filter((n) => n.type === "patch")).toHaveLength(10);
    expect(model.nodes.filter((n) => n.type === "layer").map((n) => n.id).sort()).toEqual(["@card", "@heart", "@photo"]);
    expect(model.nodes.filter((n) => n.type === "comment").map((n) => n.id).sort()).toEqual(["comment:like_note", "comment:zoom_note"]);
    const comment = model.nodes.find((n) => n.id === "comment:zoom_note")!;
    expect([comment.position.x, comment.position.y, comment.width, comment.height]).toEqual([20, 0, 940, 290]);
    expect(comment.zIndex).toBe(-1);
  });

  it("describes a patch: title, category, variant, ports with literals and connection state", () => {
    const spring = patchNode(model, "zoom_spring");
    expect(spring.position).toEqual({ x: 480, y: 60 });
    expect(spring.data.title).toBe("Zoom Spring");
    expect(spring.data.specName).toBe("Pop Animation");
    expect(spring.data.customName).toBe(true);
    expect(spring.data.category).toBe("animation");
    expect(spring.data.typeParam).toBe("number");
    const number = spring.data.inputs.find((p) => p.key === "number")!;
    expect(number).toMatchObject({ connected: true, link: "zoomed.on", handleId: "in:number", address: "zoom_spring.number", type: "number" });
    expect(spring.data.inputs.find((p) => p.key === "bounciness")).toMatchObject({ connected: false, literal: 6, defaultValue: 5 });
    expect(spring.data.outputs.find((p) => p.key === "output")).toMatchObject({ connected: true, handleId: "out:output" });

    const tap = patchNode(model, "tap_photo");
    expect(tap.data.layerRef).toBe("card");
    expect(tap.data.outputs.find((p) => p.key === "down")?.connected).toBe(false);
    expect(tap.data.outputs.find((p) => p.key === "tap")?.type).toBe("pulse");
  });

  it("builds cables with source types, conversions, and layer targets", () => {
    expect(model.edges).toHaveLength(12);
    const flip = cable(model, "zoomed.flip");
    expect(flip).toMatchObject({ id: "cable:zoomed.flip", source: "tap_photo", sourceHandle: "out:tap", target: "zoomed", targetHandle: "in:flip" });
    expect(flip.data).toMatchObject({ sourceType: "pulse", targetType: "pulse", loop: false });
    expect(cable(model, "zoom_spring.number").data?.conversion).toBe("on = 1, off = 0");
    const scale = cable(model, "@photo.scale");
    expect(scale).toMatchObject({ source: "photo_scale", target: "@photo", targetHandle: "in:scale" });
    const heart = model.nodes.find((n): n is LayerGraphNode => n.id === "@heart")!;
    // Ordered by driver position (Heart Color sits above Heart Scale), so the cables don't cross.
    expect(heart.data.inputs.map((p) => p.key)).toEqual(["textColor", "scale"]);
    expect(heart.data.title).toBe("Heart");
    expect(model.cablesBySource.get("zoom_spring.output")).toEqual(["cable:photo_scale.progress", "cable:card_shadow.progress"]);
    expect(model.outputAddresses).toContain("tap_photo.tap");
  });

  it("places layer targets to the right of their drivers without overlapping", () => {
    const photo = model.nodes.find((n) => n.id === "@photo")!;
    const card = model.nodes.find((n) => n.id === "@card")!;
    expect(photo.position.x).toBeGreaterThan(720);
    expect(card.position.x).toBeGreaterThan(720);
    expect(Math.abs(photo.position.y - card.position.y)).toBeGreaterThan(20);
  });

  it("shows properties someone asked to drive as open inputs, after the driven ones", () => {
    const m = deriveGraph({ doc, componentId: "main", registry, pendingTargets: ["@photo.opacity", "@photo.scale", "@sun.rotation", "@missing.scale", "@photo.nope"] });
    const photo = m.nodes.find((n): n is LayerGraphNode => n.id === "@photo")!;
    expect(photo.data.inputs.map((p) => [p.key, p.connected])).toEqual([
      ["scale", true],
      ["opacity", false],
    ]);
    const sun = m.nodes.find((n): n is LayerGraphNode => n.id === "@sun")!;
    expect(sun.data.inputs.map((p) => p.key)).toEqual(["rotation"]);
    expect(sun.position.x).toBeGreaterThan(900);
    expect(m.ports.get("in|@sun.rotation")?.connected).toBe(false);
    expect(m.nodes.some((n) => n.id === "@missing")).toBe(false);
  });

  it("uses session positions for layer targets when given", () => {
    const moved = deriveGraph({ doc, componentId: "main", registry, positions: { "@photo": { x: 5, y: 6 } } });
    expect(moved.nodes.find((n) => n.id === "@photo")!.position).toEqual({ x: 5, y: 6 });
  });

  it("keeps node and edge identity when nothing changed, and only replaces what did", () => {
    const again = deriveGraph({ doc, componentId: "main", registry, diagnostics: getDiagnostics(doc, registry), previous: model });
    expect(again.nodes.every((n, i) => n === model.nodes[i])).toBe(true);
    expect(again.edges.every((e, i) => e === model.edges[i])).toBe(true);
    const moved = applyOps(doc, [{ op: "updatePatch", id: "liked", ui: { x: 300 } }], { registry }).doc;
    const next = deriveGraph({ doc: moved, componentId: "main", registry, diagnostics: getDiagnostics(moved, registry), previous: model });
    const changed = next.nodes.filter((n, i) => n !== model.nodes[i]).map((n) => n.id);
    expect(changed).toContain("liked");
    expect(changed).not.toContain("zoom_spring");
    expect(next.nodes.find((n) => n.id === "zoom_spring")).toBe(model.nodes.find((n) => n.id === "zoom_spring"));
  });

  it("marks looped patches and knows literal loop lengths", () => {
    const loopDoc = build([
      { op: "addPatch", patch: { id: "count", type: "loop", inputs: { count: 5 }, ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "times", type: "multiply", typeParam: "number", ui: { x: 220, y: 0 } } },
      { op: "addPatch", patch: { id: "plain", type: "multiply", typeParam: "number", inputs: { value1: { loop: [1, 2, 3] } }, ui: { x: 220, y: 200 } } },
      { op: "connect", from: "count.index", to: "times.value1" },
    ]);
    const m = deriveGraph({ doc: loopDoc, componentId: "main", registry });
    expect(patchNode(m, "count").data.loopLength).toBe(5);
    expect(patchNode(m, "times").data).toMatchObject({ looped: true, loopLength: 5 });
    expect(patchNode(m, "plain").data).toMatchObject({ looped: true, loopLength: 3 });
    expect(cable(m, "times.value1").data?.loop).toBe(true);
    expect(patchNode(m, "times").data.outputs[0]?.loop).toBe(true);
  });

  it("attaches diagnostics to nodes, ports, and invalid cables", () => {
    const base = build([
      { op: "addPatch", patch: { id: "tap", type: "interaction", ui: { x: 0, y: 0 } } },
      { op: "addPatch", patch: { id: "fade", type: "transition", typeParam: "color", ui: { x: 240, y: 0 } } },
    ]);
    // Documents can arrive with invalid links (hand-edited files); diagnostics explain them.
    const broken: SonobeDocument = structuredClone(base);
    broken.components.main!.patches.fade!.inputs.start = { link: "tap.tap" };
    const m = deriveGraph({ doc: broken, componentId: "main", registry, diagnostics: getDiagnostics(broken, registry) });
    const fade = patchNode(m, "fade");
    expect(fade.data.issues.some((i) => i.severity === "error" && i.port === "start")).toBe(true);
    expect(fade.data.inputs.find((p) => p.key === "start")?.issue?.severity).toBe("error");
    const c = cable(m, "fade.start");
    expect(c.data?.invalid).toBeTruthy();
    expect(c.data?.suggestions?.length).toBeGreaterThan(0);
  });

  it("shows published component ports as interface nodes", () => {
    const withComponent = build([
      { op: "addComponent", ref: "button", component: { id: "button", name: "Button", kind: "patchComponent" } },
      { op: "updateInterface", component: "button", inputs: { pressed: { key: "pressed", name: "Pressed", type: "boolean" } }, outputs: { amount: { key: "amount", name: "Amount", type: "number" } } },
      { op: "addPatch", component: "button", patch: { id: "spring", type: "popAnimation", ui: { x: 0, y: 0 } } },
      { op: "connect", component: "button", from: "$in.pressed", to: "spring.number" },
      { op: "updateInterface", component: "button", outputs: { amount: { key: "amount", name: "Amount", type: "number", link: "spring.output" } } },
    ]);
    const m = deriveGraph({ doc: withComponent, componentId: "button", registry });
    const ins = m.nodes.find((n) => n.id === "$in")!;
    const outs = m.nodes.find((n) => n.id === "$out")!;
    expect(ins.position.x).toBeLessThan(0);
    expect(outs.position.x).toBeGreaterThan(0);
    expect(cable(m, "spring.number")).toMatchObject({ source: "$in", sourceHandle: "out:pressed" });
    expect(cable(m, "$out.amount")).toMatchObject({ source: "spring", target: "$out", targetHandle: "in:amount" });
  });
});

describe("reconcileNodes", () => {
  const doc = createDemoDocument(registry);
  const model = deriveGraph({ doc, componentId: "main", registry });

  it("applies selection, keeps measured sizes, and returns the same array when nothing changed", () => {
    const first = reconcileNodes([], model.nodes, { selected: new Set(["zoomed"]), dragging: new Set() });
    expect(first.find((n) => n.id === "zoomed")?.selected).toBe(true);
    const measured = first.map((n) => (n.id === "zoomed" ? { ...n, measured: { width: 180, height: 100 } } : n));
    const second = reconcileNodes(measured, model.nodes, { selected: new Set(["zoomed"]), dragging: new Set() });
    expect(second).toBe(measured);
    const deselected = reconcileNodes(measured, model.nodes, { selected: new Set(), dragging: new Set() });
    const zoomed = deselected.find((n) => n.id === "zoomed")!;
    expect(zoomed.selected).toBe(false);
    expect(zoomed.measured).toEqual({ width: 180, height: 100 });
  });

  it("keeps the local position of a node being dragged", () => {
    const local = reconcileNodes([], model.nodes, { selected: new Set(), dragging: new Set() }).map((n) => (n.id === "liked" ? { ...n, position: { x: 999, y: 999 } } : n));
    const next = reconcileNodes(local, model.nodes, { selected: new Set(), dragging: new Set(["liked"]) });
    expect(next.find((n) => n.id === "liked")!.position).toEqual({ x: 999, y: 999 });
    const dropped = reconcileNodes(local, model.nodes, { selected: new Set(), dragging: new Set() });
    expect(dropped.find((n) => n.id === "liked")!.position).toEqual({ x: 260, y: 380 });
  });
});
