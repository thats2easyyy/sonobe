// @vitest-environment happy-dom
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { BROWSE_PATCH_LIMIT, browseLinkCandidates, layerLinkItems, linkCandidateGroup, linkCandidates, linkEmptyCopy, outputLinkItems, searchLinkItems, type LinkCandidate } from "./linkSearch.ts";

const registry = createPatchRegistry();
const doc = createDemoDocument(registry);

const describeItem = (item: LinkCandidate) => (item.kind === "patch" ? `patch:${item.spec.type}.${item.port.key}` : `${item.kind}:${item.address}`);

describe("layerLinkItems", () => {
  it("lists layer properties a number can drive, everyday properties first, with current drivers", () => {
    const items = layerLinkItems(doc, "main", registry, { side: "out", type: "number" });
    const photo = items.filter((i) => i.layerId === "photo");
    expect(photo[0]!.port.key).toBe("scale");
    expect(photo[0]).toMatchObject({ kind: "layer", address: "@photo.scale", label: "Photo › Scale", parents: ["Event Card"], driver: "photo_scale.output", exact: true });
    expect(photo.find((i) => i.port.key === "opacity")?.driver).toBeUndefined();
    expect(photo.find((i) => i.port.key === "position")).toMatchObject({ exact: false, conversion: expect.any(String) });
  });

  it("ranks selected layers first and can list one layer", () => {
    const selected = layerLinkItems(doc, "main", registry, { side: "out", type: "number" }, { selected: ["like_button"] });
    expect(selected[0]).toMatchObject({ layerId: "like_button", selected: true });
    const heart = layerLinkItems(doc, "main", registry, { side: "out", type: "color" }, { layerId: "heart" });
    expect(heart.length).toBeGreaterThan(0);
    expect(heart.every((i) => i.layerId === "heart")).toBe(true);
    expect(heart.find((i) => i.port.key === "textColor")).toMatchObject({ exact: true, driver: "heart_color.output" });
  });

  it("lists readable outputs and properties when dragging from an input", () => {
    const items = layerLinkItems(doc, "main", registry, { side: "in", type: "number" });
    const scale = items.find((i) => i.address === "@photo.scale");
    expect(scale).toBeDefined();
    expect(scale!.driver).toBeUndefined();
  });
});

describe("outputLinkItems", () => {
  it("offers outputs already in the graph to an input, leaving out the node you dragged from", () => {
    const items = outputLinkItems(doc, "main", registry, { side: "in", type: "number" }, { exclude: "photo_scale" });
    expect(items.find((i) => i.address === "zoom_spring.output")).toMatchObject({ kind: "output", nodeTitle: "Zoom Spring", exact: true });
    expect(items.some((i) => i.nodeId === "photo_scale")).toBe(false);
    expect(outputLinkItems(doc, "main", registry, { side: "out", type: "number" })).toEqual([]);
  });
});

describe("linkCandidates", () => {
  it("orders groups for an empty query: selected layer, then patches, then other layers", () => {
    const plain = linkCandidates(doc, "main", registry, { side: "out", type: "number" });
    expect(linkCandidateGroup(plain[0]!)).toBe("New patch");
    expect(linkCandidateGroup(plain.at(-1)!)).toBe("Layers");
    const withSelection = linkCandidates(doc, "main", registry, { side: "out", type: "number", selectedLayers: ["photo"] });
    expect(linkCandidateGroup(withSelection[0]!)).toBe("Selected layer");
  });

  it("puts outputs in this graph first when choosing what drives a property", () => {
    const drive = linkCandidates(doc, "main", registry, { side: "in", type: "number", drive: true });
    expect(linkCandidateGroup(drive[0]!)).toBe("In this graph");
    const plain = linkCandidates(doc, "main", registry, { side: "in", type: "number" });
    expect(linkCandidateGroup(plain[0]!)).toBe("New patch");
  });

  it("lists only one layer's properties for a cable dropped on that layer", () => {
    const items = linkCandidates(doc, "main", registry, { side: "out", type: "number", layerId: "photo" });
    expect(items.every((i) => i.kind === "layer" && i.layerId === "photo")).toBe(true);
  });
});

describe("browseLinkCandidates", () => {
  const all = linkCandidates(doc, "main", registry, { side: "out", type: "number" });
  const browse = browseLinkCandidates(all);
  const patches = browse.filter((i) => i.kind === "patch");

  it("suggests the best few patches, one row each, in model order", () => {
    expect(patches).toHaveLength(BROWSE_PATCH_LIMIT);
    expect(new Set(patches.map((i) => i.kind === "patch" && i.spec.type)).size).toBe(patches.length);
    expect(browse.slice(0, patches.length)).toEqual(patches);
    expect(patches[0]).toBe(all[0]);
  });

  it("keeps every layer property and puts the Layers group on the first screen", () => {
    expect(browse.filter((i) => i.kind === "layer")).toHaveLength(all.filter((i) => i.kind === "layer").length);
    expect(linkCandidateGroup(browse[0]!)).toBe("New patch");
    expect(linkCandidateGroup(browse.at(-1)!)).toBe("Layers");
    expect(browse.findIndex((i) => i.kind === "layer")).toBe(BROWSE_PATCH_LIMIT);
  });

  it("shows outputs in this graph right after the suggestions", () => {
    const fromInput = browseLinkCandidates(linkCandidates(doc, "main", registry, { side: "in", type: "number" }));
    expect(linkCandidateGroup(fromInput[BROWSE_PATCH_LIMIT]!)).toBe("In this graph");
  });

  it("searching lists a patch once, and its other ports only when the query names them", () => {
    const byName = searchLinkItems(all, "Transition").filter((i) => i.kind === "patch" && i.spec.type === "transition");
    expect(byName).toHaveLength(1);
    const ports = searchLinkItems(all, "Progress").filter((i) => i.kind === "patch");
    expect(ports.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const item of ports) {
      if (item.kind !== "patch") continue;
      if (seen.has(item.spec.type)) expect(item.port.name).toMatch(/progress/i);
      seen.add(item.spec.type);
    }
  });
});

describe("linkEmptyCopy", () => {
  it("names the query, or else the dragged cable's type", () => {
    expect(linkEmptyCopy("number", "Number")).toBe("Nothing fits this number cable. Try a patch name, a layer or a property.");
    expect(linkEmptyCopy("point3d", "Point 3D")).toBe("Nothing fits this point 3D cable. Try a patch name, a layer or a property.");
    expect(linkEmptyCopy("any", "Any")).toBe("Nothing fits this cable. Try a patch name, a layer or a property.");
    expect(linkEmptyCopy("number", "Number", " zzz ")).toBe("No match for “zzz”. Try a patch name, a layer or a property.");
  });
});

describe("searchLinkItems", () => {
  const fromNumber = linkCandidates(doc, "main", registry, { side: "out", type: "number" });
  const fromBoolean = linkCandidates(doc, "main", registry, { side: "out", type: "boolean", patchType: "switch" });
  const fromPulse = linkCandidates(doc, "main", registry, { side: "out", type: "pulse", patchType: "interaction" });

  it("finds a layer property by layer and property name", () => {
    expect(describeItem(searchLinkItems(fromNumber, "photo scale")[0]!)).toBe("layer:@photo.scale");
    expect(describeItem(searchLinkItems(fromNumber, "Opacity")[0]!)).toMatch(/^layer:@.*\.opacity$/);
  });

  it("still ranks patches first for patch names", () => {
    expect(describeItem(searchLinkItems(fromPulse, "Switch")[0]!)).toMatch(/^patch:switch\./);
    expect(describeItem(searchLinkItems(fromBoolean, "Pop Animation")[0]!)).toMatch(/^patch:popAnimation\./);
    expect(describeItem(searchLinkItems(fromNumber, "Transition")[0]!)).toMatch(/^patch:transition\./);
  });
});
