import { COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE } from "@sonobe/core";
import { buildDoc } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { componentIdForInstancePath, instanceIdsIn, instancePathFor, qualifyAddress } from "./instances.ts";

const doc = buildDoc({
  components: [
    { id: "badge", kind: "layerComponent", size: [20, 20], layers: [{ id: "dot", type: "oval", name: "Dot" }] },
    {
      id: "card",
      kind: "layerComponent",
      size: [100, 100],
      layers: [
        { id: "body", type: "rectangle", name: "Body" },
        { id: "badge_1", type: COMPONENT_INSTANCE_LAYER_TYPE, name: "Badge", component: "badge" },
      ],
    },
    { id: "logic", kind: "patchComponent", patches: { toggle: { type: "switch" } } },
    { id: "orphan", kind: "layerComponent" },
  ],
  layers: [
    { id: "card_1", type: COMPONENT_INSTANCE_LAYER_TYPE, name: "Card", component: "card" },
    { id: "card_2", type: COMPONENT_INSTANCE_LAYER_TYPE, name: "Card 2", component: "card" },
  ],
  patches: { logic_1: { type: COMPONENT_PATCH_TYPE, component: "logic" } },
});

describe("instance addressing", () => {
  it("finds instances of a component inside another", () => {
    expect(instanceIdsIn(doc, "main", "card")).toEqual(["card_1", "card_2"]);
    expect(instanceIdsIn(doc, "main", "logic")).toEqual(["logic_1"]);
    expect(instanceIdsIn(doc, "card", "badge")).toEqual(["badge_1"]);
    expect(instanceIdsIn(doc, "missing", "card")).toEqual([]);
  });

  it("maps a component path to an engine instance path", () => {
    expect(instancePathFor(doc, ["main"])).toBe("");
    expect(instancePathFor(doc, [])).toBe("");
    expect(instancePathFor(doc, ["main", "card"])).toBe("card_1");
    expect(instancePathFor(doc, ["main", "card", "badge"])).toBe("card_1/badge_1");
    expect(instancePathFor(doc, ["main", "logic"])).toBe("logic_1");
    expect(instancePathFor(doc, ["main", "badge"])).toBe("card_1/badge_1");
    expect(instancePathFor(doc, ["main", "orphan"])).toBeNull();
    expect(instancePathFor(doc, ["main", "missing"])).toBeNull();
  });

  it("maps an instance path back to its component", () => {
    expect(componentIdForInstancePath(doc, undefined)).toBe("main");
    expect(componentIdForInstancePath(doc, "main")).toBe("main");
    expect(componentIdForInstancePath(doc, "card_1")).toBe("card");
    expect(componentIdForInstancePath(doc, "main/card_2#3/badge_1")).toBe("badge");
    expect(componentIdForInstancePath(doc, "main/logic_1")).toBe("logic");
    expect(componentIdForInstancePath(doc, "main/nope")).toBeUndefined();
  });

  it("qualifies addresses", () => {
    expect(qualifyAddress("pop.output", "card_1")).toBe("card_1/pop.output");
    expect(qualifyAddress("@body.scale", "card_1/badge_1")).toBe("@card_1/badge_1/body.scale");
    expect(qualifyAddress("pop.output", "")).toBe("pop.output");
    expect(qualifyAddress("pop.output", null)).toBe("pop.output");
  });
});
