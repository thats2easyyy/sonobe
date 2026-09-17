// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, findLayer, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { layerDropAttributes, layerPropDropAttributes } from "../patch-editor/index.ts";
import { cableHoverKey, layerAcceptsCable, layerHoverKey, propHoverKey } from "./cableHover.ts";

const registry = getRegistry();

function element(attributes: Record<string, string>): HTMLElement {
  const el = document.createElement("div");
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  const child = document.createElement("span");
  el.appendChild(child);
  document.body.appendChild(el);
  return child;
}

describe("cableHoverKey", () => {
  it("names the drop target an element belongs to", () => {
    expect(cableHoverKey(element(layerPropDropAttributes({ layerId: "photo", prop: "scale" })))).toBe(propHoverKey("photo", "scale"));
    expect(cableHoverKey(element(layerDropAttributes("photo")))).toBe(layerHoverKey("photo"));
    expect(cableHoverKey(element({}))).toBeNull();
    expect(cableHoverKey(null)).toBeNull();
  });
});

describe("layerAcceptsCable", () => {
  const doc: SonobeDocument = applyOps(createEmptyDocument(), [{ op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } }], { registry }).doc;
  const card = findLayer(doc.components.main!.layers, "card")!.layer;

  it("accepts cables that fit some bindable property of the layer, in the same component", () => {
    expect(layerAcceptsCable(doc, "main", registry, card, { component: "main", from: "pop.output", type: "number" })).toBe(true);
    expect(layerAcceptsCable(doc, "main", registry, card, { component: "main", from: "tap.layer", type: "layer" })).toBe(false);
    expect(layerAcceptsCable(doc, "main", registry, card, { component: "other", from: "pop.output", type: "number" })).toBe(false);
    expect(layerAcceptsCable(doc, "main", registry, card, null)).toBe(false);
  });
});
