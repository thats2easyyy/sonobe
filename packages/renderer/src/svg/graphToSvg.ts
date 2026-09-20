/**
 * graphToSvg: a patch graph as a static SVG, for screenshots of a component's graph without the
 * patch editor on screen (MCP headless hosts rasterize it; the app draws it in a hidden window). It
 * draws what the patch editor does, in its dark or light theme (the editor's own color tokens,
 * ../theme.ts): comment frames with their titles, cables as the editor's curves colored by type, and
 * nodes with a category-tinted header, port rows, inline values and live values. Boxes come from the
 * caller (the shared node size model in @sonobe/core/graph, or sizes the editor measured). DOM-free.
 */

import { parseColor, type PatchCategory } from "@sonobe/core";
import {
  cablePath,
  NODE_BOX,
  nodeShapeFromData,
  portCenterY,
  tableMeasurer,
  type GraphModel,
  type GraphNode,
  type NodeFont,
  type NodeRowShape,
  type NodeShape,
  type PortModel,
  type Rect,
  type ValueChip,
} from "@sonobe/core/graph";
import { CATEGORY_COLORS, COMMENT_COLORS, portColor, THEME_TOKENS, type ThemeName } from "../theme.ts";
import { el, escapeText, hex, num } from "./xml.ts";

export interface GraphSvgOptions {
  /** Graph node id → its box in patch editor points. Nodes without a box aren't drawn. */
  boxes: ReadonlyMap<string, Rect>;
  /** Live values by address: output rows print them, as in a running editor. */
  live?: (address: string) => unknown;
  /** Layer id → name, for inline layer values. */
  layerName?: (id: string) => string | undefined;
  /** The region to draw, in patch editor points (default: every node and frame, padded). */
  crop?: Rect;
  /** Room around the graph when there's no crop. Default 40. */
  padding?: number;
  /** Output pixels per point (default 1). */
  scale?: number;
  /** The editor theme to draw in (default "dark"). */
  theme?: ThemeName;
}

export interface GraphSvg {
  svg: string;
  /** Output size in pixels. */
  width: number;
  height: number;
  /** The drawn region in patch editor points. */
  viewBox: Rect;
  hasText: boolean;
}

/** A token as a color and its alpha (SVG takes opacity apart from the color). */
interface Paint {
  color: string;
  opacity: number;
}

function paint(token: string): Paint {
  const c = parseColor(token);
  return c ? { color: hex(c).toUpperCase(), opacity: c.a } : { color: token, opacity: 1 };
}

/** What a drawing paints with: the editor's color tokens (../theme.ts) in one theme. */
interface Palette {
  theme: ThemeName;
  canvas: string;
  node: string;
  border: Paint;
  text: string;
  secondary: string;
  tertiary: string;
  field: Paint;
  danger: string;
  warn: string;
  ai: string;
  /** Knob chips: the accent-soft fill and the accent text (live values use the accent text too). */
  accentSoft: Paint;
  textAccent: string;
  category: Record<PatchCategory, string>;
  comment: Record<string, string>;
}

function palette(theme: ThemeName): Palette {
  const t = THEME_TOKENS[theme];
  return {
    theme,
    canvas: t["canvas-bg"],
    node: t["patch-node-bg"],
    border: paint(t["patch-node-border"]),
    text: t["text-primary"],
    secondary: t["text-secondary"],
    tertiary: t["text-tertiary"],
    field: paint(t["bg-field"]),
    danger: t.danger,
    warn: t.warn,
    ai: t.ai,
    accentSoft: paint(t["accent-soft"]),
    textAccent: t["text-accent"],
    category: CATEGORY_COLORS[theme],
    comment: COMMENT_COLORS[theme],
  };
}

const PALETTES: Record<ThemeName, Palette> = { dark: palette("dark"), light: palette("light") };

const SANS = "SF Pro Text, -apple-system, Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "SF Mono, Menlo, Monaco, Consolas, monospace";

const FONT_ATTRS: Record<NodeFont, { "font-family": string; "font-size": number; "font-weight"?: number; "font-style"?: string }> = {
  title: { "font-family": SANS, "font-size": 12, "font-weight": 600 },
  label: { "font-family": SANS, "font-size": 11 },
  chip: { "font-family": SANS, "font-size": 10, "font-weight": 500 },
  badge: { "font-family": SANS, "font-size": 10, "font-weight": 700 },
  working: { "font-family": SANS, "font-size": 10, "font-weight": 600 },
  sans10: { "font-family": SANS, "font-size": 10 },
  italic10: { "font-family": SANS, "font-size": 10, "font-style": "italic" },
  mono10: { "font-family": MONO, "font-size": 10 },
  comment: { "font-family": SANS, "font-size": 11, "font-weight": 500 },
};

/** `text` cut with an ellipsis to fit `max` points in `font`. */
function fit(text: string, font: NodeFont, max: number): string {
  if (tableMeasurer(text, font) <= max) return text;
  const chars = [...text];
  while (chars.length && tableMeasurer(`${chars.join("")}…`, font) > max) chars.pop();
  return chars.length ? `${chars.join("")}…` : "";
}

function text(x: number, y: number, content: string, font: NodeFont, fill: string, extra: Record<string, string | number> = {}): string {
  return content ? el("text", { x, y, fill, ...FONT_ATTRS[font], ...extra }, escapeText(content)) : "";
}

/** A port handle on the node's edge: a diamond for pulses, a dot for everything else. */
function handle(p: Palette, x: number, y: number, port: PortModel): string {
  const stroke = portColor(port.type, p.theme);
  const fill = port.connected ? stroke : p.node;
  if (port.type === "pulse") return el("path", { d: `M ${num(x)} ${num(y - 4.5)} L ${num(x + 4.5)} ${num(y)} L ${num(x)} ${num(y + 4.5)} L ${num(x - 4.5)} ${num(y)} Z`, fill, stroke, "stroke-width": 1.5 });
  return el("circle", { cx: x, cy: y, r: 3.5, fill, stroke, "stroke-width": 1.5 });
}

function valueText(v: Exclude<ValueChip, { kind: "knob" }>): string {
  switch (v.kind) {
    case "vector":
      return v.texts.join("  ");
    case "check":
      return "";
    case "color":
      return v.hex;
    case "text":
      return v.text || "Empty";
    default:
      return v.text;
  }
}

/**
 * A knob chip as InlineValue.tsx's KnobChip draws it and nodeSize.ts sizes it: the knob glyph, the
 * knob's name in the accent color (cut first when room runs out), and its running value in mono, or
 * a color knob's swatch.
 */
function knobChip(p: Palette, x: number, cy: number, v: Extract<ValueChip, { kind: "knob" }>, max: number): string {
  const B = NODE_BOX;
  const room = Math.max(0, Math.min(max, B.valueMaxWidth) - B.valuePaddingX - B.knobIcon - B.valueInnerGap);
  const value = !v.swatch && v.text ? fit(v.text, "mono10", room) : "";
  const valueWidth = v.swatch ? B.valueInnerGap + B.swatch : value ? B.valueInnerGap + tableMeasurer(value, "mono10") : 0;
  const name = fit(v.name, "sans10", Math.max(0, room - valueWidth));
  const nameWidth = tableMeasurer(name, "sans10");
  const width = Math.min(B.valueMaxWidth, B.valuePaddingX + B.knobIcon + B.valueInnerGap + nameWidth + valueWidth);
  const glyph = x + B.valuePaddingX / 2 + B.knobIcon / 2;
  const nameX = x + B.valuePaddingX / 2 + B.knobIcon + B.valueInnerGap;
  const after = nameX + nameWidth + B.valueInnerGap;
  return [
    el("rect", { x, y: cy - 8, width, height: 16, rx: 3, fill: p.accentSoft.color, "fill-opacity": p.accentSoft.opacity }),
    el("circle", { cx: glyph, cy, r: 4, fill: "none", stroke: p.textAccent, "stroke-width": 1.25 }),
    el("circle", { cx: glyph, cy, r: 1.75, fill: p.textAccent }),
    text(nameX, cy + 3.5, name, "sans10", p.textAccent),
    v.swatch ? swatch(after, cy, v.swatch) : text(after, cy + 3.5, value, "mono10", p.text),
  ].join("");
}

/** A 10 pt color swatch ("#RRGGBBAA") centered on `cy`, as .sb-pe-swatch draws it. */
function swatch(x: number, cy: number, color: string): string {
  const alpha = parseInt(color.slice(7, 9) || "FF", 16) / 255;
  return el("rect", { x, y: cy - NODE_BOX.swatch / 2, width: NODE_BOX.swatch, height: NODE_BOX.swatch, rx: 2, fill: color.slice(0, 7), ...(alpha < 1 ? { "fill-opacity": alpha } : {}) });
}

/**
 * A boolean input's checkbox, as .sb-pe-check draws it: an outlined box when off; filled with the
 * boolean color and checked when on, toned 55% toward the node when that's the default.
 */
function checkbox(p: Palette, x: number, cy: number, v: Extract<ValueChip, { kind: "check" }>): string {
  const B = NODE_BOX;
  const y = cy - B.check / 2;
  if (!v.on) return el("rect", { x, y, width: B.check, height: B.check, rx: 3, fill: p.field.color, "fill-opacity": 0.1, stroke: p.secondary, "stroke-opacity": 0.4 });
  // The editor's 10 pt check mark (viewBox 0 0 10 10), centered in the box.
  const [mx, my] = [x + (B.check - 10) / 2, y + (B.check - 10) / 2];
  const mark = `M ${num(mx + 2)} ${num(my + 5.2)} L ${num(mx + 4.2)} ${num(my + 7.2)} L ${num(mx + 8)} ${num(my + 2.8)}`;
  return [
    el("rect", { x, y, width: B.check, height: B.check, rx: 3, fill: portColor("boolean", p.theme), ...(v.isDefault ? { "fill-opacity": 0.55 } : {}) }),
    el("path", { d: mark, fill: "none", stroke: "#1b0f16", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  ].join("");
}

function valueChip(p: Palette, x: number, cy: number, v: ValueChip, max: number): string {
  const B = NODE_BOX;
  if (v.kind === "knob") return knobChip(p, x, cy, v, max);
  if (v.kind === "check") return checkbox(p, x, cy, v);
  const font: NodeFont = v.kind === "menu" || (v.kind === "text" && v.text) ? "sans10" : v.kind === "text" ? "italic10" : "mono10";
  const label = fit(valueText(v), font, Math.max(0, Math.min(max, B.valueMaxWidth) - B.valuePaddingX - (v.kind === "color" ? B.swatch + B.valueInnerGap : 0)));
  if (!label && v.kind !== "color") return "";
  const swatch = v.kind === "color" ? B.swatch + B.valueInnerGap : 0;
  const width = Math.min(B.valueMaxWidth, B.valuePaddingX + swatch + tableMeasurer(label, font));
  const parts = [el("rect", { x, y: cy - 8, width, height: 16, rx: 3, fill: p.field.color, "fill-opacity": p.field.opacity })];
  if (v.kind === "color") parts.push(el("rect", { x: x + 3, y: cy - 5, width: B.swatch, height: B.swatch, rx: 2, fill: `#${v.hex.slice(0, 6)}` }));
  parts.push(text(x + 5 + swatch, cy + 3.5, label, font, v.kind === "text" && !v.text ? p.tertiary : p.text));
  return parts.join("");
}

function headerAccent(p: Palette, node: GraphNode): string {
  const data = node.data;
  if (data.kind === "patch") return data.known ? p.category[data.category] : p.danger;
  if (data.kind === "layer") return p.category.layers;
  return p.category.components;
}

function drawNode(p: Palette, node: GraphNode, box: Rect, shape: NodeShape): string {
  const B = NODE_BOX;
  const data = node.data;
  if (data.kind === "comment") return "";
  const accent = headerAccent(p, node);
  const collapsed = !!shape.collapsed;
  const parts: string[] = [];
  const issues = data.kind === "interface" ? [] : data.issues;
  const issue = issues.length ? (issues.some((i) => i.severity === "error") ? p.danger : p.warn) : undefined;
  parts.push(el("rect", { x: box.x, y: box.y, width: box.width, height: box.height, rx: 8, fill: p.node }));
  // The header: the category color over the node background, with a hairline under it.
  parts.push(el("path", { d: collapsed ? roundedRect(box.x, box.y, box.width, B.header, 8, 8) : roundedRect(box.x, box.y, box.width, B.header, 8, 0), fill: accent, "fill-opacity": data.kind === "layer" ? 0.2 : 0.15 }));
  if (!collapsed) parts.push(el("rect", { x: box.x, y: box.y + B.header - 1, width: box.width, height: 1, fill: accent, "fill-opacity": 0.2 }));
  parts.push(el("rect", { x: box.x + 8, y: box.y + 6, width: B.icon, height: B.icon, rx: 3, fill: accent, "fill-opacity": 0.26 }));
  parts.push(el("circle", { cx: box.x + 8 + B.icon / 2, cy: box.y + 6 + B.icon / 2, r: 3, fill: accent }));
  // Chips after the title, drawn from the right edge back.
  let right = box.x + box.width - 8;
  const chips: string[] = [];
  for (const chip of [...shape.chips].reverse()) {
    if (chip.kind === "badge") {
      right -= B.badge;
      chips.push(el("circle", { cx: right + B.badge / 2, cy: box.y + B.header / 2, r: 5, fill: issue ?? p.tertiary }));
    } else if (chip.kind === "enter") {
      right -= B.enterIcon;
      chips.push(text(right, box.y + 18, "›", "title", p.secondary));
    } else {
      const font: NodeFont = chip.kind === "loop" ? "badge" : chip.kind === "working" ? "working" : "chip";
      const width = chip.kind === "loop" ? Math.max(B.loopMin, B.chipPaddingX + tableMeasurer(chip.text, font)) : chip.kind === "working" ? B.workingPaddingX + B.workingDot + tableMeasurer(chip.text, font) : B.chipPaddingX + tableMeasurer(chip.text, font);
      right -= width;
      const fill = chip.kind === "working" ? p.ai : chip.kind === "loop" ? p.category.loops : p.secondary;
      chips.push(el("rect", { x: right, y: box.y + 6, width, height: 16, rx: 8, fill, "fill-opacity": 0.18 }));
      chips.push(text(right + width / 2, box.y + 17.5, chip.text, font, chip.kind === "chip" ? p.secondary : fill, { "text-anchor": "middle" }));
    }
    right -= B.headerGap;
  }
  const titleX = box.x + 8 + B.icon + B.headerGap;
  parts.push(text(titleX, box.y + 18, fit(shape.title, "title", Math.max(0, right - titleX)), "title", p.text));
  parts.push(...chips);
  // Port rows, or the handles at the header's center when collapsed.
  const inputs = data.inputs;
  const outputs = data.outputs;
  shape.rows.forEach((row: NodeRowShape, i) => {
    const cy = box.y + portCenterY(shape, i);
    const input = inputs[i];
    const output = outputs[i];
    if (input) parts.push(handle(p, box.x, cy, input));
    if (output) parts.push(handle(p, box.x + box.width, cy, output));
    if (collapsed) return;
    const half = box.width / 2;
    let x = box.x + B.portPadding;
    if (row.in && input) {
      const color = input.issue?.severity === "error" ? p.danger : input.connected ? p.text : p.secondary;
      const label = fit(row.in.label, "label", (row.out ? half : box.width) - B.portPadding - 4);
      parts.push(text(x, cy + 4, label, "label", color));
      x += tableMeasurer(label, "label") + B.portGap;
      if (row.in.value) parts.push(valueChip(p, x, cy, row.in.value, box.x + (row.out ? half : box.width) - x - 4));
    }
    if (row.out && output) {
      const end = box.x + box.width - B.portPadding;
      const label = fit(row.out.label, "label", half - B.portPadding - 4);
      parts.push(text(end, cy + 4, label, "label", output.connected ? p.text : p.secondary, { "text-anchor": "end" }));
      if (row.out.live) {
        const liveEnd = end - tableMeasurer(label, "label") - B.portGap;
        const live = fit(row.out.live, "mono10", Math.min(B.liveMaxWidth, liveEnd - (box.x + half)));
        parts.push(text(liveEnd, cy + 3.5, live, "mono10", output.type === "boolean" ? portColor("boolean", p.theme) : p.textAccent, { "text-anchor": "end" }));
      }
    }
  });
  parts.push(el("rect", { x: box.x + 0.5, y: box.y + 0.5, width: box.width - 1, height: box.height - 1, rx: 7.5, fill: "none", stroke: issue ?? (data.kind === "layer" ? p.category.layers : p.border.color), "stroke-opacity": issue ? 0.55 : data.kind === "layer" ? 0.35 : p.border.opacity }));
  const muted = data.kind === "patch" && data.muted;
  return el("g", { "data-node": node.id, ...(muted ? { opacity: 0.55 } : {}) }, parts.join(""));
}

/** A rect with rounded top corners (`top`) and bottom corners (`bottom`). */
function roundedRect(x: number, y: number, w: number, h: number, top: number, bottom: number): string {
  return [
    `M ${num(x + top)} ${num(y)}`,
    `H ${num(x + w - top)}`,
    `A ${top} ${top} 0 0 1 ${num(x + w)} ${num(y + top)}`,
    `V ${num(y + h - bottom)}`,
    bottom ? `A ${bottom} ${bottom} 0 0 1 ${num(x + w - bottom)} ${num(y + h)}` : "",
    `H ${num(x + bottom)}`,
    bottom ? `A ${bottom} ${bottom} 0 0 1 ${num(x)} ${num(y + h - bottom)}` : "",
    `V ${num(y + top)}`,
    `A ${top} ${top} 0 0 1 ${num(x + top)} ${num(y)}`,
    "Z",
  ].filter(Boolean).join(" ");
}

function drawComment(p: Palette, node: GraphNode): string {
  const data = node.data;
  if (data.kind !== "comment") return "";
  const [x, y, width, height] = [node.position.x, node.position.y, node.width ?? NODE_BOX.comment.width, node.height ?? NODE_BOX.comment.height];
  const color = p.comment[data.color ?? "gray"] ?? p.comment.gray!;
  const gray = (data.color ?? "gray") === "gray";
  const title = fit(data.text.split("\n")[0]!.trim(), "comment", Math.max(0, width - 44));
  return el(
    "g",
    { "data-comment": data.commentId },
    [
      el("rect", { x, y, width, height, rx: 12, fill: gray ? p.text : color, "fill-opacity": gray ? 0.025 : 0.06 }),
      el("rect", { x: x + 0.5, y: y + 0.5, width: width - 1, height: height - 1, rx: 11.5, fill: "none", stroke: gray ? p.border.color : color, "stroke-opacity": gray ? 0.06 : 0.2 }),
      text(x + 14, y + 21, title, "comment", gray ? p.tertiary : color),
    ].join(""),
  );
}

/** Where a cable starts or ends: the row of the port on the node's edge. */
function portPoint(nodes: ReadonlyMap<string, GraphNode>, shapes: ReadonlyMap<string, NodeShape>, boxes: ReadonlyMap<string, Rect>, nodeId: string, handleId: string, side: "in" | "out"): [number, number] | undefined {
  const node = nodes.get(nodeId);
  const box = boxes.get(nodeId);
  const shape = shapes.get(nodeId);
  if (!node || !box || !shape || node.data.kind === "comment") return undefined;
  const ports = side === "in" ? node.data.inputs : node.data.outputs;
  const index = ports.findIndex((p) => p.handleId === handleId);
  if (index < 0) return undefined;
  return [side === "in" ? box.x : box.x + box.width, box.y + portCenterY(shape, index)];
}

/** Every node box and comment frame, for the drawing's extent. */
function extent(model: GraphModel, boxes: ReadonlyMap<string, Rect>): Rect | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (r: Rect) => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  };
  for (const node of model.nodes) {
    if (node.data.kind === "comment") add({ x: node.position.x, y: node.position.y, width: node.width ?? NODE_BOX.comment.width, height: node.height ?? NODE_BOX.comment.height });
    else {
      const box = boxes.get(node.id);
      if (box) add(box);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : undefined;
}

/** Draw a component's graph model with the given node boxes. */
export function graphToSvg(model: GraphModel, options: GraphSvgOptions): GraphSvg {
  const padding = options.padding ?? 40;
  const scale = options.scale && options.scale > 0 ? options.scale : 1;
  const content = extent(model, options.boxes);
  const view = options.crop ?? (content ? { x: content.x - padding, y: content.y - padding, width: content.width + padding * 2, height: content.height + padding * 2 } : { x: 0, y: 0, width: 400, height: 240 });
  const shapeOptions = { ...(options.live ? { live: options.live } : {}), ...(options.layerName ? { layerName: options.layerName } : {}) };
  const shapes = new Map<string, NodeShape>();
  for (const node of model.nodes) if (node.data.kind !== "comment") shapes.set(node.id, nodeShapeFromData(node.data, shapeOptions));
  const p = PALETTES[options.theme ?? "dark"];
  const parts: string[] = [el("rect", { x: view.x, y: view.y, width: view.width, height: view.height, fill: p.canvas })];
  for (const node of model.nodes) if (node.data.kind === "comment") parts.push(drawComment(p, node));
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  for (const edge of model.edges) {
    const from = portPoint(byId, shapes, options.boxes, edge.source, edge.sourceHandle, "out");
    const to = portPoint(byId, shapes, options.boxes, edge.target, edge.targetHandle, "in");
    if (!from || !to) continue;
    const invalid = !!edge.data.invalid;
    parts.push(el("path", { d: cablePath(from[0], from[1], to[0], to[1]), fill: "none", stroke: invalid ? p.danger : portColor(edge.data.sourceType, p.theme), "stroke-width": edge.data.loop ? 3 : 2, "stroke-opacity": 0.9, ...(invalid ? { "stroke-dasharray": "5 4" } : {}) }));
  }
  for (const node of model.nodes) {
    const box = options.boxes.get(node.id);
    const shape = shapes.get(node.id);
    if (box && shape) parts.push(drawNode(p, node, box, shape));
  }
  // Every node has a title; a graph of only comments has text when a comment does.
  const hasText = shapes.size > 0 || model.nodes.some((n) => n.data.kind === "comment" && n.data.text.trim() !== "");
  const width = Math.max(1, Math.round(view.width * scale));
  const height = Math.max(1, Math.round(view.height * scale));
  const svg = el("svg", { xmlns: "http://www.w3.org/2000/svg", width, height, viewBox: `${num(view.x)} ${num(view.y)} ${num(view.width)} ${num(view.height)}` }, parts.join(""));
  return { svg, width, height, viewBox: view, hasText };
}
