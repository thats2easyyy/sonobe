/**
 * Layer info is made on demand from a finished build (SceneBuild.info). The scene build used to
 * record it for every node on every frame; that code is kept here as the oracle, fed by a layout pass
 * of its own, and every node's on-demand record must equal it.
 */
import type { LayerRef, Value } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { computeLayout, type LayoutNode } from "../layout/computeLayout.ts";
import { approximateTextMeasurer } from "../layout/textMeasurer.ts";
import { finiteOr, toVec2 } from "../math/vec.ts";
import { buildDoc, createMockRegistry, createTestRuntime, tap, type ComponentInput } from "../testing/index.ts";
import type { LayerInfoSnapshot, SceneNode } from "../types.ts";
import type { SonobeRuntime } from "./runtime.ts";
import { splitSceneKey, type SceneBuild } from "./scene.ts";

/** The build the runtime's patches read: the last step's. */
const buildOf = (rt: SonobeRuntime) => (rt as unknown as { snapshot: SceneBuild }).snapshot;
const keyOf = (rt: SonobeRuntime, ref: LayerRef | null) => (rt as unknown as { resolveLayerKey(ref: LayerRef | null): string | null }).resolveLayerKey(ref);

/** What buildScene recorded per node before info was made on demand. */
function eagerInfo(build: SceneBuild): Map<string, LayerInfoSnapshot> {
  const tree = (node: SceneNode): LayoutNode => ({ key: node.key, type: node.type, props: node.props, children: node.children.map(tree) });
  const { scene } = build;
  const layout = computeLayout({ key: " root", type: "group", props: {}, children: scene.roots.map(tree) }, approximateTextMeasurer, scene.size);
  const out = new Map<string, LayerInfoSnapshot>();
  const walk = (node: SceneNode, parent: SceneNode | null) => {
    const f = layout.get(node.key)!;
    const props = node.props as Record<string, Value>;
    const scale = finiteOr(props.scale, 1);
    const sxyz = Array.isArray(props.scaleXYZ) ? (props.scaleXYZ as unknown[]) : [];
    const anchor = toVec2(props.anchor, [0, 0]);
    let parentRef: LayerRef | null = null;
    if (parent) {
      const { instance } = splitSceneKey(parent.key);
      parentRef = instance === undefined ? { layerId: parent.layerId } : { layerId: parent.layerId, instance };
    }
    out.set(node.key, {
      type: node.type,
      enabled: props.enabled !== false,
      position: [f.x + anchor[0] * f.width, f.y + anchor[1] * f.height],
      size: [f.width, f.height],
      scale: [scale * finiteOr(sxyz[0], 1), scale * finiteOr(sxyz[1], 1)],
      anchor,
      parent: parentRef,
      worldTransform: node.worldTransform,
      contentSize: [f.contentSize[0], f.contentSize[1]],
    });
    for (const child of node.children) walk(child, node);
  };
  for (const root of scene.roots) walk(root, null);
  return out;
}

describe("scene build: layer info on demand", () => {
  const card: ComponentInput = {
    id: "card",
    kind: "layerComponent",
    size: [200, 100],
    inputs: { title: { type: "text", default: "Untitled" } },
    layers: [
      {
        id: "box",
        type: "group",
        name: "Box",
        props: { size: [200, 100], layout: "column", padding: [8, 8, 8, 8], spacing: 4 },
        children: [
          { id: "label", type: "text", name: "Label", props: { text: { link: "$in.title" } } },
          { id: "dot", type: "oval", name: "Dot", props: { size: [10, 10], anchor: [0.5, 0.5], scale: 2 } },
        ],
      },
    ],
  };
  const reg = createMockRegistry([]);
  const runtime = () =>
    createTestRuntime(
      buildDoc(
        {
          components: [card],
          layers: [
            {
              id: "list",
              type: "group",
              name: "List",
              props: { position: [10, 20], size: [300, 200], layout: "row", padding: [4, 6, 8, 10], spacing: 5, anchor: [0.5, 0], scale: 1.5, scaleXYZ: [2, 3, 1], rotation: 10 },
              children: [
                { id: "cell", type: "group", name: "Cell", props: { size: [40, 30], opacity: { loop: [0.2, 0.4, 0.6] } }, children: [{ id: "mark", type: "text", name: "Mark", props: { text: "Mark", anchor: [1, 1] } }] },
                { id: "off", type: "rectangle", name: "Off", props: { enabled: false, size: [10, 10] } },
              ],
            },
            { id: "note", type: "text", name: "Note", props: { text: "A line of text that wraps", widthMode: "fixed", size: [60, 20], position: [0, 300] } },
            { id: "cards", type: "componentInstance", name: "Cards", component: "card", props: { repeat: 2, position: [20, 400], title: { loop: ["One", "Two"] } } },
            { id: "grow", type: "rectangle", name: "Grow", props: { position: [0, 600], scale: { link: "size.output" } } },
          ],
          patches: {
            touch: { type: "interaction", inputs: { layer: { layer: "grow" } } },
            toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
            pop: { type: "popAnimation", inputs: { number: { link: "toggle.on" } } },
            size: { type: "transition", inputs: { progress: { link: "pop.output" }, start: 1, end: 2 } },
          },
        },
        reg,
      ),
      reg,
    );

  it("equals what the build used to record for every node: nested, copied, inside component instances, moving", () => {
    const rt = runtime();
    const events = tap(10, 610);
    for (let frame = 0; frame < 12; frame++) {
      if (events[frame]?.length) rt.dispatch(events[frame]!);
      rt.step();
      const build = buildOf(rt);
      const expected = eagerInfo(build);
      expect([...build.nodes.keys()]).toEqual([...expected.keys()]);
      for (const [key, record] of expected) {
        const info = build.info(key)!;
        expect(info, `${key} on frame ${frame}`).toEqual(record);
        expect(info.worldTransform).toBe(build.nodes.get(key)!.worldTransform);
        // The parent reference resolves in its own scope: "cards#1/label" is inside "cards#1/box".
        expect(keyOf(rt, info.parent), `${key}'s parent`).toBe(build.nodes.get(key)!.parentKey);
      }
    }
    const keys = [...buildOf(rt).nodes.keys()];
    expect(keys).toEqual(expect.arrayContaining(["list", "cell#2", "mark#1", "off", "note", "cards#0", "cards#1/box", "cards#1/label", "cards#1/dot", "grow"]));
    // The spring ran, so the records weren't all the same frame's.
    expect(buildOf(rt).info("grow")!.scale[0]).toBeGreaterThan(1);
  });

  it("makes one record per layer per build, and none for a layer that isn't drawn", () => {
    const rt = runtime();
    rt.step();
    const first = buildOf(rt);
    expect(first.info("cards#1/dot")).toBe(first.info("cards#1/dot"));
    expect(first.info("cards#1/dot")!.parent).toBe(first.info("cards#1/dot")!.parent);
    expect(first.info("cards#2/dot")).toBeUndefined();
    expect(first.info("nothing")).toBeUndefined();
    rt.step();
    // The next build has records of its own; a patch that kept the old one still reads the old frame.
    expect(buildOf(rt).info("cards#1/dot")).not.toBe(first.info("cards#1/dot"));
    expect(buildOf(rt).info("cards#1/dot")).toEqual(first.info("cards#1/dot"));
  });

  it("reads Text's textSize from the same layout", () => {
    const rt = runtime();
    rt.step();
    rt.step();
    expect(rt.getValue("@note.textSize")).toEqual(buildOf(rt).info("note")!.contentSize);
    expect((rt.getValue("@note.textSize") as number[])[1]).toBeGreaterThan(20);
  });
});
