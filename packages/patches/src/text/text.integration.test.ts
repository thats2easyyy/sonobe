import type { SceneNode } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { definitions } from "./index.ts";

function nodesOf(roots: readonly SceneNode[], layerId: string): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (node: SceneNode) => {
    if (node.layerId === layerId) out.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

describe("text patches in a runtime", () => {
  const registry = createMockRegistry(definitions);

  it("drives labels from a counter and replicates tabs from split text", () => {
    const doc = buildDoc(
      {
        layers: [
          { id: "next", type: "rectangle", name: "Next", props: { position: [0, 700], size: [200, 80] } },
          { id: "label", type: "text", name: "Label", props: { position: [24, 60], text: { link: "label_text.output" } } },
          {
            id: "tabs",
            type: "group",
            name: "Tabs",
            props: { position: [0, 780], size: [390, 64], layout: "row" },
            children: [{ id: "tab", type: "text", name: "Tab", props: { text: { link: "tab_names.output" } } }],
          },
        ],
        patches: {
          tap_next: { type: "interaction", inputs: { layer: { layer: "next" } } },
          page: { type: "counter", inputs: { increase: { link: "tap_next.tap" } } },
          page_label: { type: "formatNumber", inputs: { value: { link: "page.count" }, prefix: "page ", suffix: " of 12", minimumDigits: 2 } },
          label_text: { type: "changeCase", inputs: { text: { link: "page_label.text" }, case: "capitalize" } },
          names: { type: "splitText", inputs: { text: "home,search,profile" } },
          tab_names: { type: "changeCase", inputs: { text: { link: "names.parts" }, case: "capitalize" } },
          lengths: { type: "textLength", inputs: { text: { link: "names.parts" } } },
          total: { type: "loopSum", inputs: { loop: { link: "lengths.length" } } },
          is_search: { type: "textContains", inputs: { text: { link: "names.parts" }, find: "SEARCH" } },
          muted_check: { type: "textContains", muted: true, inputs: { text: "abc", find: "b" } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    expect(rt.getValue("@label.text")).toBe("Page 00 Of 12");
    expect(rt.issues().filter((i) => i.severity === "error")).toEqual([]);

    runFrames(rt, 3, tap(100, 740));
    expect(rt.getValue("page.count")).toBe(1);
    expect(rt.getValue("@label.text")).toBe("Page 01 Of 12");

    expect(rt.getRawValue("tab_names.output")).toEqual({ __loop: true, items: ["Home", "Search", "Profile"] });
    expect(rt.getValue("names.count")).toBe(3);
    expect(rt.getValue("total.sum")).toBe(17);
    expect(rt.getRawValue("is_search.index")).toEqual({ __loop: true, items: [-1, 0, -1] });
    expect(rt.getValue("muted_check.index")).toBe(-1);

    const tabs = nodesOf(rt.scene().roots, "tab");
    expect(tabs.map((n) => n.props.text)).toEqual(["Home", "Search", "Profile"]);
  });

  it("measures a label on the same frame it changes", () => {
    const doc = buildDoc(
      {
        layers: [{ id: "badge", type: "rectangle", name: "Badge", props: { size: { link: "badge_size.size" } } }],
        patches: {
          label: { type: "changeCase", inputs: { text: "limited offer", case: "uppercase" } },
          short: { type: "substring", inputs: { text: { link: "label.output" }, length: 7 } },
          badge_size: { type: "measureText", inputs: { text: { link: "short.output" }, fontSize: 13, fontWeight: 600 } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    expect(rt.getValue("short.output")).toBe("LIMITED");
    const size = rt.getValue("@badge.size") as number[];
    expect(size[0]).toBeGreaterThan(40);
    expect(size[1]).toBeCloseTo(13 * 1.2, 6);
    expect(nodesOf(rt.scene().roots, "badge")[0]!.width).toBeCloseTo(size[0]!, 6);
  });
});
