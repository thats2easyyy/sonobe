import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { isFallbackDefinition } from "../registry.ts";
import { CATALOG_CHUNKS } from "../specs.ts";
import { definitions } from "./index.ts";

const registry = createMockRegistry(definitions);

function findNode(frame: SceneFrame, key: string): SceneNode | undefined {
  const stack = [...frame.roots];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.key === key) return node;
    stack.push(...node.children);
  }
  return undefined;
}

describe("utility category", () => {
  it("defines every utility catalog patch, in catalog order", () => {
    const catalogTypes = CATALOG_CHUNKS.filter((c) => c.category === "utility").flatMap((c) => c.patches.map((p) => p.type));
    expect(definitions.map((d) => d.type)).toEqual(catalogTypes);
    for (const def of definitions) expect(isFallbackDefinition(def), def.type).toBe(false);
  });
});

describe("utility integration", () => {
  it("a named Splitter constant sizes two layers through Size, and Point places one", () => {
    const doc = buildDoc(
      {
        layers: [
          { id: "card", type: "rectangle", name: "Card", props: { size: { link: "card_size.output" }, position: { link: "card_position.output" } } },
          { id: "banner", type: "rectangle", name: "Banner", props: { position: [16, 360], size: { link: "banner_size.output" } } },
        ],
        patches: {
          card_width: { type: "splitter", name: "Card Width", inputs: { value: 358 } },
          card_size: { type: "size", inputs: { width: { link: "card_width.output" }, height: 220 } },
          banner_size: { type: "size", inputs: { width: { link: "card_width.output" }, height: 64 } },
          card_position: { type: "point", inputs: { x: 16, y: 120 } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    const frame = rt.step();
    expect(findNode(frame, "card")).toMatchObject({ x: 16, y: 120, width: 358, height: 220 });
    expect(findNode(frame, "banner")).toMatchObject({ x: 16, y: 360, width: 358, height: 64 });
    expect(rt.issues()).toEqual([]);
  });

  it("Edges pad a column group, Edges Unpack reuses the left inset as spacing, and Corner Radii round a row", () => {
    const doc = buildDoc(
      {
        layers: [
          {
            id: "list",
            type: "group",
            name: "List",
            props: { position: [0, 120], size: [402, 600], layout: "column", padding: { link: "inset.output" }, spacing: { link: "sides.left" } },
            children: [
              { id: "row_1", type: "rectangle", name: "Row 1", props: { size: [340, 64], cornerRadii: { link: "corners.output" } } },
              { id: "row_2", type: "rectangle", name: "Row 2", props: { size: [340, 64] } },
            ],
          },
        ],
        patches: {
          inset: { type: "edges", inputs: { top: 24, right: 32, bottom: 24, left: 16 } },
          sides: { type: "edgesUnpack", inputs: { value: { link: "inset.output" } } },
          corners: { type: "cornerRadii", inputs: { topLeft: 20, topRight: 20, bottomRight: 6, bottomLeft: 20 } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    const frame = rt.step();
    expect(rt.getValue("@list.padding")).toEqual([24, 32, 24, 16]);
    expect(findNode(frame, "row_1")).toMatchObject({ x: 16, y: 24 });
    expect(findNode(frame, "row_2")).toMatchObject({ x: 16, y: 24 + 64 + 16 });
    expect(findNode(frame, "row_1")?.props.cornerRadii).toEqual([20, 20, 6, 20]);
  });

  it("taps travel through a switch and a global variable into a Watch readout on a Text layer", () => {
    const doc = buildDoc(
      {
        layers: [
          { id: "card", type: "rectangle", name: "Card", props: { position: [16, 120], size: [200, 100] } },
          { id: "readout", type: "text", name: "Readout", props: { position: [16, 780], text: { link: "readout_watch.display" } } },
        ],
        patches: {
          tap_card: { type: "interaction", inputs: { layer: { layer: "card" } } },
          toggle: { type: "switch", inputs: { flip: { link: "tap_card.tap" } } },
          share_expanded: { type: "variableBroadcaster", typeParam: "boolean", settings: { name: "Expanded", scope: "global" }, inputs: { value: { link: "toggle.on" } } },
          expanded: { type: "variableReceiver", typeParam: "boolean", settings: { name: "Expanded", scope: "global" } },
          readout_watch: { type: "watch", typeParam: "boolean", inputs: { value: { link: "expanded.output" }, label: "Expanded" } },
        },
      },
      registry,
    );
    const logs: unknown[][] = [];
    const rt = createTestRuntime(doc, registry, { onLog: (level, args) => logs.push([level, ...args]) });
    runFrames(rt, 1);
    expect(rt.getValue("@readout.text")).toBe("Expanded: false");
    runFrames(rt, 3, tap(60, 160));
    expect(rt.getValue("expanded.output")).toBe(true);
    expect(rt.getValue("@readout.text")).toBe("Expanded: true · on 1×");
    // The console throttle holds "true" until 0.25 s after the first line, then flushes it.
    runFrames(rt, 20);
    runFrames(rt, 3, tap(60, 160));
    expect(rt.getValue("@readout.text")).toBe("Expanded: false · on 1×");
    runFrames(rt, 20);
    expect(logs).toEqual([
      ["log", "Expanded: false"],
      ["log", "Expanded: true"],
      ["log", "Expanded: false"],
    ]);
  });

  it("a Start Over button restarts the prototype and clears the tally a Watch kept", () => {
    const doc = buildDoc(
      {
        layers: [
          { id: "card", type: "rectangle", name: "Card", props: { position: [16, 120], size: [200, 100] } },
          { id: "start_over", type: "rectangle", name: "Start Over", props: { position: [121, 760], size: [160, 48] } },
        ],
        patches: {
          tap_card: { type: "interaction", inputs: { layer: { layer: "card" } } },
          tap_watch: { type: "watch", typeParam: "boolean", inputs: { value: { link: "tap_card.tap" }, logChanges: false } },
          tap_start_over: { type: "interaction", inputs: { layer: { layer: "start_over" } } },
          start_over_restart: { type: "restartPrototype", inputs: { restart: { link: "tap_start_over.tap" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    runFrames(rt, 2, tap(60, 160));
    runFrames(rt, 2, tap(60, 160));
    expect(rt.getValue("tap_watch.changeCount")).toBe(2);
    runFrames(rt, 2, tap(200, 780));
    expect(rt.frame).toBeGreaterThan(0);
    runFrames(rt, 1);
    expect(rt.frame).toBe(0);
    expect(rt.getValue("tap_watch.changeCount")).toBe(0);
    expect(rt.getValue("tap_watch.display")).toBe("false");
  });
});
