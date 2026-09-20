/**
 * Node sizes without a DOM: a node's shape (nodeShape.ts) plus a text measurer gives the box the
 * patch editor draws, following its stylesheet (apps/editor/src/panels/patch-editor/patch-editor.css:
 * width max-content between 164 and 320, a 28 pt header, 22 pt rows; live values in slots as wide
 * as the longest text their type prints, in `ch`, or the room their row has under 320, and knob
 * values in slots at least as wide as their slider's longest value, or the room beside the knob's
 * name). The default measurer reads a table of SF Pro and SF Mono advances (nodeMetrics.ts); the
 * editor passes one that measures its real font, like the engine's TextMeasurer.
 *
 * When the node CSS changes, change NODE_BOX with it, regenerate the table with
 * `node apps/editor/scripts/measure-node-fonts.ts`, and run e2e/node-sizes.spec.ts.
 */

import { NODE_FONT_METRICS } from "./nodeMetrics.ts";
import { nodeShapeFromData, type NodeRowShape, type NodeShape, type NodeShapeOptions, type ValueChip } from "./nodeShape.ts";
import type { GraphNodeData } from "./types.ts";

/** Box model constants from patch-editor.css, in points. */
export const NODE_BOX = {
  minWidth: 164,
  maxWidth: 320,
  interfaceMinWidth: 140,
  header: 28,
  row: 22,
  /** .sb-pe-rows padding: 2 above the first row, 6 below the last. */
  rowsTop: 2,
  rowsBottom: 6,
  /** .sb-pe-rows--empty: a node without ports. */
  emptyRows: 6,
  /** Header: 8 each side, 6 between items, a 16 pt category icon. */
  headerPaddingX: 16,
  headerGap: 6,
  icon: 16,
  /** Port rows: 12 at the outer edge, 6 between a label and its value, 12 between the input and output halves. */
  portPadding: 12,
  portGap: 6,
  rowGap: 12,
  /** Inline values (.sb-pe-value): 5 each side, at most 110 wide. */
  valuePaddingX: 10,
  valueMaxWidth: 110,
  compactMin: 22,
  vectorGap: 2,
  check: 14,
  chevron: 10,
  valueInnerGap: 4,
  swatch: 10,
  /** Color values: 3 left, 5 right. */
  colorPadding: 8,
  /** Knob chips (K1): a 10 pt knob glyph before the name (color knobs end in a `swatch`). */
  knobIcon: 10,
  /**
   * Live values (.sb-pe-port__live): their reserve in `ch` (liveReserve) plus slotPad, no wider than
   * the row's liveRoom (but at least slotFloorChars) and 96. Knob values (.sb-pe-value__knob-value):
   * at least their reserve plus slotPad, or the chip's knobValueRoom (at least slotFloorChars).
   */
  liveMaxWidth: 96,
  slotPad: 0.5,
  slotFloorChars: 4,
  chipPaddingX: 10,
  loopMin: 16,
  /** Issue and jump badges: 18 wide with a -2 margin. */
  badge: 16,
  /** Presence chip: 5 left, 6 right, a 6 pt dot and a 4 pt gap. */
  workingPaddingX: 11,
  workingDot: 10,
  enterIcon: 11,
  /** "Drive…" on an undriven layer property: 6 padding and a 1 pt border each side. */
  driveButton: 14,
  /** Comment frames without a size. */
  comment: { width: 240, height: 120 },
} as const;

export const HEADER_HEIGHT = NODE_BOX.header;
export const ROW_HEIGHT = NODE_BOX.row;
export const NODE_MIN_WIDTH = NODE_BOX.minWidth;

/** The node fonts, as the stylesheet sets them (the metrics script and the editor's canvas measurer read this). */
export const NODE_FONTS = {
  title: { family: "sans", size: 12, weight: 600, letterSpacing: -0.06 },
  label: { family: "sans", size: 11, weight: 400 },
  chip: { family: "sans", size: 10, weight: 500 },
  badge: { family: "sans", size: 10, weight: 700 },
  working: { family: "sans", size: 10, weight: 600 },
  sans10: { family: "sans", size: 10, weight: 400 },
  italic10: { family: "sans", size: 10, weight: 400, italic: true },
  mono10: { family: "mono", size: 10, weight: 400 },
  comment: { family: "sans", size: 11, weight: 500 },
} as const satisfies Record<string, { family: "sans" | "mono"; size: number; weight: number; italic?: boolean; letterSpacing?: number }>;

export type NodeFont = keyof typeof NODE_FONTS;

/** Width of `text` in points in one of the node fonts. */
export type NodeTextMeasurer = (text: string, font: NodeFont) => number;

/** Sums per-character advances from the SF Pro / SF Mono table (no kerning). */
export const tableMeasurer: NodeTextMeasurer = (text, font) => {
  const m = NODE_FONT_METRICS[font];
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    width += code >= 32 && code <= 126 ? m.widths[code - 32]! : (m.extra[ch] ?? m.fallback);
  }
  return width;
};

export interface NodeSize {
  width: number;
  height: number;
}

/**
 * A slot `reserve` characters of the mono font wide, as the stylesheet sizes live values and knob
 * values: `calc(<reserve>ch + 0.5px)`, since N ch lays out a 64th of a point narrower than N glyphs
 * and a full-length value would end in "…". No wider than `room`, but at least slotFloorChars.
 */
function reservedSlot(reserve: number, t: NodeTextMeasurer, room = Infinity): number {
  const ch = t("0", "mono10");
  return Math.min(reserve * ch + NODE_BOX.slotPad, Math.max(room, NODE_BOX.slotFloorChars * ch));
}

/**
 * Points kept clear when a slot is capped to the room its labels leave (liveRoom, knobValueRoom),
 * so text the DOM lays out a hair wider than the measurer said doesn't cut a label or a name.
 */
const ROOM_SLACK = 2;

/** A row's width without its output's live value: the input half, the gap between the halves, the output's label. */
function rowWidth(r: NodeRowShape, measure: NodeTextMeasurer): number {
  const B = NODE_BOX;
  let w = 0;
  if (r.in) {
    w += B.portPadding + measure(r.in.label, "label");
    if (r.in.value) w += B.portGap + valueWidth(r.in.value, measure);
    if (r.in.drive) w += B.portGap + B.driveButton + measure("Drive…", "sans10");
  }
  if (r.out) w += B.rowGap + measure(r.out.label, "label") + B.portPadding;
  return w;
}

/**
 * The most points an output row's live value may take before the row passes the node's maximum
 * width, where its labels would have to give way: 320 less everything else in the row, which stays
 * put while the prototype runs, so a slot capped to it holds the node still with every label whole
 * (a value longer than the slot ends in "…"). At most the slot's own 96. The patch editor gets it as
 * PortModel.liveRoom (deriveGraph).
 */
export function liveRoom(row: NodeRowShape, measure: NodeTextMeasurer = tableMeasurer): number {
  return roomBeside(rowWidth(row, measure));
}

/** liveRoom from the row's width without its live value. */
function roomBeside(rowWidth: number): number {
  return Math.max(0, Math.min(NODE_BOX.liveMaxWidth, Math.floor(NODE_BOX.maxWidth - ROOM_SLACK - rowWidth - NODE_BOX.portGap)));
}

/**
 * A node's outputs' liveRoom, in order: a number for the outputs whose rows it caps (below 96),
 * undefined for the rest, and none for a collapsed node, which shows no live values.
 */
export function liveRooms(data: Exclude<GraphNodeData, { kind: "comment" }>, options: EstimateNodeSizeOptions = {}): (number | undefined)[] {
  const { measure = tableMeasurer, ...shapeOptions } = options;
  const shape = nodeShapeFromData(data, shapeOptions);
  if (shape.collapsed) return [];
  return data.outputs.map((_, i) => {
    const row = shape.rows[i]!;
    const room = liveRoom(row, measure);
    return room < NODE_BOX.liveMaxWidth ? room : undefined;
  });
}

/**
 * The points a knob chip has for its value beside the knob's whole name, when that's less than the
 * value's reserve (knobValueReserve) needs: the chip's 110 less its padding, glyph, gaps and name.
 * Undefined when the reserve fits. The patch editor gets it as PortModel.knob.valueRoom (deriveGraph),
 * so a long name stays whole and a value past the room pushes into it only while it's that long.
 */
export function knobValueRoom(knob: { name: string; valueReserve?: number }, measure: NodeTextMeasurer = tableMeasurer): number | undefined {
  if (!knob.valueReserve) return undefined;
  const B = NODE_BOX;
  const room = Math.max(0, Math.floor(B.valueMaxWidth - B.valuePaddingX - B.knobIcon - 2 * B.valueInnerGap - measure(knob.name, "sans10") - ROOM_SLACK));
  return room < reservedSlot(knob.valueReserve, measure) ? room : undefined;
}

/**
 * A knob chip's width: the name, then a color knob's swatch or the value text in a slot of its
 * reserve at least. A chip whose name leaves less room than that (knobValueRoom) is as wide as a
 * chip gets, 110, so a longer value pushes into the name instead of widening the node.
 */
function knobChipWidth(v: Extract<ValueChip, { kind: "knob" }>, t: NodeTextMeasurer): number {
  const B = NODE_BOX;
  const name = B.valuePaddingX + B.knobIcon + B.valueInnerGap + t(v.name, "sans10");
  if (v.swatch) return Math.min(B.valueMaxWidth, name + B.valueInnerGap + B.swatch);
  if (!v.text) return Math.min(B.valueMaxWidth, name);
  if (v.reserve && knobValueRoom({ name: v.name, valueReserve: v.reserve }, t) !== undefined) return B.valueMaxWidth;
  const text = t(v.text, "mono10");
  return Math.min(B.valueMaxWidth, name + B.valueInnerGap + (v.reserve ? Math.max(text, reservedSlot(v.reserve, t)) : text));
}

function valueWidth(v: ValueChip, t: NodeTextMeasurer): number {
  const B = NODE_BOX;
  const chip = (text: string, font: NodeFont, min = 0) => Math.min(B.valueMaxWidth, Math.max(min, B.valuePaddingX + t(text, font)));
  switch (v.kind) {
    case "number":
    case "static":
      return chip(v.text, "mono10");
    case "vector":
      return v.texts.reduce((sum, text, i) => sum + (i ? B.vectorGap : 0) + chip(text, "mono10", B.compactMin), 0);
    case "check":
      return B.check;
    case "menu":
      return Math.min(B.valueMaxWidth, B.valuePaddingX + t(v.text, "sans10") + B.valueInnerGap + B.chevron);
    case "color":
      return Math.min(B.valueMaxWidth, B.colorPadding + B.swatch + B.valueInnerGap + t(v.hex, "mono10"));
    case "text":
      return v.text ? chip(v.text, "sans10") : chip("Empty", "italic10");
    case "knob":
      return knobChipWidth(v, t);
  }
}

/** The node's box in patch editor points, as the patch editor draws it. */
export function measureNode(shape: NodeShape, measure: NodeTextMeasurer = tableMeasurer): NodeSize {
  const B = NODE_BOX;
  let header = B.headerPaddingX + B.icon + B.headerGap + measure(shape.title, "title");
  for (const c of shape.chips) {
    header += B.headerGap;
    if (c.kind === "chip") header += B.chipPaddingX + measure(c.text, "chip");
    else if (c.kind === "loop") header += Math.max(B.loopMin, B.chipPaddingX + Math.max(measure(c.text, "badge"), c.reserve ? measure(c.reserve, "badge") : 0));
    else if (c.kind === "working") header += B.workingPaddingX + B.workingDot + measure(c.text, "working");
    else if (c.kind === "badge") header += B.badge;
    else header += B.enterIcon;
  }
  let rows = 0;
  if (!shape.collapsed) {
    for (const r of shape.rows) {
      const w = rowWidth(r, measure);
      const slot = r.out?.reserve ? reservedSlot(r.out.reserve, measure, roomBeside(w)) : r.out?.live ? measure(r.out.live, "mono10") : 0;
      rows = Math.max(rows, w + (slot ? Math.min(B.liveMaxWidth, slot) + B.portGap : 0));
    }
  }
  const min = shape.collapsed ? 0 : shape.kind === "interface" ? B.interfaceMinWidth : B.minWidth;
  const width = Math.min(B.maxWidth, Math.max(min, Math.ceil(Math.max(header, rows))));
  const height = shape.collapsed ? B.header : B.header + (shape.rows.length ? B.rowsTop + shape.rows.length * B.row + B.rowsBottom : B.emptyRows);
  return { width, height };
}

/** Vertical center of a port's handle from the node's top: the i-th row, or the header when collapsed. */
export function portCenterY(shape: Pick<NodeShape, "collapsed">, index: number): number {
  if (shape.collapsed) return NODE_BOX.header / 2;
  return NODE_BOX.header + NODE_BOX.rowsTop + index * NODE_BOX.row + NODE_BOX.row / 2;
}

export interface EstimateNodeSizeOptions extends NodeShapeOptions {
  measure?: NodeTextMeasurer;
}

/** A node's size before (or without) the patch editor measuring it: comments keep their frame, other nodes are measured from their shape. */
export function estimateNodeSize(data: GraphNodeData, options: EstimateNodeSizeOptions = {}): NodeSize {
  if (data.kind === "comment") return { ...NODE_BOX.comment };
  const { measure, ...shapeOptions } = options;
  return measureNode(nodeShapeFromData(data, shapeOptions), measure);
}
