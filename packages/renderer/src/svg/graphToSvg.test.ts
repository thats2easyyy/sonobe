/** graphToSvg: a component's patch graph as SVG, from the shared graph model and node boxes. */

import { componentNodeBoxes, deriveGraph, NODE_BOX, tableMeasurer } from "@sonobe/core/graph";
import { buildDoc, createMockRegistry } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS, COMMENT_COLORS, THEME_TOKENS } from "../theme.ts";
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

  it("draws a color knob's chip with a swatch of its color instead of the hex", () => {
    const tinted = {
      ...model,
      nodes: model.nodes.map((n) =>
        n.id === "toggle" && n.data.kind === "patch"
          ? ({ ...n, data: { ...n.data, inputs: n.data.inputs.map((p, i) => (i === 0 ? { ...p, connected: true, link: "$knob.tint", knob: { id: "tint", name: "Tint", valueText: "#FF375F80", color: "#FF375F80" } } : p)) } } as typeof n)
          : n,
      ),
    };
    const wide = new Map(boxes);
    const box = boxes.get("toggle")!;
    wide.set("toggle", { ...box, width: box.width + 100 });
    const { svg } = graphToSvg(tinted, { boxes: wide });
    const node = svg.slice(svg.indexOf('data-node="toggle"'));
    expect(node).toContain(">Tint</text>");
    expect(node).not.toContain("FF375F80</text>");
    expect(node).toMatch(/<rect x="[^"]+" y="[^"]+" width="10" height="10" rx="2" fill="#FF375F" fill-opacity="0.502"\/>/);
    const chip = node.match(/<rect x="[^"]+" y="[^"]+" width="([^"]+)" height="16" rx="3" fill="#5F74E4"/);
    expect(Number(chip?.[1])).toBeCloseTo(NODE_BOX.valuePaddingX + NODE_BOX.knobIcon + NODE_BOX.valueInnerGap + tableMeasurer("Tint", "sans10") + NODE_BOX.valueInnerGap + NODE_BOX.swatch, 1);
  });

  it("draws in the editor's light theme when asked, from the same tokens the editor styles with", () => {
    const dark = graphToSvg(model, { boxes }).svg;
    const light = graphToSvg(model, { boxes, theme: "light" }).svg;
    expect(dark).toContain(`fill="${THEME_TOKENS.dark["canvas-bg"]}"`);
    expect(light).toContain(`fill="${THEME_TOKENS.light["canvas-bg"]}"`);
    expect(light).toContain(`fill="${THEME_TOKENS.light["patch-node-bg"]}"`);
    expect(light).toContain(`fill="${CATEGORY_COLORS.light.interaction}"`);
    expect(light).toContain(`stroke="${COMMENT_COLORS.light.blue}"`);
    expect(light).toContain(`fill="${THEME_TOKENS.light["text-primary"]}"`);
    expect(light).not.toContain(THEME_TOKENS.dark["canvas-bg"]);
    // The node border is the token's color and alpha: black at 0.1 in light, white at 0.08 in dark.
    expect(light).toContain('stroke="#000000" stroke-opacity="0.1"');
    expect(dark).toContain('stroke="#FFFFFF" stroke-opacity="0.08"');
  });

  it("crops and scales", () => {
    const drawing = graphToSvg(model, { boxes, crop: { x: 0, y: 0, width: 200, height: 100 }, scale: 2 });
    expect([drawing.width, drawing.height]).toEqual([400, 200]);
    expect(drawing.svg).toContain('viewBox="0 0 200 100"');
  });
});
