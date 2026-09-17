import { describe, expect, it } from "vitest";
import { buildSampleDocument, emptyDoc, expectRoundTrip, mockRegistry, mustApply, SAMPLE_OPS } from "../testing/fixtures.ts";
import type { Op, SonobeDocument } from "../types.ts";
import { applyOps, type ApplyOpsOptions } from "./index.ts";

const apply = (doc: SonobeDocument, ops: Op[], extra: Partial<ApplyOpsOptions> = {}) => applyOps(doc, ops, { registry: mockRegistry, ...extra });

describe("applyOps", () => {
  it("rolls back atomically", () => {
    const doc = emptyDoc();
    const r = apply(doc, [
      { op: "addLayer", layer: { type: "rectangle", name: "Card" } },
      { op: "addPatch", patch: { type: "popAnimaton" } },
      { op: "addLayer", layer: { type: "oval" } },
    ]);
    expect(r.ok).toBe(false);
    expect(r.doc).toBe(doc);
    expect(r.results.map((x) => [x.ok, x.error?.code])).toEqual([[true, undefined], [false, "unknown_patch_type"], [false, "skipped"]]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.opIndex).toBe(1);
    expect(r).toMatchObject({ inverse: [], idMap: {}, applied: [], affected: { components: [], layers: [], patches: [] } });
  });

  it("applies what it can when not atomic", () => {
    const r = apply(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle" } }, { op: "removeLayer", id: "nope" }, { op: "addLayer", layer: { type: "oval" } }], { atomic: false });
    expect(r.ok).toBe(false);
    expect(r.doc.components.main!.layers.map((l) => l.id)).toEqual(["rectangle", "oval"]);
    expect(r.results.map((x) => x.ok)).toEqual([true, false, true]);
    expect(r.inverse).toEqual([
      { op: "removeLayer", component: "main", id: "oval" },
      { op: "removeLayer", component: "main", id: "rectangle" },
    ]);
  });

  it("dry runs without changing the document", () => {
    const doc = emptyDoc();
    const r = apply(doc, [{ op: "addLayer", layer: { type: "rectangle" } }], { dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.doc).toBe(doc);
    expect(r.preview!.components.main!.layers).toHaveLength(1);
    expect(r.inverse).toEqual([{ op: "removeLayer", component: "main", id: "rectangle" }]);
  });

  it("resolves refs in ids, parents, addresses, layer references and components", () => {
    const r = mustApply(emptyDoc(), [
      { op: "addComponent", ref: "chip", component: { name: "Chip", kind: "layerComponent" } },
      { op: "addLayer", component: "$chip", layer: { ref: "bg", type: "rectangle", name: "Background" } },
      { op: "addPatch", component: "$chip", patch: { ref: "tap", type: "interaction", inputs: { layer: { layer: "$bg" } } } },
      { op: "addPatch", component: "$chip", patch: { ref: "$toggle", type: "switch" } },
      { op: "connect", component: "$chip", from: "$tap.tap", to: "$toggle.flip" },
      { op: "setInput", component: "$chip", target: "@$bg.opacity", value: { link: "$toggle.on" } },
      { op: "updateLayer", component: "$chip", id: "$bg", name: "BG" },
    ]);
    expect(r.idMap).toEqual({ chip: "chip", bg: "background", tap: "interaction", $toggle: "switch" });
    const chip = r.doc.components.chip!;
    expect(chip.patches.switch!.inputs.flip).toEqual({ link: "interaction.tap" });
    expect(chip.layers[0]).toMatchObject({ id: "background", name: "BG", props: { opacity: { link: "switch.on" } } });
    expect(r.applied[4]).toEqual({ op: "connect", component: "chip", from: "interaction.tap", to: "switch.flip" });
  });

  it("explains unknown and duplicate refs", () => {
    const e = apply(emptyDoc(), [{ op: "addLayer", layer: { ref: "card", type: "rectangle" } }, { op: "setInput", target: "@$crad.opacity", value: 1 }]).errors[0]!;
    expect(e.code).toBe("unknown_ref");
    expect(e.message).toContain('"$card"');
    expect(apply(emptyDoc(), [{ op: "addLayer", layer: { ref: "a", type: "rectangle" } }, { op: "addLayer", layer: { ref: "$a", type: "oval" } }]).errors[0]!.code).toBe("duplicate_ref");
    expect(apply(emptyDoc(), [{ op: "addLayer", layer: { ref: "in", type: "oval" } }]).errors[0]!.code).toBe("invalid_ref");
  });

  it("suggests op names", () => {
    const e = apply(emptyDoc(), [{ op: "addLayr" } as never]).errors[0]!;
    expect(e.code).toBe("unknown_op");
    expect(e.message).toContain('"addLayer"');
  });

  it("shares structure with the previous document", () => {
    const doc = mustApply(buildSampleDocument(), [{ op: "addComponent", component: { name: "Other", kind: "patchComponent" } }]).doc;
    const r = mustApply(doc, [{ op: "setInput", target: "pop.speed", value: 12 }]);
    expect(r.doc.project).toBe(doc.project);
    expect(r.doc.components.other).toBe(doc.components.other);
    expect(r.doc.components.main!.layers).toBe(doc.components.main!.layers);
    expect(r.doc.components.main!.patches.grow).toBe(doc.components.main!.patches.grow);
    expect(r.doc.components.main!.patches.pop).not.toBe(doc.components.main!.patches.pop);
    const r2 = mustApply(doc, [{ op: "updateLayer", id: "title", name: "Heading" }]);
    expect(r2.doc.components.main!.patches).toBe(doc.components.main!.patches);
    expect(doc.components.main!.layers[0]!.children![0]!.name).toBe("Title");
  });

  it("honors reserved ids and lenient mode", () => {
    expect(mustApply(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle", name: "Card" } }], { reservedIds: ["card"] }).results[0]!.ids).toEqual(["card_2"]);
    const lenient = apply(emptyDoc(), [{ op: "addPatch", patch: { type: "pluginThing", inputs: { anything: { json: 1 } } } }, { op: "addLayer", layer: { type: "hologram", props: { glow: 1 } } }], { lenient: true });
    expect(lenient.ok).toBe(true);
  });

  it("requires a registry and a list of ops", () => {
    expect(() => applyOps(emptyDoc(), [], {} as never)).toThrow(TypeError);
    expect(apply(emptyDoc(), "nope" as never).errors[0]!.code).toBe("invalid_op");
    expect(apply(emptyDoc(), [null as never]).errors[0]!.code).toBe("unknown_op");
  });

  it("undoes a multi-op batch in reverse order", () => {
    const doc = emptyDoc();
    expectRoundTrip(doc, mustApply(doc, SAMPLE_OPS));
  });
});
