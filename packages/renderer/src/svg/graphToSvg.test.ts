/** graphToSvg: a component's patch graph as SVG, from the shared graph model and node boxes. */

import { componentNodeBoxes, deriveGraph, NODE_BOX, tableMeasurer } from "@sonobe/core/graph";
import { buildDoc, createMockRegistry } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { graphToSvg } from "./graphToSvg.ts";

const registry = createMockRegistry();
const doc = buildDoc(
  {
    layers: [{ id: "card", type: "rectangle", name: "Card <main>" }],
    patches: {
      tap: { type: "interaction", name: "Tap & Hold", inputs: { layer: { layer: "card" } } },
      toggle: { type: "switch", inputs: { flip: { link: "tap.tap" } } },
    },
    ops: [
      { op: "connect", from: "toggle.on", to: "@card.opacity" },
      { op: "addComment", comment: { id: "logic", text: "LOGIC\nthe tap", rect: [-40, -60, 560, 240], color: "blue" } },
    ],
  },
  registry,
);

describe("graphToSvg", () => {
  const model = deriveGraph({ doc, componentId: "main", registry });
  const boxes = componentNodeBoxes(doc, registry, "main");

  it("draws frames, then cables, then every node, with escaped text", () => {
    const { svg, hasText, viewBox } = graphToSvg(model, { boxes });
    expect(hasText).toBe(true);
    const comment = svg.indexOf('data-comment="logic"');
    const cable = svg.indexOf("<path d=\"M ");
    const node = svg.indexOf('data-node="tap"');
    expect(comment).toBeGreaterThan(0);
    expect(cable).toBeGreaterThan(comment);
    expect(node).toBeGreaterThan(cable);
    for (const id of ["tap", "toggle", "@card"]) expect(svg).toContain(`data-node="${id}"`);
    expect(svg).toContain("Tap &amp; Hold");
    expect(svg).toContain(">LOGIC<");
    expect(svg).not.toContain("the tap");
    // Every node and the frame fit in the drawing, with room around them.
    expect(viewBox.x).toBe(-80);
    expect(viewBox.y).toBe(-100);
    for (const box of boxes.values()) expect(box.x + box.width).toBeLessThanOrEqual(viewBox.x + viewBox.width - 40);
  });

  it("draws one cable per connection, from output row to input row", () => {
    const { svg } = graphToSvg(model, { boxes });
    const cables = svg.match(/<path d="M [^"]+ C [^"]+" fill="none"/g) ?? [];
    expect(cables).toHaveLength(model.edges.length);
    const tap = boxes.get("tap")!;
    expect(cables[0]).toContain(`M ${tap.x + tap.width} `);
  });

  it("draws a knob-linked input as the knob chip, the glyph, name and value at the size model's width", () => {
    const knobbed = {
      ...model,
      nodes: model.nodes.map((n) =>
        n.id === "toggle" && n.data.kind === "patch"
          ? ({ ...n, data: { ...n.data, inputs: n.data.inputs.map((p, i) => (i === 0 ? { ...p, connected: true, link: "$knob.flip", knob: { id: "flip", name: "Flip", valueText: "on" } } : p)) } } as typeof n)
          : n,
      ),
    };
    // The boxes were measured without the chip; give the node the room the size model would.
    const wide = new Map(boxes);
    const box = boxes.get("toggle")!;
    wide.set("toggle", { ...box, width: box.width + 100 });
    const { svg } = graphToSvg(knobbed, { boxes: wide });
    const node = svg.slice(svg.indexOf('data-node="toggle"'));
    expect(node).toContain('fill="#5F74E4" fill-opacity="0.18"');
    expect(node).toContain('r="1.75"');
    expect(node).toContain(">Flip</text>");
    expect(node).toContain(">on</text>");
    const chip = node.match(/<rect x="[^"]+" y="[^"]+" width="([^"]+)" height="16" rx="3" fill="#5F74E4"/);
    expect(Number(chip?.[1])).toBeCloseTo(NODE_BOX.valuePaddingX + NODE_BOX.knobIcon + NODE_BOX.valueInnerGap + tableMeasurer("Flip", "sans10") + NODE_BOX.valueInnerGap + tableMeasurer("on", "mono10"), 1);
  });

  it("crops and scales", () => {
    const drawing = graphToSvg(model, { boxes, crop: { x: 0, y: 0, width: 200, height: 100 }, scale: 2 });
    expect([drawing.width, drawing.height]).toEqual([400, 200]);
    expect(drawing.svg).toContain('viewBox="0 0 200 100"');
  });
});
