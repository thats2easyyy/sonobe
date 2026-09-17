/**
 * Headless, deterministic layout ("flex-lite"): absolute positioning with anchors, sizing
 * modes (fixed / auto / grow / percent), and row / column / wrapping-grid containers with
 * spacing, padding, and 9-point alignment. See ARCHITECTURE.md §5.4.
 *
 * Widths are resolved for the whole tree first, then heights, so text can wrap at its final
 * width before auto heights hug it.
 */

import { finiteOr, toVec2, toVec4, type Vec2, type Vec4 } from "../math/vec.ts";
import type { TextMeasurer } from "../types.ts";
import { approximateTextMeasurer, DEFAULT_LINE_HEIGHT_FACTOR } from "./textMeasurer.ts";

export type SizeMode = "fixed" | "auto" | "grow" | "percent";
export type LayoutMode = "none" | "row" | "column" | "grid";
export type SpacingMode = "fixed" | "between" | "evenly";
export type LayoutAlignment =
  | "topLeft"
  | "top"
  | "topRight"
  | "left"
  | "center"
  | "right"
  | "bottomLeft"
  | "bottom"
  | "bottomRight";

/** Resolved runtime values the layout reads. Missing or invalid values use layer defaults. */
export interface LayoutProps {
  enabled?: boolean;
  position?: readonly number[];
  size?: readonly number[];
  anchor?: readonly number[];
  widthMode?: SizeMode | string;
  heightMode?: SizeMode | string;
  positioning?: "relative" | "absolute" | string;
  layout?: LayoutMode | string;
  spacingMode?: SpacingMode | string;
  spacing?: number;
  /** `[top, right, bottom, left]` or a single number. */
  padding?: number | readonly number[];
  alignment?: LayoutAlignment | string;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  lineHeight?: number;
  maxLines?: number;
  textTransform?: string;
  [key: string]: unknown;
}

export interface LayoutNode {
  key: string;
  type: string;
  props: LayoutProps;
  children?: readonly LayoutNode[];
}

export interface LayoutResult {
  /** Top-left relative to the parent's top-left, in points. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Extent of the node's content: children bounds (plus padding) for containers, measured text for text. */
  contentSize: [number, number];
}

const SIZE_MODES: readonly SizeMode[] = ["fixed", "auto", "grow", "percent"];
const LAYOUT_MODES: readonly LayoutMode[] = ["none", "row", "column", "grid"];
const SPACING_MODES: readonly SpacingMode[] = ["fixed", "between", "evenly"];
const ALIGNMENT_FACTORS: Record<LayoutAlignment, Vec2> = {
  topLeft: [0, 0],
  top: [0.5, 0],
  topRight: [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  bottomLeft: [0, 1],
  bottom: [0.5, 1],
  bottomRight: [1, 1],
};
const CONTAINER_TYPES = new Set(["group", "componentInstance", "shader"]);
const EPS = 1e-6;

interface Box {
  node: LayoutNode;
  children: Box[];
  isText: boolean;
  isFill: boolean;
  isContainer: boolean;
  enabled: boolean;
  absolute: boolean;
  position: Vec2;
  size: Vec2;
  anchor: Vec2;
  widthMode: SizeMode;
  heightMode: SizeMode;
  layout: LayoutMode;
  spacingMode: SpacingMode;
  spacing: number;
  padding: Vec4;
  align: Vec2;
  x: number;
  y: number;
  width: number;
  height: number;
  intrinsicWidth: number | undefined;
  intrinsicHeight: number | undefined;
  textCache: Map<string, { width: number; height: number }> | undefined;
  lines: Box[][];
  lineHeights: number[];
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function buildBox(node: LayoutNode): Box {
  const p: LayoutProps = node.props ?? {};
  const children = (node.children ?? []).map(buildBox);
  const isText = node.type === "text";
  const defaultMode: SizeMode = isText ? "auto" : "fixed";
  const size = toVec2(p.size, [100, 100]);
  return {
    node,
    children,
    isText,
    isFill: node.type === "colorFill",
    isContainer: !isText && (children.length > 0 || CONTAINER_TYPES.has(node.type)),
    enabled: p.enabled !== false,
    absolute: p.positioning === "absolute",
    position: toVec2(p.position, [0, 0]),
    size: [Math.max(0, size[0]), Math.max(0, size[1])],
    anchor: toVec2(p.anchor, [0, 0]),
    widthMode: enumOr(p.widthMode, SIZE_MODES, defaultMode),
    heightMode: enumOr(p.heightMode, SIZE_MODES, defaultMode),
    layout: enumOr(p.layout, LAYOUT_MODES, "none"),
    spacingMode: enumOr(p.spacingMode, SPACING_MODES, "fixed"),
    spacing: Math.max(0, finiteOr(p.spacing, 0)),
    padding: toVec4(p.padding, [0, 0, 0, 0]),
    align:
      ALIGNMENT_FACTORS[
        enumOr(p.alignment, Object.keys(ALIGNMENT_FACTORS) as LayoutAlignment[], "topLeft")
      ],
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    intrinsicWidth: undefined,
    intrinsicHeight: undefined,
    textCache: undefined,
    lines: [],
    lineHeights: [],
  };
}

/** Lays out children in the parent's flow (vs positioned by Position/Anchor). */
function inFlow(parent: Box, child: Box): boolean {
  return parent.layout !== "none" && child.enabled && !child.absolute && !child.isFill;
}

/** Counts toward a parent's hug size and content size. */
function contributes(child: Box): boolean {
  return child.enabled && !child.isFill;
}

function transformText(text: string, transform: unknown): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    default:
      return text;
  }
}

/** Main-axis offsets for children of the given sizes (relative to the inner start). */
function placeMain(
  sizes: readonly number[],
  inner: number,
  spacing: number,
  mode: SpacingMode,
  align: number,
): number[] {
  const n = sizes.length;
  let total = spacing * Math.max(0, n - 1);
  for (const s of sizes) total += s;
  const free = inner - total;
  let gap = spacing;
  let lead = free * align;
  if (free > 0 && n > 0) {
    if (mode === "between" && n > 1) {
      gap = spacing + free / (n - 1);
      lead = 0;
    } else if (mode === "evenly") {
      const g = free / (n + 1);
      gap = spacing + g;
      lead = g;
    }
  }
  const out: number[] = [];
  let cursor = lead;
  for (const s of sizes) {
    out.push(cursor);
    cursor += s + gap;
  }
  return out;
}

/**
 * Compute frames for a layer tree. The root fills `rootSize` at (0, 0) regardless of its own
 * size props; its layout props still arrange its children.
 */
export function computeLayout(
  root: LayoutNode,
  textMeasurer: TextMeasurer = approximateTextMeasurer,
  rootSize: readonly number[] = [390, 844],
): Map<string, LayoutResult> {
  const measureText = (box: Box, maxWidth: number | null): { width: number; height: number } => {
    const cacheKey = maxWidth === null ? "none" : String(maxWidth);
    const cached = box.textCache?.get(cacheKey);
    if (cached) return cached;
    const p = box.node.props ?? {};
    const fontSize = finiteOr(p.fontSize, 17);
    const lineHeight = finiteOr(p.lineHeight, 0);
    const style = {
      fontFamily: typeof p.fontFamily === "string" ? p.fontFamily : "Inter",
      fontSize,
      fontWeight: finiteOr(p.fontWeight, 400),
      letterSpacing: finiteOr(p.letterSpacing, 0),
      lineHeight,
    };
    const text = transformText(
      p.text === undefined || p.text === null ? "" : String(p.text),
      p.textTransform,
    );
    const measured = textMeasurer.measure(text, style, maxWidth);
    let height = measured.height;
    const maxLines = Math.floor(finiteOr(p.maxLines, 0));
    if (maxLines > 0) {
      const lh = lineHeight > 0 ? lineHeight : fontSize * DEFAULT_LINE_HEIGHT_FACTOR;
      height = Math.min(height, maxLines * lh);
    }
    const result = { width: Math.max(0, measured.width), height: Math.max(0, height) };
    (box.textCache ??= new Map()).set(cacheKey, result);
    return result;
  };

  const textSize = (box: Box) => measureText(box, box.widthMode === "auto" ? null : box.width);

  // ---- widths -------------------------------------------------------------

  const intrinsicWidth = (box: Box): number => {
    if (box.intrinsicWidth !== undefined) return box.intrinsicWidth;
    let w: number;
    if (box.widthMode === "fixed") w = box.size[0];
    else if (box.widthMode === "percent") w = 0;
    else if (box.isText) w = measureText(box, null).width;
    else if (box.isContainer) w = hugWidth(box);
    else w = box.size[0];
    box.intrinsicWidth = Math.max(0, w);
    return box.intrinsicWidth;
  };

  const hugBasisWidth = (c: Box) => (c.widthMode === "percent" ? 0 : intrinsicWidth(c));

  const hugWidth = (box: Box): number => {
    const pl = box.padding[3];
    const pr = box.padding[1];
    if (box.layout === "none") {
      let right = 0;
      for (const c of box.children) {
        if (!contributes(c)) continue;
        const cw = hugBasisWidth(c);
        right = Math.max(right, c.position[0] - c.anchor[0] * cw + cw);
      }
      return right;
    }
    const flow = box.children.filter((c) => inFlow(box, c));
    if (flow.length === 0) return pl + pr;
    let content = 0;
    if (box.layout === "column") {
      for (const c of flow) content = Math.max(content, hugBasisWidth(c));
    } else {
      for (const c of flow) content += hugBasisWidth(c);
      content += box.spacing * (flow.length - 1);
    }
    return content + pl + pr;
  };

  const independentWidth = (c: Box, inner: number): number => {
    switch (c.widthMode) {
      case "fixed":
        return c.size[0];
      case "percent":
        return (c.size[0] / 100) * inner;
      case "auto":
        return intrinsicWidth(c);
      case "grow":
        return inner;
    }
  };

  const layoutWidths = (box: Box, width: number): void => {
    box.width = Math.max(0, width);
    const innerW = Math.max(0, box.width - box.padding[1] - box.padding[3]);
    const hug = box.widthMode === "auto";
    const flow: Box[] = [];
    for (const c of box.children) {
      if (c.isFill) c.width = box.width;
      else if (inFlow(box, c)) flow.push(c);
      else c.width = independentWidth(c, innerW);
    }
    if (box.layout === "row") {
      let used = box.spacing * Math.max(0, flow.length - 1);
      const growers: Box[] = [];
      for (const c of flow) {
        if (c.widthMode === "grow" && !hug) {
          growers.push(c);
          continue;
        }
        c.width = c.widthMode === "grow" ? intrinsicWidth(c) : independentWidth(c, innerW);
        used += c.width;
      }
      const share = growers.length > 0 ? Math.max(0, innerW - used) / growers.length : 0;
      for (const g of growers) g.width = share;
    } else if (box.layout === "column") {
      for (const c of flow) c.width = independentWidth(c, innerW);
    } else if (box.layout === "grid") {
      const lines: Box[][] = [];
      let current: Box[] = [];
      let lineWidth = 0;
      for (const c of flow) {
        const w = c.widthMode === "grow" ? intrinsicWidth(c) : independentWidth(c, innerW);
        if (current.length > 0 && lineWidth + box.spacing + w > innerW + EPS) {
          lines.push(current);
          current = [];
          lineWidth = 0;
        }
        lineWidth += (current.length > 0 ? box.spacing : 0) + w;
        c.width = w;
        current.push(c);
      }
      if (current.length > 0) lines.push(current);
      if (!hug) {
        for (const line of lines) {
          const growers = line.filter((c) => c.widthMode === "grow");
          if (growers.length === 0) continue;
          let used = box.spacing * (line.length - 1);
          for (const c of line) used += c.width;
          const free = innerW - used;
          if (free > 0) for (const g of growers) g.width += free / growers.length;
        }
      }
      box.lines = lines;
    }
    for (const c of box.children) layoutWidths(c, c.width);
  };

  // ---- heights ------------------------------------------------------------

  const intrinsicHeight = (box: Box): number => {
    if (box.intrinsicHeight !== undefined) return box.intrinsicHeight;
    let h: number;
    if (box.heightMode === "fixed") h = box.size[1];
    else if (box.heightMode === "percent") h = 0;
    else if (box.isText) h = textSize(box).height;
    else if (box.isContainer) h = hugHeight(box);
    else h = box.size[1];
    box.intrinsicHeight = Math.max(0, h);
    return box.intrinsicHeight;
  };

  const hugBasisHeight = (c: Box) => (c.heightMode === "percent" ? 0 : intrinsicHeight(c));

  const hugHeight = (box: Box): number => {
    const pt = box.padding[0];
    const pb = box.padding[2];
    if (box.layout === "none") {
      let bottom = 0;
      for (const c of box.children) {
        if (!contributes(c)) continue;
        const ch = hugBasisHeight(c);
        bottom = Math.max(bottom, c.position[1] - c.anchor[1] * ch + ch);
      }
      return bottom;
    }
    const flow = box.children.filter((c) => inFlow(box, c));
    if (flow.length === 0) return pt + pb;
    let content = 0;
    if (box.layout === "row") {
      for (const c of flow) content = Math.max(content, hugBasisHeight(c));
    } else if (box.layout === "column") {
      for (const c of flow) content += hugBasisHeight(c);
      content += box.spacing * (flow.length - 1);
    } else {
      for (const line of box.lines) {
        let lineHeight = 0;
        for (const c of line) lineHeight = Math.max(lineHeight, hugBasisHeight(c));
        content += lineHeight;
      }
      content += box.spacing * Math.max(0, box.lines.length - 1);
    }
    return content + pt + pb;
  };

  const independentHeight = (c: Box, inner: number): number => {
    switch (c.heightMode) {
      case "fixed":
        return c.size[1];
      case "percent":
        return (c.size[1] / 100) * inner;
      case "auto":
        return intrinsicHeight(c);
      case "grow":
        return inner;
    }
  };

  const layoutHeights = (box: Box, height: number): void => {
    box.height = Math.max(0, height);
    const [pt, pr, pb, pl] = box.padding;
    const innerW = Math.max(0, box.width - pl - pr);
    const innerH = Math.max(0, box.height - pt - pb);
    const hug = box.heightMode === "auto";
    const [ax, ay] = box.align;
    const flow: Box[] = [];
    for (const c of box.children) {
      if (c.isFill) c.height = box.height;
      else if (inFlow(box, c)) flow.push(c);
      else c.height = independentHeight(c, innerH);
    }

    if (box.layout === "row") {
      for (const c of flow) c.height = independentHeight(c, innerH);
      const offsets = placeMain(
        flow.map((c) => c.width),
        innerW,
        box.spacing,
        box.spacingMode,
        ax,
      );
      flow.forEach((c, i) => {
        c.x = pl + offsets[i]!;
        c.y = pt + (innerH - c.height) * ay;
      });
    } else if (box.layout === "column") {
      let used = box.spacing * Math.max(0, flow.length - 1);
      const growers: Box[] = [];
      for (const c of flow) {
        if (c.heightMode === "grow" && !hug) {
          growers.push(c);
          continue;
        }
        c.height = c.heightMode === "grow" ? intrinsicHeight(c) : independentHeight(c, innerH);
        used += c.height;
      }
      const share = growers.length > 0 ? Math.max(0, innerH - used) / growers.length : 0;
      for (const g of growers) g.height = share;
      const offsets = placeMain(
        flow.map((c) => c.height),
        innerH,
        box.spacing,
        box.spacingMode,
        ay,
      );
      flow.forEach((c, i) => {
        c.y = pt + offsets[i]!;
        c.x = pl + (innerW - c.width) * ax;
      });
    } else if (box.layout === "grid") {
      box.lineHeights = [];
      for (const line of box.lines) {
        let lineHeight = 0;
        for (const c of line) {
          c.height = c.heightMode === "grow" ? intrinsicHeight(c) : independentHeight(c, innerH);
          lineHeight = Math.max(lineHeight, c.height);
        }
        for (const c of line) if (c.heightMode === "grow") c.height = lineHeight;
        box.lineHeights.push(lineHeight);
      }
      let blockHeight = box.spacing * Math.max(0, box.lines.length - 1);
      for (const h of box.lineHeights) blockHeight += h;
      let y = pt + (innerH - blockHeight) * ay;
      box.lines.forEach((line, li) => {
        const lineHeight = box.lineHeights[li]!;
        const offsets = placeMain(
          line.map((c) => c.width),
          innerW,
          box.spacing,
          box.spacingMode,
          ax,
        );
        line.forEach((c, i) => {
          c.x = pl + offsets[i]!;
          c.y = y + (lineHeight - c.height) * ay;
        });
        y += lineHeight + box.spacing;
      });
    }

    for (const c of box.children) {
      if (c.isFill) {
        c.x = 0;
        c.y = 0;
      } else if (!inFlow(box, c)) {
        c.x = c.position[0] - c.anchor[0] * c.width;
        c.y = c.position[1] - c.anchor[1] * c.height;
      }
    }
    for (const c of box.children) layoutHeights(c, c.height);
  };

  // ---- results ------------------------------------------------------------

  const contentSize = (box: Box): [number, number] => {
    if (box.isText) {
      const t = textSize(box);
      return [t.width, t.height];
    }
    if (!box.isContainer) return [box.width, box.height];
    const [pt, pr, pb, pl] = box.padding;
    const hasLayout = box.layout !== "none";
    let right = hasLayout ? pl : 0;
    let bottom = hasLayout ? pt : 0;
    for (const c of box.children) {
      if (!contributes(c)) continue;
      right = Math.max(right, c.x + c.width);
      bottom = Math.max(bottom, c.y + c.height);
    }
    if (hasLayout) {
      right += pr;
      bottom += pb;
    }
    return [Math.max(0, right), Math.max(0, bottom)];
  };

  const collect = (box: Box, out: Map<string, LayoutResult>): void => {
    out.set(box.node.key, {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      contentSize: contentSize(box),
    });
    for (const c of box.children) collect(c, out);
  };

  const rootBox = buildBox(root);
  rootBox.widthMode = "fixed";
  rootBox.heightMode = "fixed";
  const [rw, rh] = toVec2(rootSize, [0, 0]);
  layoutWidths(rootBox, rw);
  layoutHeights(rootBox, rh);
  const results = new Map<string, LayoutResult>();
  collect(rootBox, results);
  return results;
}
