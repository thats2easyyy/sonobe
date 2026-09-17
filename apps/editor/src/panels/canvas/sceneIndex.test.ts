import type { SonobeDocument } from "@sonobe/core";
import { buildDoc, createTestRuntime } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { buildCanvasIndex, hitLayers, isEditableLayer, marqueeLayers, pickChildOf, pickLayer, sceneKeyLayerId } from "./sceneIndex.ts";

function sceneFor(doc: SonobeDocument) {
  const rt = createTestRuntime(doc);
  const scene = rt.step();
  const index = buildCanvasIndex(doc.components[doc.project.root], scene);
  rt.dispose();
  return index;
}

const demo = () =>
  buildDoc({
    layers: [
      { id: "background", type: "colorFill", props: { color: "#FFFFFFFF" } },
      {
        id: "card",
        type: "group",
        props: { position: [20, 20], size: [200, 200], color: "#FFFFFFFF", clip: true },
        children: [
          { id: "photo", type: "rectangle", props: { position: [0, 0], size: [200, 120] } },
          { id: "badge", type: "oval", props: { position: [150, 150], size: [100, 100] } },
          { id: "caption", type: "rectangle", props: { position: [10, 130], size: [100, 20] } },
        ],
      },
      {
        id: "bar",
        type: "group",
        props: { position: [0, 300], size: [300, 50] },
        children: [{ id: "dot", type: "rectangle", props: { position: [10, 10], size: [30, 30] } }],
      },
      { id: "sticker", type: "rectangle", props: { position: [180, 180], size: [60, 60] } },
    ],
  });

describe("buildCanvasIndex", () => {
  it("indexes layers with parents, depth, and scene nodes", () => {
    const index = sceneFor(demo());
    expect(index.entry("photo")).toMatchObject({ parentId: "card", depth: 1, index: 0 });
    expect(index.entry("photo")!.node!.key).toBe("photo");
    expect(index.children(null).map((e) => e.id)).toEqual(["background", "card", "bar", "sticker"]);
    expect(index.bounds("card")).toEqual({ x: 20, y: 20, width: 200, height: 200 });
    expect(index.parentWorld("card")).toBeNull();
    expect(index.parentWorld("photo")![12]).toBe(20);
    expect(isEditableLayer(index, "background")).toBe(false);
    expect(isEditableLayer(index, "photo")).toBe(true);
  });

  it("maps loop copies and component inner keys to component-level layers", () => {
    expect(sceneKeyLayerId("card#3")).toBe("card");
    expect(sceneKeyLayerId("instance#1/inner#2")).toBe("instance");
    expect(sceneKeyLayerId("plain")).toBe("plain");
  });

  it("reports flow layout only for relative children of layout groups", () => {
    const doc = buildDoc({
      layers: [
        {
          id: "stack",
          type: "group",
          props: { layout: "column", size: [100, 300] },
          children: [
            { id: "one", type: "rectangle" },
            { id: "floating", type: "rectangle", props: { positioning: "absolute" } },
          ],
        },
      ],
    });
    const index = sceneFor(doc);
    expect(index.flowLayout("one")).toBe("column");
    expect(index.flowLayout("floating")).toBeNull();
    expect(index.flowLayout("stack")).toBeNull();
  });
});

describe("hitLayers", () => {
  it("returns the front-most layer and its ancestors, ignoring background fills", () => {
    const index = sceneFor(demo());
    expect(hitLayers(index, [30, 30])).toEqual(["photo", "card"]);
    expect(hitLayers(index, [5, 5])).toEqual([]);
  });

  it("respects z order among siblings and across groups", () => {
    const index = sceneFor(demo());
    // The sticker (root, later) sits in front of the card at (200, 200).
    expect(hitLayers(index, [200, 200])).toEqual(["sticker"]);
  });

  it("respects clipping groups", () => {
    const index = sceneFor(demo());
    // badge extends past the card's clip (card ends at 220); at (230, 180) only the sticker is there.
    expect(hitLayers(index, [230, 175])).toEqual([]);
  });

  it("hits transparent groups only through their children", () => {
    const index = sceneFor(demo());
    expect(hitLayers(index, [200, 320])).toEqual([]);
    expect(hitLayers(index, [20, 320])).toEqual(["dot", "bar"]);
  });

  it("passes clicks through locked and disabled layers", () => {
    const doc = demo();
    const component = doc.components.main!;
    const sticker = component.layers.find((l) => l.id === "sticker")!;
    const locked = { ...doc, components: { main: { ...component, layers: component.layers.map((l) => (l === sticker ? { ...l, locked: true } : l)) } } };
    expect(hitLayers(sceneFor(locked), [200, 200])).toEqual(["badge", "card"]);
    const disabled = { ...doc, components: { main: { ...component, layers: component.layers.map((l) => (l === sticker ? { ...l, props: { ...l.props, enabled: false } } : l)) } } };
    expect(hitLayers(sceneFor(disabled), [200, 200])).toEqual(["badge", "card"]);
  });
});

describe("pickLayer", () => {
  const index = sceneFor(demo());
  const chain = ["photo", "card"];

  it("selects the top-level layer without a selection", () => {
    expect(pickLayer(chain, index, [], false)).toBe("card");
  });

  it("selects the deepest layer with ⌘", () => {
    expect(pickLayer(chain, index, [], true)).toBe("photo");
  });

  it("stays at the selection's level: clicking a sibling selects the sibling", () => {
    expect(pickLayer(chain, index, ["caption"], false)).toBe("photo");
    // A selection elsewhere falls back to the top-level layer.
    expect(pickLayer(["dot", "bar"], index, ["caption"], false)).toBe("bar");
    expect(pickLayer(chain, index, ["card"], false)).toBe("card");
  });

  it("goes one level deeper on double-click", () => {
    expect(pickChildOf(chain, index, "card")).toBe("photo");
    expect(pickChildOf(chain, index, "bar")).toBeNull();
  });
});

describe("marqueeLayers", () => {
  const index = sceneFor(demo());

  it("selects intersecting top-level layers", () => {
    expect(marqueeLayers(index, { x: 0, y: 250, width: 400, height: 100 })).toEqual(["bar"]);
    expect(marqueeLayers(index, { x: 190, y: 190, width: 5, height: 5 })).toEqual(["card", "sticker"]);
  });

  it("selects the deepest layers with ⌘", () => {
    // photo ends at y = 140, so start just below it.
    expect(marqueeLayers(index, { x: 15, y: 145, width: 50, height: 200 }, { deep: true })).toEqual(["caption", "dot"]);
  });
});
