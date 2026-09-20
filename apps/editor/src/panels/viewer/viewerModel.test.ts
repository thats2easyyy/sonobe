import { applyOps, createEmptyDocument, createRegistry, deviceScreenSize } from "@sonobe/core";
import { buildDoc, createTestRuntime } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { devicePresetOps, emptyLoopNotice, fitScale, formatFps, interactiveLayerIds, layerScreenRect, nodesForLayers, outlinePoints, phoneClientsLabel, presetForDevice, qrPath, rotateDeviceOps, sceneKeysForLayers } from "./viewerModel.ts";

describe("layerScreenRect", () => {
  it("maps a layer's box through the stage's client rect", () => {
    const rt = createTestRuntime(buildDoc({ layers: [{ id: "card", type: "rectangle", props: { position: [40, 80], size: [100, 50] } }] }));
    const scene = rt.step();
    rt.dispose();
    const stage = { x: 10, y: 20, width: scene.size[0] / 2, height: scene.size[1] / 2 };
    expect(layerScreenRect(scene, "card", stage)).toEqual({ x: 30, y: 60, width: 50, height: 25, scale: 0.5 });
    expect(layerScreenRect(scene, "missing", stage)).toBeNull();
    expect(layerScreenRect(null, "card", stage)).toBeNull();
    expect(layerScreenRect(scene, "card", { ...stage, width: 0 })).toBeNull();
  });

  it("counts connected phones", () => {
    expect(phoneClientsLabel(0)).toBe("Waiting for a phone");
    expect(phoneClientsLabel(1)).toBe("1 phone connected");
    expect(phoneClientsLabel(4)).toBe("4 phones connected");
  });
});

describe("device settings", () => {
  it("applies size overrides to presets", () => {
    expect(presetForDevice({ preset: "custom", size: [300, 500] }).size).toEqual([300, 500]);
    expect(presetForDevice({ preset: "iphone-se" }).size).toEqual([375, 667]);
  });

  it("builds setProject ops that the document accepts", () => {
    const registry = createRegistry();
    let doc = createEmptyDocument();
    const r1 = applyOps(doc, rotateDeviceOps(doc.project.device), { registry });
    expect(r1.ok).toBe(true);
    doc = r1.doc;
    expect(doc.project.device).toEqual({ preset: "iphone-17-pro", orientation: "landscape" });
    const r2 = applyOps(doc, devicePresetOps(doc.project.device, "android-compact"), { registry });
    expect(r2.doc.project.device).toEqual({ preset: "android-compact", orientation: "landscape" });
    expect(deviceScreenSize(r2.doc.project.device)).toEqual([800, 360]);
    const r3 = applyOps(r2.doc, rotateDeviceOps(r2.doc.project.device), { registry });
    expect(r3.doc.project.device).toEqual({ preset: "android-compact" });
  });

  it("keeps a size override only for the custom preset", () => {
    expect(devicePresetOps({ preset: "custom", size: [10, 20] }, "custom")[0]).toEqual({ op: "setProject", changes: { device: { preset: "custom", size: [10, 20] } } });
    expect(devicePresetOps({ preset: "custom", size: [10, 20] }, "iphone-air")[0]).toEqual({ op: "setProject", changes: { device: { preset: "iphone-air" } } });
  });
});

describe("fitScale", () => {
  it("fits within padding and never enlarges past the cap", () => {
    expect(fitScale([400, 800], [448, 448], 24)).toBe(0.5);
    expect(fitScale([100, 100], [1000, 1000], 24)).toBe(1);
    expect(fitScale([100, 100], [1000, 1000], 24, 2)).toBe(2);
    expect(fitScale([400, 800], [0, 0])).toBe(0.25);
  });
});

describe("highlight and hit target nodes", () => {
  const doc = buildDoc({
    layers: [
      { id: "card", type: "rectangle", props: { position: [10, 20], size: [100, 50] } },
      { id: "hidden", type: "rectangle", props: { enabled: false } },
    ],
    patches: { tap: { type: "interaction", inputs: { layer: { layer: "card" } } } },
  });
  const rt = createTestRuntime(doc);
  const scene = rt.step();

  it("finds layers patches read touches from", () => {
    expect([...interactiveLayerIds(doc)]).toEqual(["card"]);
    expect(sceneKeysForLayers(scene, new Set(["card"]))).toEqual(["card"]);
  });

  it("matches root nodes, skips hidden ones and other scopes", () => {
    expect(nodesForLayers(scene, new Set(["card", "hidden"]), "root").map((n) => n.key)).toEqual(["card"]);
    expect(nodesForLayers(scene, new Set(["card"]), "instance")).toEqual([]);
    expect(nodesForLayers(null, new Set(["card"]), "root")).toEqual([]);
  });

  it("outlines a node through its world transform", () => {
    const node = nodesForLayers(scene, new Set(["card"]), "root")[0]!;
    expect(outlinePoints(node)).toBe("10,20 110,20 110,70 10,70");
  });
});

describe("formatting", () => {
  it("formats fps", () => {
    expect(formatFps(60)).toBe("60 fps");
    expect(formatFps(59.84)).toBe("59.8 fps");
  });

  it("merges QR module runs into rows of rects", () => {
    const dark = new Set(["0,0", "0,1", "1,1"]);
    expect(qrPath(2, (r, c) => dark.has(`${r},${c}`), 4)).toBe("M4 4h2v1h-2zM5 5h1v1h-1z");
  });
});

describe("emptyLoopNotice", () => {
  const doc = buildDoc({ layers: [{ id: "card", type: "rectangle", name: "Card" }], patches: { swipe: { type: "splitter", name: "Card Swipe" } } });
  const warning = (itemIds: string[]) => ({ code: "empty_loop", severity: "warning" as const, message: "…", component: "main", itemIds });

  it("names what has no copies, a layer before a component", () => {
    expect(emptyLoopNotice([], doc)).toBeNull();
    expect(emptyLoopNotice([{ ...warning(["card"]), code: "loop_limit" }], doc)).toBeNull();
    expect(emptyLoopNotice([warning(["swipe"]), warning(["card"])], doc)).toMatchObject({ label: "Card has no copies", count: 2, diagnostic: { itemIds: ["card"] } });
    expect(emptyLoopNotice([warning(["swipe"])], doc)?.label).toBe("Card Swipe has no copies");
  });
});
