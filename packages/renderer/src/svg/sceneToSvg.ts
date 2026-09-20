/**
 * sceneToSvg: a faithful static SVG of a SceneFrame, for screenshots without a browser (MCP headless
 * hosts rasterize it). It follows the DOM renderer's drawing rules:
 *
 * - layers nest like the scene, each placed with the transform its worldTransform implies (3D
 *   rotations and perspective flatten to 2D), with opacity, blend mode and filters on the group
 * - siblings draw in paint order: zPosition first, then layer order (the engine's paintOrder)
 * - fills, gradients (linear, radial, angular), corner radii and smooth corners, clipping via clipPath
 * - strokes inside, centered or outside the edge; shape layers with trimmed strokes
 * - shadows as box shadows on visible fills, else drop shadows of the content; blur and layer effects
 * - text with font props, alignment, wrapping and truncation using headless text metrics
 * - images as data URIs when `resolveAsset` can load them; placeholders for video and shaders
 * - optional hit-target overlays
 *
 * DOM-free: runs in Node, browsers and workers.
 */

import type { Color, GradientStop, GradientValue } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { paintOrder } from "@sonobe/engine";
import { squirclePath, type CornerRadii } from "../squircle.ts";
import { graphemes } from "../textMeasurer.ts";
import { parseColor, propReader, readGradient, readLayerRef, readNumber, readShapePath, readVec, type PropReader } from "../values.ts";
import { affineAttr, affineFromMat4, IDENTITY_AFFINE, intersectRect, invertAffine, multiplyAffine, padRect, transformRect, unionRect, type Affine, type Rect } from "./affine.ts";
import { pathDataLength } from "./pathLength.ts";
import { approximateTextWidth, textLineHeight, truncateLines, wrapText, type SvgTextStyle, type TextWidth } from "./text.ts";
import { el, escapeText, num, paintAttrs, type Attrs } from "./xml.ts";

export type SvgRect = Rect;

export interface SvgAsset {
  /** A data: URL (or another href the rasterizer can load). */
  href: string;
  /** Natural size in points, used by the Tile fill mode. */
  width?: number;
  height?: number;
}

export interface SceneToSvgOptions {
  /** Media for image layers (an asset id or a URL) → a loadable href. Without it, only data: URLs draw. */
  resolveAsset?: (ref: { assetId?: string; url?: string }) => SvgAsset | string | null | undefined;
  /** Output pixels per point (default 1). */
  scale?: number;
  /** What's behind the prototype: a Color, "#RRGGBBAA", or null for transparent. Default: the frame's background. */
  background?: Color | string | null;
  /** The region to draw, in prototype points (default: the whole frame). Content outside the screen draws too. */
  crop?: SvgRect;
  /** Tint touch targets: true for hit areas, or also layers by scene key or layer id. */
  showHitTargets?: boolean | Iterable<string>;
  /** Text width measurement (default: the engine's approximate metrics, which headless layout uses). */
  textWidth?: TextWidth;
}

export interface SvgRender {
  svg: string;
  /** Output size in pixels. */
  width: number;
  height: number;
  /** The drawn region in prototype points. */
  viewBox: SvgRect;
  /** Some text was drawn, so a rasterizer needs fonts. */
  hasText: boolean;
  /** What the drawing approximates or leaves out, in plain words. */
  notes: string[];
}

interface Ctx {
  defs: string[];
  next: number;
  notes: Set<string>;
  hasText: boolean;
  options: SceneToSvgOptions;
  hitAreas: boolean;
  hitKeys: Set<string>;
  viewport: Rect;
  byKey: Map<string, SceneNode>;
  byLayer: Map<string, SceneNode>;
  cloneDepth: number;
  /** World bounds of each subtree plus how far its shadows and blurs reach beyond them (cached). */
  extents: Map<SceneNode, { bounds: Rect | null; spread: number }>;
  /** Maps original world coordinates to where a clone draws them (null outside clones). */
  rebase: Affine | null;
}

type Radii = [number, number, number, number];
const ZERO: Radii = [0, 0, 0, 0];

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0);
const size = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0);
const finite = (n: unknown, fallback = 0) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
const newId = (ctx: Ctx, prefix: string) => `${prefix}${ctx.next++}`;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Geometry = { kind: "rect"; w: number; h: number; r: number } | { kind: "ellipse"; w: number; h: number } | { kind: "path"; d: string };

/** Corner radii [topLeft, topRight, bottomRight, bottomLeft]: cornerRadii when it rounds any corner, else cornerRadius. */
function readRadii(p: PropReader): Radii {
  const raw = p.raw("cornerRadii");
  if (Array.isArray(raw) && raw.length > 0) {
    const radii = readVec(raw, 4, ZERO).map((r) => Math.max(0, r)) as Radii;
    if (radii.some((r) => r > 0)) return radii;
  }
  const r = Math.max(0, p.num("cornerRadius", 0));
  return [r, r, r, r];
}

function boxGeometry(shape: "box" | "ellipse", w: number, h: number, radii: Radii, smoothing: number): Geometry {
  if (shape === "ellipse") return { kind: "ellipse", w, h };
  if (radii.every((r) => r <= 0)) return { kind: "rect", w, h, r: 0 };
  if (smoothing <= 0 && radii.every((r) => r === radii[0])) return { kind: "rect", w, h, r: Math.min(radii[0], w / 2, h / 2) };
  return { kind: "path", d: squirclePath(0, 0, w, h, radii as CornerRadii, smoothing) };
}

function geometryEl(g: Geometry, attrs: Attrs): string {
  switch (g.kind) {
    case "rect":
      return el("rect", { width: g.w, height: g.h, rx: g.r > 0 ? g.r : null, ...attrs });
    case "ellipse":
      return el("ellipse", { cx: g.w / 2, cy: g.h / 2, rx: g.w / 2, ry: g.h / 2, ...attrs });
    case "path":
      return el("path", { d: g.d, ...attrs });
  }
}

const ellipsePath = (cx: number, cy: number, rx: number, ry: number) =>
  `M ${num(cx - rx)} ${num(cy)} A ${num(rx)} ${num(ry)} 0 1 0 ${num(cx + rx)} ${num(cy)} A ${num(rx)} ${num(ry)} 0 1 0 ${num(cx - rx)} ${num(cy)} Z`;

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

const sortStops = (stops: readonly GradientStop[]) => [...stops].sort((a, b) => a.offset - b.offset);

function stopsMarkup(stops: readonly GradientStop[]): string {
  return sortStops(stops)
    .map((s) => el("stop", { offset: num(clamp01(s.offset), 4), ...paintAttrs(s.color, "stop") }))
    .join("");
}

function colorAt(stops: readonly GradientStop[], t: number): Color {
  const sorted = sortStops(stops);
  if (t <= sorted[0]!.offset) return sorted[0]!.color;
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i]!;
    if (t > b.offset) continue;
    const a = sorted[i - 1]!;
    const span = b.offset - a.offset;
    const k = span > 0 ? (t - a.offset) / span : 1;
    const mix = (x: number, y: number) => x + (y - x) * k;
    return { r: mix(a.color.r, b.color.r), g: mix(a.color.g, b.color.g), b: mix(a.color.b, b.color.b), a: mix(a.color.a, b.color.a) };
  }
  return sorted[sorted.length - 1]!.color;
}

/** A linear or radial gradient def in a w × h box; null when it collapses to a solid color. */
function gradientDef(ctx: Ctx, g: GradientValue, w: number, h: number): string | null {
  const sx = g.start[0] * w;
  const sy = g.start[1] * h;
  const ex = g.end[0] * w;
  const ey = g.end[1] * h;
  const len = Math.hypot(ex - sx, ey - sy);
  const id = newId(ctx, "grad");
  if (g.kind === "radial") {
    const ratio = typeof g.ratio === "number" && g.ratio > 0 ? g.ratio : 1;
    ctx.defs.push(
      el(
        "radialGradient",
        { id, gradientUnits: "userSpaceOnUse", cx: sx, cy: sy, r: Math.max(len, 0.001), gradientTransform: ratio !== 1 ? `translate(${num(sx)} ${num(sy)}) scale(${num(ratio, 4)} 1) translate(${num(-sx)} ${num(-sy)})` : null },
        stopsMarkup(g.stops),
      ),
    );
    return id;
  }
  if (len === 0) return null;
  ctx.defs.push(el("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: sx, y1: sy, x2: ex, y2: ey }, stopsMarkup(g.stops)));
  return id;
}

/** An angular (conic) gradient as thin wedges clipped to the shape. */
function angularFill(ctx: Ctx, geometry: Geometry, g: GradientValue, w: number, h: number): string {
  const clip = newId(ctx, "clip");
  ctx.defs.push(el("clipPath", { id: clip }, geometryEl(geometry, {})));
  const sx = g.start[0] * w;
  const sy = g.start[1] * h;
  const dx = g.end[0] * w - sx;
  const dy = g.end[1] * h - sy;
  const base = Math.hypot(dx, dy) > 0 ? Math.atan2(dx, -dy) : 0;
  const R = Math.hypot(w, h) * 2 + 1;
  const N = 90;
  const wedges: string[] = [];
  for (let i = 0; i < N; i++) {
    const a0 = base + (2 * Math.PI * i) / N;
    const a1 = base + (2 * Math.PI * (i + 1)) / N + 0.004;
    const fill = paintAttrs(colorAt(g.stops, (i + 0.5) / N), "fill");
    if (!fill) continue;
    wedges.push(el("path", { d: `M ${num(sx)} ${num(sy)} L ${num(sx + R * Math.sin(a0))} ${num(sy - R * Math.cos(a0))} L ${num(sx + R * Math.sin(a1))} ${num(sy - R * Math.cos(a1))} Z`, ...fill }));
  }
  return el("g", { "clip-path": `url(#${clip})` }, wedges.join(""));
}

/** A shape filled with a color or a gradient ("" when nothing is visible). */
function paintGeometry(ctx: Ctx, geometry: Geometry, color: Color | null, gradient: GradientValue | null, w: number, h: number): string {
  if (gradient) {
    if (!gradient.stops.some((s) => s.color.a > 0)) return "";
    const stops = sortStops(gradient.stops);
    if (stops.length === 1) return geometryEl(geometry, { ...paintAttrs(stops[0]!.color, "fill") });
    if (gradient.kind === "angular") return angularFill(ctx, geometry, gradient, w, h);
    const id = gradientDef(ctx, gradient, w, h);
    if (id === null) {
      const last = paintAttrs(stops[stops.length - 1]!.color, "fill");
      return last ? geometryEl(geometry, last) : "";
    }
    return geometryEl(geometry, { fill: `url(#${id})` });
  }
  const fill = paintAttrs(color, "fill");
  return fill ? geometryEl(geometry, fill) : "";
}

// ---------------------------------------------------------------------------
// Shadows, filters, strokes
// ---------------------------------------------------------------------------

interface Shadow {
  color: Color;
  opacity: number;
  dx: number;
  dy: number;
  radius: number;
}

function readShadow(p: PropReader): Shadow | null {
  const opacity = clamp01(p.num("shadowOpacity", 0));
  if (opacity <= 0) return null;
  const color = p.color("shadowColor");
  if (!color || color.a <= 0) return null;
  const [dx, dy] = p.vec("shadowOffset", 2, [0, 0]);
  return { color, opacity, dx: finite(dx), dy: finite(dy), radius: Math.max(0, p.num("shadowRadius", 0)) };
}

/**
 * A CSS box-shadow: the blurred shape behind the fill, drawn only outside the shape when the fill is
 * see-through. A shadow whose blur region misses the drawn area is left out: resvg panics on a filter
 * whose region doesn't meet the canvas.
 */
function boxShadowEl(ctx: Ctx, geometry: Geometry, s: Shadow, w: number, h: number, fillOpaque: boolean, world: Affine): string {
  const std = s.radius / 2;
  const pad = std * 3 + 2;
  const reach = transformRect(world, { x: s.dx - pad, y: s.dy - pad, width: w + pad * 2, height: h + pad * 2 });
  if (!intersectRect(ctx.rebase ? transformRect(ctx.rebase, reach) : reach, ctx.viewport)) return "";
  const attrs: Attrs = { ...paintAttrs(s.color, "fill", s.opacity), transform: s.dx || s.dy ? `translate(${num(s.dx)} ${num(s.dy)})` : null };
  if (std > 0) {
    const blur = newId(ctx, "blur");
    ctx.defs.push(el("filter", { id: blur, filterUnits: "userSpaceOnUse", x: -pad, y: -pad, width: w + pad * 2, height: h + pad * 2 }, el("feGaussianBlur", { stdDeviation: num(std) })));
    attrs.filter = `url(#${blur})`;
  }
  const shape = geometryEl(geometry, attrs);
  if (fillOpaque) return shape;
  const mask = newId(ctx, "mask");
  const region = { x: Math.min(0, s.dx) - pad, y: Math.min(0, s.dy) - pad, width: w + Math.abs(s.dx) + pad * 2, height: h + Math.abs(s.dy) + pad * 2 };
  ctx.defs.push(el("mask", { id: mask, maskUnits: "userSpaceOnUse", ...region }, el("rect", { ...region, fill: "#ffffff" }) + geometryEl(geometry, { fill: "#000000" })));
  return el("g", { mask: `url(#${mask})` }, shape);
}

/** SVG filter primitives for layer effects (from effect patches). */
function effectPrimitives(ctx: Ctx, raw: unknown): { primitives: string[]; spread: number } {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "__loop" in raw
      ? [...((raw as { items?: readonly unknown[] }).items ?? [])]
      : raw
        ? [raw]
        : [];
  const primitives: string[] = [];
  let spread = 0;
  const transfer = (fn: Attrs) => el("feComponentTransfer", {}, ["feFuncR", "feFuncG", "feFuncB"].map((f) => el(f, fn)).join(""));
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const { kind, params = {} } = item as { kind?: unknown; params?: Record<string, unknown> };
    const n = (key: string, fallback: number) => readNumber(params[key], fallback);
    switch (kind) {
      case "blur": {
        const r = Math.max(0, n("radius", 0));
        if (r > 0) primitives.push(el("feGaussianBlur", { stdDeviation: num(r) }));
        spread += r * 3;
        break;
      }
      case "colorControls": {
        const brightness = n("brightness", 0);
        const contrast = n("contrast", 1);
        const saturation = n("saturation", 1);
        const hue = n("hue", 0);
        if (brightness !== 0) primitives.push(transfer({ type: "linear", slope: num(1 + brightness, 4) }));
        if (contrast !== 1) primitives.push(transfer({ type: "linear", slope: num(contrast, 4), intercept: num(0.5 - 0.5 * contrast, 4) }));
        if (saturation !== 1) primitives.push(el("feColorMatrix", { type: "saturate", values: num(Math.max(0, saturation), 4) }));
        if (hue !== 0) primitives.push(el("feColorMatrix", { type: "hueRotate", values: num(hue, 3) }));
        break;
      }
      case "invert": {
        const a = clamp01(n("amount", 1));
        primitives.push(transfer({ type: "table", tableValues: `${num(a, 4)} ${num(1 - a, 4)}` }));
        break;
      }
      case "grayscale":
        primitives.push(el("feColorMatrix", { type: "saturate", values: num(1 - clamp01(n("amount", 1)), 4) }));
        break;
      case "sepia": {
        const k = 1 - clamp01(n("amount", 1));
        const m = [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0, 0, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0, 0, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k, 0, 0, 0, 0, 0, 1, 0];
        primitives.push(el("feColorMatrix", { type: "matrix", values: m.map((v) => num(v, 4)).join(" ") }));
        break;
      }
      case "shadow": {
        const color = parseColor(params.color) ?? { r: 0, g: 0, b: 0, a: 1 };
        const std = Math.max(0, n("radius", 0)) / 2;
        const dx = n("offsetX", 0);
        const dy = n("offsetY", 0);
        primitives.push(el("feDropShadow", { dx: num(dx), dy: num(dy), stdDeviation: num(std), ...paintAttrs(color, "flood", clamp01(n("opacity", 1))) }));
        spread += std * 3 + Math.max(Math.abs(dx), Math.abs(dy));
        break;
      }
      default:
        if (typeof kind === "string") ctx.notes.add(`The "${kind}" layer effect isn't drawn in headless screenshots.`);
    }
  }
  return { primitives, spread };
}

/** World-space bounds of a node and its visible descendants. */
function subtreeBounds(node: SceneNode): Rect | null {
  let out: Rect | null = null;
  const visit = (n: SceneNode) => {
    if (n.visible === false) return;
    const w = size(n.width);
    const h = size(n.height);
    const m = affineFromMat4(n.worldTransform, w, h);
    if (m) out = unionRect(out, transformRect(m, { x: 0, y: 0, width: w, height: h }));
    for (const child of n.children ?? []) visit(child);
  };
  visit(node);
  return out;
}

/**
 * A subtree's world bounds and how far its effects reach past them, for culling what's off the
 * drawn region. Culling also keeps rasterizers away from far off-canvas layers, which some panic on.
 */
function extentOf(ctx: Ctx, node: SceneNode): { bounds: Rect | null; spread: number } {
  const cached = ctx.extents.get(node);
  if (cached) return cached;
  const w = size(node.width);
  const h = size(node.height);
  const m = affineFromMat4(node.worldTransform, w, h);
  let bounds: Rect | null = m ? transformRect(m, { x: 0, y: 0, width: w, height: h }) : null;
  const props = node.props ?? {};
  const [dx, dy] = readVec(props.shadowOffset, 2, [0, 0]);
  let spread = Math.max(0, readNumber(props.shadowRadius, 0)) * 1.5 + Math.max(Math.abs(finite(dx)), Math.abs(finite(dy))) + Math.max(0, readNumber(props.blur, 0)) * 3 + (props.effects ? 96 : 0) + 4;
  for (const child of node.children ?? []) {
    const e = extentOf(ctx, child);
    if (e.bounds) bounds = unionRect(bounds, e.bounds);
    spread = Math.max(spread, e.spread);
  }
  const extent = { bounds, spread };
  ctx.extents.set(node, extent);
  return extent;
}

function offscreen(ctx: Ctx, node: SceneNode): boolean {
  if (node.type === "clone") return false;
  const { bounds, spread } = extentOf(ctx, node);
  if (!bounds) return false;
  const placed = ctx.rebase ? transformRect(ctx.rebase, bounds) : bounds;
  return !intersectRect(padRect(placed, spread), ctx.viewport);
}

/** The layer's filter chain (blur, effects, drop shadow) with a region that covers what it draws. */
function layerFilter(ctx: Ctx, node: SceneNode, p: PropReader, dropShadow: Shadow | null, world: Affine): string | undefined {
  const primitives: string[] = [];
  let spread = 2;
  const blur = Math.max(0, p.num("blur", 0));
  if (blur > 0) {
    primitives.push(el("feGaussianBlur", { stdDeviation: num(blur) }));
    spread += blur * 3;
  }
  const effects = p.raw("effects");
  if (effects) {
    const r = effectPrimitives(ctx, effects);
    primitives.push(...r.primitives);
    spread += r.spread;
  }
  if (dropShadow) {
    const std = dropShadow.radius / 2;
    primitives.push(el("feDropShadow", { dx: num(dropShadow.dx), dy: num(dropShadow.dy), stdDeviation: num(std), ...paintAttrs(dropShadow.color, "flood", dropShadow.opacity) }));
    spread += std * 3 + Math.max(Math.abs(dropShadow.dx), Math.abs(dropShadow.dy));
  }
  if (!primitives.length) return undefined;
  const inverse = invertAffine(world);
  const bounds = subtreeBounds(node);
  if (!inverse || !bounds) return undefined;
  const padded = padRect(bounds, spread);
  const visible = ctx.cloneDepth > 0 ? padded : intersectRect(padded, padRect(ctx.viewport, spread));
  if (!visible) return undefined;
  const region = transformRect(inverse, visible);
  const id = newId(ctx, "fx");
  ctx.defs.push(el("filter", { id, filterUnits: "userSpaceOnUse", x: region.x, y: region.y, width: region.width, height: region.height, "color-interpolation-filters": "sRGB" }, primitives.join("")));
  return `url(#${id})`;
}

/** The common border: an even-odd ring between the outer and inner outline. */
function strokeRing(p: PropReader, shape: "box" | "ellipse", radii: Radii, smoothing: number, w: number, h: number): string {
  const sw = Math.max(0, p.num("strokeWidth", 0));
  const fill = paintAttrs(p.color("strokeColor"), "fill");
  if (!(sw > 0) || !fill) return "";
  const position = p.str("strokePosition", "inside");
  const outset = position === "center" ? sw / 2 : position === "outside" ? sw : 0;
  const inset = sw - outset;
  let d: string;
  if (shape === "ellipse") {
    d = ellipsePath(w / 2, h / 2, w / 2 + outset, h / 2 + outset);
    if (w / 2 - inset > 0 && h / 2 - inset > 0) d += ` ${ellipsePath(w / 2, h / 2, w / 2 - inset, h / 2 - inset)}`;
  } else {
    d = squirclePath(-outset, -outset, w + outset * 2, h + outset * 2, radii.map((r) => (r > 0 ? r + outset : 0)) as unknown as CornerRadii, smoothing);
    if (w - inset * 2 > 0 && h - inset * 2 > 0) d += ` ${squirclePath(inset, inset, w - inset * 2, h - inset * 2, radii.map((r) => Math.max(0, r - inset)) as unknown as CornerRadii, smoothing)}`;
  }
  return el("path", { d, ...fill, "fill-rule": "evenodd" });
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const TEXT_TRANSFORMS = new Set(["uppercase", "lowercase", "capitalize"]);
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

function readTextStyle(p: PropReader): SvgTextStyle {
  const transform = p.str("textTransform", "none");
  return {
    fontFamily: p.str("fontFamily", "Inter"),
    fontSize: Math.max(0, p.num("fontSize", 17)),
    fontWeight: p.num("fontWeight", 400),
    letterSpacing: p.num("letterSpacing", 0),
    lineHeight: Math.max(0, p.num("lineHeight", 0)),
    italic: p.bool("italic", false),
    textTransform: TEXT_TRANSFORMS.has(transform) ? (transform as SvgTextStyle["textTransform"]) : "none",
  };
}

/** A font-family list with system fallbacks, quoted with single quotes so it fits an XML attribute. */
function fontFamilyAttr(family: string): string {
  const names = [...family.split(","), "Inter", "Helvetica Neue", "Helvetica", "Arial"].map((s) => s.trim().replace(/["'\\]/g, "")).filter(Boolean);
  const unique = [...new Set(names)].map((n) => (GENERIC_FAMILIES.has(n.toLowerCase()) ? n : `'${n}'`));
  return [...unique, "sans-serif"].join(", ");
}

function textMarkup(ctx: Ctx, lines: readonly string[], style: SvgTextStyle, color: Color | null, align: string, valign: string, w: number, h: number, decoration: string | null): string {
  const fill = paintAttrs(color, "fill");
  if (!fill || style.fontSize <= 0 || !lines.some((l) => l.length)) return "";
  ctx.hasText = true;
  const lh = textLineHeight(style);
  const total = lines.length * lh;
  const top = valign === "center" ? (h - total) / 2 : valign === "bottom" ? h - total : 0;
  const x = align === "center" ? w / 2 : align === "right" ? w : 0;
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : null;
  // The baseline sits about 0.35 em below the middle of each line box for typical UI fonts.
  const tspans = lines.map((line, i) => el("tspan", { x, y: top + i * lh + lh / 2 + style.fontSize * 0.35 }, escapeText(line))).join("");
  return el(
    "text",
    {
      "font-family": fontFamilyAttr(style.fontFamily),
      "font-size": num(style.fontSize),
      "font-weight": String(Math.min(900, Math.max(100, Math.round(finite(style.fontWeight, 400))))),
      "font-style": style.italic ? "italic" : null,
      "letter-spacing": style.letterSpacing ? num(style.letterSpacing) : null,
      "text-anchor": anchor,
      "text-decoration": decoration,
      "xml:space": "preserve",
      ...fill,
    },
    tspans,
  );
}

const DECORATIONS: Record<string, string> = { underline: "underline", strikethrough: "line-through" };

function textLayer(ctx: Ctx, node: SceneNode, p: PropReader, w: number, h: number): string {
  const style = readTextStyle(p);
  const measure = ctx.options.textWidth;
  const maxWidth = p.str("widthMode", "auto") === "auto" ? null : w;
  const wrapped = wrapText(p.str("text", ""), style, maxWidth, measure);
  const lines = truncateLines(wrapped, Math.max(0, Math.floor(p.num("maxLines", 0))), p.str("truncation", "end"), maxWidth, style, measure ?? approximateTextWidth);
  return textMarkup(ctx, lines, style, p.color("textColor"), p.str("textAlignment", "left"), p.str("verticalAlignment", "top"), w, h, DECORATIONS[p.str("textDecoration", "none")] ?? null);
}

function textFieldLayer(ctx: Ctx, p: PropReader, w: number, h: number): string {
  const style = readTextStyle(p);
  const value = p.str("text", "");
  const multiline = p.bool("multiline", false);
  const empty = value === "";
  const shown = empty ? p.str("placeholder", "") : p.bool("secure", false) ? "•".repeat(graphemes(value).length) : value;
  const single = multiline ? shown : shown.replace(/\r\n|\r|\n/g, " ");
  const lines = wrapText(single, style, multiline ? w : null, ctx.options.textWidth);
  return textMarkup(ctx, lines, style, empty ? p.color("placeholderColor") : p.color("textColor"), p.str("textAlignment", "left"), multiline ? "top" : "center", w, h, null);
}

/** An image or video value as an asset reference: AssetRef, { asset } literal, or a URL. */
function readMediaRef(v: unknown): { assetId?: string; url?: string } | null {
  if (typeof v === "string") return v ? { url: v } : null;
  if (v && typeof v === "object") {
    const o = v as { assetId?: unknown; url?: unknown; asset?: unknown };
    if (typeof o.url === "string" && o.url) return { url: o.url };
    const id = typeof o.assetId === "string" ? o.assetId : typeof o.asset === "string" ? o.asset : null;
    if (id) return { assetId: id };
  }
  return null;
}

function resolveMedia(ctx: Ctx, ref: { assetId?: string; url?: string }): SvgAsset | null {
  const resolved = ctx.options.resolveAsset?.(ref);
  if (resolved) return typeof resolved === "string" ? { href: resolved } : resolved;
  return ref.url?.startsWith("data:") ? { href: ref.url } : null;
}

function imageLayer(ctx: Ctx, node: SceneNode, p: PropReader, w: number, h: number): string {
  const ref = readMediaRef(p.raw("image"));
  if (!ref) return "";
  const asset = resolveMedia(ctx, ref);
  if (!asset) {
    ctx.notes.add(`Image "${node.layerId}" isn't drawn: its file couldn't be loaded.`);
    return "";
  }
  const mode = p.str("fillMode", "fill");
  if (mode === "tile" && asset.width && asset.height) {
    const pattern = newId(ctx, "tile");
    ctx.defs.push(el("pattern", { id: pattern, patternUnits: "userSpaceOnUse", width: asset.width, height: asset.height }, el("image", { width: asset.width, height: asset.height, href: asset.href, preserveAspectRatio: "none" })));
    return el("rect", { width: w, height: h, fill: `url(#${pattern})` });
  }
  const fit = mode === "fit" ? "xMidYMid meet" : mode === "stretch" ? "none" : "xMidYMid slice";
  return el("image", { width: w, height: h, href: asset.href, preserveAspectRatio: fit });
}

function shapeLayer(ctx: Ctx, node: SceneNode, p: PropReader, w: number, h: number): string {
  const d = readShapePath(p.raw("shape"));
  if (!d) return "";
  const gradient = readGradient(node.props?.gradient);
  let behind = "";
  let fill: Attrs = { fill: "none" };
  if (gradient && gradient.stops.some((s) => s.color.a > 0)) {
    const stops = sortStops(gradient.stops);
    if (gradient.kind === "angular" && stops.length > 1) behind = angularFill(ctx, { kind: "path", d }, gradient, w, h);
    else {
      const id = stops.length > 1 ? gradientDef(ctx, gradient, w, h) : null;
      fill = id ? { fill: `url(#${id})` } : (paintAttrs(stops[stops.length - 1]!.color, "fill") ?? fill);
    }
  } else {
    fill = paintAttrs(p.color("color"), "fill") ?? fill;
  }
  const sw = Math.max(0, p.num("strokeWidth", 0));
  const strokeColor = paintAttrs(p.color("strokeColor"), "stroke");
  const start = clamp01(p.num("strokeStart", 0));
  const end = clamp01(p.num("strokeEnd", 1));
  let stroke: Attrs = {};
  if (sw > 0 && strokeColor && end > start) {
    stroke = { ...strokeColor, "stroke-width": num(sw), "stroke-linecap": p.str("lineCap", "round"), "stroke-linejoin": p.str("lineJoin", "round") };
    if (start > 0 || end < 1) {
      const length = pathDataLength(d);
      if (length > 0) {
        stroke["stroke-dasharray"] = `${num((end - start) * length)} ${num(length * 2 + sw * 2 + 1)}`;
        stroke["stroke-dashoffset"] = num(-start * length);
      }
    }
  }
  if (fill.fill === "none" && !stroke.stroke) return behind;
  return behind + el("path", { d, ...fill, ...stroke });
}

function placeholder(w: number, h: number, kind: "video" | "shader"): string {
  const back = el("rect", { width: w, height: h, fill: kind === "video" ? "#1C1C1E" : "#3A3A3C" });
  if (kind === "shader") return back;
  const s = Math.min(w, h) * 0.22;
  if (s < 4) return back;
  const cx = w / 2;
  const cy = h / 2;
  return back + el("path", { d: `M ${num(cx - s * 0.4)} ${num(cy - s * 0.5)} L ${num(cx + s * 0.55)} ${num(cy)} L ${num(cx - s * 0.4)} ${num(cy + s * 0.5)} Z`, fill: "#FFFFFF", "fill-opacity": 0.85 });
}

const BLEND_MODES: Record<string, string> = {
  multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken", lighten: "lighten",
  colorDodge: "color-dodge", colorBurn: "color-burn", hardLight: "hard-light", softLight: "soft-light",
  difference: "difference", exclusion: "exclusion", hue: "hue", saturation: "saturation", color: "color",
  luminosity: "luminosity", plusDarker: "color-burn", plusLighter: "screen",
};

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function findNode(ctx: Ctx, ref: { layerId: string; instance?: number }): SceneNode | undefined {
  const key = ref.instance !== undefined ? `${ref.layerId}#${ref.instance}` : ref.layerId;
  return ctx.byKey.get(key) ?? ctx.byLayer.get(ref.layerId);
}

/**
 * One layer as a group placed relative to its parent group. `parentWorld` is the parent's world
 * transform; a clone's copied root draws at the clone's origin instead (`cloneRoot`).
 */
function renderNode(ctx: Ctx, node: SceneNode, parentWorld: Affine, cloneRoot = false): string {
  const p = propReader(node.type, node.props ?? {});
  if (!cloneRoot && (node.visible === false || !p.bool("enabled", true))) return "";
  const w = size(node.width);
  const h = size(node.height);
  const world = affineFromMat4(node.worldTransform, w, h) ?? multiplyAffine(parentWorld, affineFromMat4(node.transform, w, h) ?? [1, 0, 0, 1, finite(node.x), finite(node.y)]);
  let local: Affine = IDENTITY_AFFINE;
  if (!cloneRoot) {
    const inverse = invertAffine(parentWorld);
    if (!inverse) return "";
    local = multiplyAffine(inverse, world);
  }
  const opacity = cloneRoot ? 1 : clamp01(readNumber(node.opacity, 1));
  if (opacity <= 0 || offscreen(ctx, node)) return "";

  let shape: "box" | "ellipse" | "none" = "none";
  let radii: Radii = ZERO;
  let smoothing = 0;
  let clip = false;
  let shadowOnBox = false;
  let stroke = false;
  let fillOpaque = false;
  let content = "";
  let children: readonly SceneNode[] = node.children ?? [];

  switch (node.type) {
    case "group":
    case "rectangle":
    case "oval":
    case "colorFill":
    case "gradient":
    case "componentInstance": {
      const ellipse = node.type === "oval";
      shape = ellipse ? "ellipse" : "box";
      radii = ellipse || node.type === "colorFill" || node.type === "componentInstance" ? ZERO : readRadii(p);
      smoothing = ellipse ? 0 : clamp01(p.num("cornerSmoothing", 0));
      if (node.type === "group" || node.type === "componentInstance") clip = typeof node.clip === "boolean" ? node.clip : p.bool("clip", false);
      const color = node.type === "gradient" || node.type === "componentInstance" ? null : p.color("color");
      const gradient = readGradient(node.type === "gradient" ? p.raw("gradient") : node.props?.gradient);
      content = paintGeometry(ctx, boxGeometry(shape, w, h, radii, smoothing), color, gradient, w, h);
      shadowOnBox = gradient ? gradient.stops.some((s) => s.color.a > 0) : !!color && color.a > 0;
      fillOpaque = gradient ? gradient.stops.every((s) => s.color.a >= 1) : !!color && color.a >= 1;
      stroke = node.type === "group" || node.type === "rectangle" || node.type === "oval";
      break;
    }
    case "text":
      content = textLayer(ctx, node, p, w, h);
      break;
    case "textField":
      content = textFieldLayer(ctx, p, w, h);
      break;
    case "image":
      shape = "box";
      radii = readRadii(p);
      smoothing = clamp01(p.num("cornerSmoothing", 0));
      clip = true;
      stroke = true;
      content = imageLayer(ctx, node, p, w, h);
      break;
    case "video":
    case "shader":
      shape = "box";
      radii = readRadii(p);
      smoothing = clamp01(p.num("cornerSmoothing", 0));
      clip = true;
      shadowOnBox = true;
      fillOpaque = true;
      content = placeholder(w, h, node.type);
      ctx.notes.add(node.type === "video" ? "Video layers show a dark placeholder: headless screenshots can't play video." : "Shader layers show a gray placeholder: headless screenshots don't run GPU shaders.");
      break;
    case "lottie":
      ctx.notes.add("Lottie layers aren't drawn in headless screenshots.");
      break;
    case "shape":
      content = shapeLayer(ctx, node, p, w, h);
      break;
    case "clone": {
      children = [];
      const ref = readLayerRef(p.raw("source"));
      const source = ref ? findNode(ctx, ref) : undefined;
      const sourceWorld = source ? affineFromMat4(source.worldTransform, size(source.width), size(source.height)) : null;
      const toClone = sourceWorld ? invertAffine(sourceWorld) : null;
      if (source && toClone && source.key !== node.key && ctx.cloneDepth < 4) {
        const previous = ctx.rebase;
        ctx.rebase = multiplyAffine(previous ? multiplyAffine(previous, world) : world, toClone);
        ctx.cloneDepth++;
        content = renderNode(ctx, source, IDENTITY_AFFINE, true);
        ctx.cloneDepth--;
        ctx.rebase = previous;
      }
      break;
    }
    default:
      break;
  }

  const geometry = shape === "none" ? null : boxGeometry(shape, w, h, radii, smoothing);
  let inner = content + paintOrder(children).map((child) => renderNode(ctx, child, world)).join("");
  if (clip && geometry && inner) {
    const id = newId(ctx, "clip");
    ctx.defs.push(el("clipPath", { id }, geometryEl(geometry, {})));
    inner = el("g", { "clip-path": `url(#${id})` }, inner);
  }
  const squircle = shape === "box" && smoothing > 0 && radii.some((r) => r > 0);
  const shadow = readShadow(p);
  const boxShadow = !!shadow && shadowOnBox && !squircle && geometry !== null;
  const shadowMarkup = boxShadow ? boxShadowEl(ctx, geometry!, shadow!, w, h, fillOpaque, world) : "";
  const strokeMarkup = stroke && shape !== "none" ? strokeRing(p, shape as "box" | "ellipse", radii, smoothing, w, h) : "";
  const showHit = (ctx.hitAreas && node.type === "hitArea") || ctx.hitKeys.has(node.key) || ctx.hitKeys.has(node.layerId);
  const overlay = showHit
    ? geometryEl(geometry ?? boxGeometry("box", w, h, ZERO, 0), { fill: "#7C5CFF", "fill-opacity": 0.2 }) + el("rect", { x: 0.5, y: 0.5, width: Math.max(0, w - 1), height: Math.max(0, h - 1), fill: "none", stroke: "#7C5CFF", "stroke-opacity": 0.8, "stroke-width": 1 })
    : "";
  const body = shadowMarkup + inner + strokeMarkup + overlay;
  if (!body) return "";
  if (p.num("backgroundBlur", 0) > 0) ctx.notes.add("Background blur isn't drawn: frosted layers show only their own fill.");
  const filter = layerFilter(ctx, node, p, boxShadow ? null : shadow, world);
  const blend = BLEND_MODES[p.str("blendMode", "normal")];
  return el("g", { "data-layer": node.key, transform: affineAttr(local), opacity: opacity < 1 ? num(opacity, 4) : null, filter, style: blend ? `mix-blend-mode:${blend}` : null }, body);
}

/** Visit every scene node, parents first. */
export function walkSceneNodes(frame: SceneFrame, visit: (node: SceneNode) => void): void {
  const go = (nodes: readonly SceneNode[]) => {
    for (const n of nodes) {
      visit(n);
      if (n.children?.length) go(n.children);
    }
  };
  go(frame.roots ?? []);
}

/** A scene node by scene key ("card#2", "like_button/heart"), else the first node for that layer id. */
export function findSceneNode(frame: SceneFrame, target: string): SceneNode | undefined {
  let byLayer: SceneNode | undefined;
  let byKey: SceneNode | undefined;
  walkSceneNodes(frame, (n) => {
    if (!byKey && n.key === target) byKey = n;
    if (!byLayer && n.layerId === target) byLayer = n;
  });
  return byKey ?? byLayer;
}

/** A node's own box in prototype coordinates (axis-aligned around its transformed corners). */
export function sceneNodeBounds(node: SceneNode): SvgRect | null {
  const w = size(node.width);
  const h = size(node.height);
  const m = affineFromMat4(node.worldTransform, w, h);
  return m ? transformRect(m, { x: 0, y: 0, width: w, height: h }) : null;
}

/** Draw a SceneFrame as SVG, with the output size and notes about what it approximates. */
export function renderSceneSvg(frame: SceneFrame, options: SceneToSvgOptions = {}): SvgRender {
  const fw = size(frame.size?.[0]);
  const fh = size(frame.size?.[1]);
  const crop = options.crop ?? { x: 0, y: 0, width: fw, height: fh };
  const viewBox = { x: finite(crop.x), y: finite(crop.y), width: Math.max(finite(crop.width), 1e-3), height: Math.max(finite(crop.height), 1e-3) };
  const scale = typeof options.scale === "number" && options.scale > 0 && Number.isFinite(options.scale) ? options.scale : 1;
  const width = Math.max(1, Math.round(viewBox.width * scale));
  const height = Math.max(1, Math.round(viewBox.height * scale));
  const hit = options.showHitTargets;
  const ctx: Ctx = {
    defs: [],
    next: 0,
    notes: new Set(),
    hasText: false,
    options,
    hitAreas: !!hit,
    hitKeys: new Set(hit && typeof hit !== "boolean" ? [...hit] : []),
    viewport: viewBox,
    byKey: new Map(),
    byLayer: new Map(),
    cloneDepth: 0,
    extents: new Map(),
    rebase: null,
  };
  walkSceneNodes(frame, (n) => {
    ctx.byKey.set(n.key, n);
    if (!ctx.byLayer.has(n.layerId)) ctx.byLayer.set(n.layerId, n);
  });
  const content = paintOrder(frame.roots ?? []).map((n) => renderNode(ctx, n, IDENTITY_AFFINE)).join("");
  const background = options.background === undefined ? parseColor(frame.background) : options.background === null ? null : parseColor(options.background);
  const backdrop = background ? paintAttrs(background, "fill") : null;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${num(viewBox.x)} ${num(viewBox.y)} ${num(viewBox.width)} ${num(viewBox.height)}" preserveAspectRatio="none">` +
    (ctx.defs.length ? `<defs>${ctx.defs.join("")}</defs>` : "") +
    (backdrop ? el("rect", { ...viewBox, ...backdrop }) : "") +
    content +
    "</svg>";
  if (ctx.hasText && !options.textWidth) ctx.notes.add("Text uses approximate font metrics, so line breaks can differ slightly from the app.");
  return { svg, width, height, viewBox, hasText: ctx.hasText, notes: [...ctx.notes] };
}

/** Draw a SceneFrame as an SVG string (see renderSceneSvg for size and notes). */
export function sceneToSvg(frame: SceneFrame, options: SceneToSvgOptions = {}): string {
  return renderSceneSvg(frame, options).svg;
}
