import { describe, expect, it } from "vitest";
import { getDiagnostics } from "../diagnostics.ts";
import { emptyDoc, mockRegistry, mustApply } from "../testing/fixtures.ts";
import { applyOps } from "./index.ts";

const withPatchComponent = () => mustApply(emptyDoc(), [{ op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } }]).doc;

describe("layers in patch components", () => {
  it("refuses a layer in a patch component, with a hint, except when replaying history", () => {
    const doc = withPatchComponent();
    const refused = applyOps(doc, [{ op: "addLayer", component: "logic", layer: { type: "rectangle" } }], { registry: mockRegistry });
    expect(refused.ok).toBe(false);
    expect(refused.errors[0]).toMatchObject({ code: "wrong_component_kind", message: '"Logic" is a patch component, which holds only patches, so a layer there would never be drawn.' });
    expect(refused.errors[0]!.hint).toContain("Create Component");
    expect(applyOps(doc, [{ op: "addLayer", component: "logic", layer: { type: "rectangle" } }], { registry: mockRegistry, lenient: true }).ok).toBe(true);
    // Layers still go into prototypes and layer components.
    expect(applyOps(doc, [{ op: "addLayer", layer: { type: "rectangle" } }], { registry: mockRegistry }).ok).toBe(true);

    const created = applyOps(emptyDoc(), [{ op: "addComponent", component: { name: "Logic", kind: "patchComponent", layers: [{ id: "a", type: "rectangle", name: "A", props: {} }] } }], { registry: mockRegistry });
    expect(created.errors[0]?.code).toBe("wrong_component_kind");
  });

  it("warns about layers a file already holds, with a fix that removes them", () => {
    const hand = structuredClone(withPatchComponent());
    hand.components.logic!.layers.push({ id: "box", type: "rectangle", name: "Box", props: {} });
    const warning = getDiagnostics(hand, mockRegistry).find((d) => d.code === "layers_in_patch_component")!;
    expect(warning).toMatchObject({ severity: "warning", component: "logic", itemIds: ["box"] });
    expect(warning.message).toBe('"Logic" is a patch component, and patch components are never drawn, so the layer "Box" won\'t show.');
    const fixed = mustApply(hand, warning.suggestions![0]!.ops!);
    expect(getDiagnostics(fixed.doc, mockRegistry).some((d) => d.code === "layers_in_patch_component")).toBe(false);
  });
});
