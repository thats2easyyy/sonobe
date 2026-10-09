import { applyOps, componentDocument, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { createRuntime } from "@sonobe/engine";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createComponentDocuments } from "./useCanvasScene.ts";

const registry = createPatchRegistry();

function apply(doc: SonobeDocument, ops: Op[]): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const base = apply(createEmptyDocument(), [
  { op: "addLayer", layer: { id: "screen", type: "rectangle", props: { position: [0, 0] } } },
  { op: "addComponent", component: { id: "badge", name: "Badge", kind: "layerComponent", size: [120, 40], layers: [{ id: "dot", type: "oval", name: "Dot", props: { position: [4, 4], size: [12, 12] } }], patches: {} } },
]);
const moveDot = (doc: SonobeDocument, x: number) => apply(doc, [{ op: "updateLayer", component: "badge", id: "dot", props: { position: [x, 4] } }]);

describe("createComponentDocuments", () => {
  it("is the document itself for the root component", () => {
    const of = createComponentDocuments();
    expect(of(base, base.project.root)).toBe(base);
  });

  it("keeps one project object across edits inside a component, so the engine can apply them in place", () => {
    const of = createComponentDocuments();
    const first = of(base, "badge");
    expect(first).toEqual(componentDocument(base, "badge"));
    const moved = moveDot(base, 20);
    const second = of(moved, "badge");
    expect(second.project).toBe(first.project);
    expect(second).toEqual(componentDocument(moved, "badge"));
    expect(of(moveDot(moved, 30), "badge").project).toBe(first.project);
  });

  it("makes a new project when the project, the component's size or the component changes", () => {
    const of = createComponentDocuments();
    const first = of(base, "badge");
    const renamed = apply(base, [{ op: "setProject", changes: { name: "Renamed" } }]);
    expect(of(renamed, "badge").project).not.toBe(first.project);
    expect(of(renamed, "badge").project.name).toBe("Renamed");
    const resized = apply(renamed, [{ op: "updateComponent", id: "badge", size: [200, 40] }]);
    expect(of(resized, "badge").project.device.size).toEqual([200, 40]);
    const other = apply(resized, [{ op: "addComponent", component: { id: "chip", name: "Chip", kind: "layerComponent", size: [200, 40], layers: [], patches: {} } }]);
    expect(of(other, "chip").project.root).toBe("chip");
  });

  it("draws the same frame 0 as a new runtime does after an edit applied in place", () => {
    const of = createComponentDocuments();
    const runtime = createRuntime(of(base, "badge"), { registry, deterministic: true, platform: {} });
    runtime.step();
    const moved = moveDot(base, 50);
    runtime.updateDocument(of(moved, "badge"));
    runtime.restart();
    const fresh = createRuntime(componentDocument(moved, "badge"), { registry, deterministic: true, platform: {} });
    expect(runtime.step()).toEqual(fresh.step());
    runtime.dispose();
    fresh.dispose();
  });
});
