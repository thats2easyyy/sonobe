// @vitest-environment happy-dom
import { applyOps, canConnect } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { checkConnection, orientConnection, placeSuggestion, portTypeAt, quickConnectCheck } from "./connect.ts";
import { deriveGraph } from "@sonobe/core/graph";
import { linkSearchItems, searchLinkItems } from "./linkSearch.ts";

const registry = createPatchRegistry();
const doc = createDemoDocument(registry);
const model = deriveGraph({ doc, componentId: "main", registry });

describe("orientConnection", () => {
  it("turns either drag direction into output → input", () => {
    const forward = orientConnection({ nodeId: "zoomed", handleId: "out:on" }, { nodeId: "like_spring", handleId: "in:number" });
    const backward = orientConnection({ nodeId: "like_spring", handleId: "in:number" }, { nodeId: "zoomed", handleId: "out:on" });
    expect(forward).toMatchObject({ from: "zoomed.on", to: "like_spring.number" });
    expect(backward).toMatchObject({ from: "zoomed.on", to: "like_spring.number" });
    expect(orientConnection({ nodeId: "@photo", handleId: "in:scale" }, { nodeId: "zoom_spring", handleId: "out:output" })?.to).toBe("@photo.scale");
  });

  it("rejects output → output and input → input", () => {
    expect(orientConnection({ nodeId: "a", handleId: "out:x" }, { nodeId: "b", handleId: "out:y" })).toBeUndefined();
    expect(orientConnection({ nodeId: "a", handleId: "in:x" }, { nodeId: "b", handleId: "in:y" })).toBeUndefined();
  });
});

describe("quickConnectCheck", () => {
  it("accepts compatible types and reports the conversion", () => {
    const r = quickConnectCheck(model, { nodeId: "liked", handleId: "out:on" }, { nodeId: "zoom_spring", handleId: "in:bounciness" });
    expect(r.ok).toBe(true);
    expect(r.conversion).toBe("on = 1, off = 0");
  });

  it("rejects a patch feeding itself and incompatible types", () => {
    expect(quickConnectCheck(model, { nodeId: "zoom_spring", handleId: "out:output" }, { nodeId: "zoom_spring", handleId: "in:speed" }).ok).toBe(false);
    const r = quickConnectCheck(model, { nodeId: "tap_photo", handleId: "out:tap" }, { nodeId: "heart_color", handleId: "in:start" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/pulse/);
  });
});

describe("checkConnection", () => {
  it("passes a valid link through a dry run", () => {
    const r = checkConnection(doc, "main", registry, "liked.on", "zoom_spring.speed");
    expect(r).toMatchObject({ ok: true, conversion: "on = 1, off = 0", suggestions: [] });
    expect(doc.components.main!.patches.zoom_spring!.inputs.speed).toBe(12);
  });

  it("explains a type mismatch and suggests a converter that applies", () => {
    const r = checkConnection(doc, "main", registry, "tap_photo.tap", "heart_color.start");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("type_mismatch");
    expect(r.suggestions.length).toBeGreaterThan(0);
    const ops = placeSuggestion(r.suggestions[0]!, "main", { x: 400, y: 300 });
    const added = ops.find((op) => op.op === "addPatch");
    expect(added && added.op === "addPatch" && added.patch.ui).toEqual({ x: 400, y: 300 });
    const applied = applyOps(doc, ops, { registry });
    expect(applied.ok).toBe(true);
  });

  it("rejects self edges with a Delay 1 hint", () => {
    const r = checkConnection(doc, "main", registry, "zoom_spring.output", "zoom_spring.number");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("self_edge");
  });

  it("resolves port types for outputs and layer properties", () => {
    expect(portTypeAt(doc, "main", registry, "tap_photo.tap", "out")).toBe("pulse");
    expect(portTypeAt(doc, "main", registry, "@heart.textColor", "in")).toBe("color");
    expect(portTypeAt(doc, "main", registry, "@nothing.scale", "in")).toBeUndefined();
  });
});

describe("link-drag search", () => {
  it("offers only ports that accept the dragged output", () => {
    const items = linkSearchItems(doc, registry, { side: "out", type: "pulse", patchType: "interaction" });
    expect(items.length).toBeGreaterThan(10);
    for (const item of items) expect(canConnect("pulse", item.port.type).ok).toBe(true);
    expect(items.some((i) => i.port.type === "layer")).toBe(false);
    const flip = items.find((i) => i.spec.type === "switch" && i.port.key === "flip")!;
    expect(flip.exact).toBe(true);
    expect(flip.suggested).toBe(true);
    expect(items.indexOf(flip)).toBeLessThan(10);
  });

  it("picks the variant that matches the cable type", () => {
    const items = linkSearchItems(doc, registry, { side: "out", type: "color" });
    const start = items.find((i) => i.spec.type === "transition" && i.port.key === "start")!;
    expect(start.typeParam).toBe("color");
    expect(start.exact).toBe(true);
    for (const item of items) expect(canConnect("color", item.port.type).ok).toBe(true);
  });

  it("looks for outputs when dragging from an input", () => {
    const items = linkSearchItems(doc, registry, { side: "in", type: "number" });
    for (const item of items) expect(canConnect(item.port.type, "number").ok).toBe(true);
    expect(items.some((i) => i.spec.type === "popAnimation" && i.port.key === "output")).toBe(true);
  });

  it("filters by name, alias, and port name", () => {
    const items = linkSearchItems(doc, registry, { side: "out", type: "number" });
    const spring = searchLinkItems(items, "spring");
    expect(spring.length).toBeGreaterThan(0);
    expect(spring.slice(0, 3).some((i) => i.spec.type === "popAnimation")).toBe(true);
    expect(searchLinkItems(items, "bounciness").some((i) => i.port.key === "bounciness")).toBe(true);
    expect(searchLinkItems(items, "zzzqqq")).toEqual([]);
    expect(searchLinkItems(items, "", 5)).toHaveLength(5);
  });
});
