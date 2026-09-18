/**
 * Figma → design capture, for the Sonobe Capture Figma plugin (integrations/figma-plugin). Maps a
 * selection of Figma nodes onto the same capture format the DOM walker writes, so a frame pastes into
 * Sonobe through the same converter as a web page.
 *
 * - Frames, groups, components and instances become frames (fills, gradients, image fills, strokes,
 *   radii, drop shadows, blurs, clipping). Rectangles and circles become childless frames.
 * - Text becomes text (font, size, weight, line height, letter spacing, alignment, case, decoration).
 * - Vectors, booleans, stars, polygons, lines and ellipses that aren't circles are exported as SVG images.
 * - Designer-chosen layer names come along; default names ("Frame 12") count as generic.
 *
 * Nodes are structural (FigmaNodeLike), so this runs in tests without the plugin API. The plugin
 * provides exportSvg and imageData.
 */

import type { Box, CaptureBorder, CaptureFrame, CaptureGradient, CaptureImage, CaptureNode, CaptureShadow, CaptureText, CaptureTextStyle, DesignCapture, ImageFit } from "./capture.ts";
import { CAPTURE_FORMAT, CAPTURE_VERSION } from "./constants.ts";
import { clampRadii, toHex } from "./css.ts";

export interface FigmaRgb {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export type FigmaTransform = [[number, number, number], [number, number, number]];

export interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaRgb;
  gradientStops?: readonly { position: number; color: FigmaRgb }[];
  gradientTransform?: FigmaTransform;
  imageHash?: string | null;
  scaleMode?: string;
}

export interface FigmaEffect {
  type: string;
  visible?: boolean;
  radius?: number;
  spread?: number;
  offset?: { x: number; y: number };
  color?: FigmaRgb;
}

/** The parts of a Figma SceneNode this mapping reads. Values Figma reports as `figma.mixed` are symbols. */
export interface FigmaNodeLike {
  type: string;
  name: string;
  visible?: boolean;
  width: number;
  height: number;
  absoluteTransform: FigmaTransform;
  opacity?: number;
  blendMode?: string;
  isMask?: boolean;
  children?: readonly FigmaNodeLike[];
  fills?: readonly FigmaPaint[] | symbol;
  strokes?: readonly FigmaPaint[];
  strokeWeight?: number | symbol;
  strokeTopWeight?: number;
  strokeRightWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  cornerRadius?: number | symbol;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  effects?: readonly FigmaEffect[];
  clipsContent?: boolean;
  // Text
  characters?: string;
  fontName?: { family: string; style: string } | symbol;
  fontSize?: number | symbol;
  fontWeight?: number | symbol;
  lineHeight?: { unit: string; value?: number } | symbol;
  letterSpacing?: { unit: string; value: number } | symbol;
  textAlignHorizontal?: string;
  textCase?: string | symbol;
  textDecoration?: string | symbol;
  textAutoResize?: string;
}

export interface FigmaCaptureDeps {
  /** SVG of a node as a data: URL (node.exportAsync({ format: "SVG" })). */
  exportSvg(node: FigmaNodeLike): Promise<string | null>;
  /** An image fill's bytes as a data: URL (figma.getImageByHash(hash).getBytesAsync()). */
  imageData(hash: string): Promise<string | null>;
}

const round2 = (n: number) => Math.round(n * 100) / 100 || 0;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const GENERIC_NAME = /^(?:Frame|Rectangle|Ellipse|Group|Vector|Line|Polygon|Star|Text|Image|Union|Subtract|Intersect|Exclude|Component|Instance|Section|Auto layout|Container)(?:\s+\d+)?$/i;

const BLEND_MODES: Record<string, string> = {
  MULTIPLY: "multiply", SCREEN: "screen", OVERLAY: "overlay", DARKEN: "darken", LIGHTEN: "lighten", COLOR_DODGE: "colorDodge", COLOR_BURN: "colorBurn",
  HARD_LIGHT: "hardLight", SOFT_LIGHT: "softLight", DIFFERENCE: "difference", EXCLUSION: "exclusion", HUE: "hue", SATURATION: "saturation", COLOR: "color", LUMINOSITY: "luminosity",
  PLUS_DARKER: "plusDarker", PLUS_LIGHTER: "plusLighter",
};

function colorHex(c: FigmaRgb | undefined, opacity = 1): string {
  if (!c) return "#00000000";
  return toHex(c.r * 255, c.g * 255, c.b * 255, (c.a ?? 1) * opacity);
}

const visiblePaints = (paints: readonly FigmaPaint[] | symbol | undefined): FigmaPaint[] => (Array.isArray(paints) ? paints.filter((p) => p.visible !== false && (p.opacity ?? 1) > 0) : []);

function invert(t: FigmaTransform): FigmaTransform {
  const [[a, b, c], [d, e, f]] = t;
  const det = a * e - b * d || 1e-9;
  return [
    [e / det, -b / det, (b * f - c * e) / det],
    [-d / det, a / det, (c * d - a * f) / det],
  ];
}

const apply = (t: FigmaTransform, x: number, y: number): [number, number] => [t[0][0] * x + t[0][1] * y + t[0][2], t[1][0] * x + t[1][1] * y + t[1][2]];

/** A Figma gradient in a w × h node → CaptureGradient (start/end normalized to the node). */
export function figmaGradient(paint: FigmaPaint, w: number, h: number): CaptureGradient | null {
  if (!paint.gradientStops?.length || !paint.gradientTransform) return null;
  const opacity = paint.opacity ?? 1;
  const stops = paint.gradientStops.map((s) => [round2(Math.max(0, Math.min(1, s.position))), colorHex(s.color, opacity)] as [number, string]);
  const inv = invert(paint.gradientTransform);
  const r4 = (n: number) => Math.round(n * 10000) / 10000 || 0;
  if (paint.type === "GRADIENT_LINEAR") {
    const start = apply(inv, 0, 0.5);
    const end = apply(inv, 1, 0.5);
    return { kind: "linear", stops, start: [r4(start[0]), r4(start[1])], end: [r4(end[0]), r4(end[1])] };
  }
  const center = apply(inv, 0.5, 0.5);
  if (paint.type === "GRADIENT_RADIAL" || paint.type === "GRADIENT_DIAMOND") {
    const horizontal = apply(inv, 1, 0.5);
    const vertical = apply(inv, 0.5, 1);
    const rx = Math.hypot((horizontal[0] - center[0]) * w, (horizontal[1] - center[1]) * h);
    const ry = Math.hypot((vertical[0] - center[0]) * w, (vertical[1] - center[1]) * h);
    const out: CaptureGradient = { kind: "radial", stops, start: [r4(center[0]), r4(center[1])], end: [r4(center[0]), r4(center[1] + (h > 0 ? ry / h : 0))] };
    if (ry > 0 && Math.abs(rx / ry - 1) > 0.001) out.ratio = r4(rx / ry);
    return out;
  }
  if (paint.type === "GRADIENT_ANGULAR") {
    const end = apply(inv, 1, 0.5);
    return { kind: "angular", stops, start: [r4(center[0]), r4(center[1])], end: [r4(end[0]), r4(end[1])] };
  }
  return null;
}

const FIT: Record<string, ImageFit> = { FILL: "cover", CROP: "cover", FIT: "contain", TILE: "tile", STRETCH: "stretch" };

interface Walk {
  origin: [number, number];
  deps: FigmaCaptureDeps;
  images: DesignCapture["images"];
  imageKeys: Map<string, string>;
  notes: Set<string>;
  nodes: number;
}

async function imageKey(walk: Walk, id: string, load: () => Promise<string | null>, name: string, size?: [number, number]): Promise<string | null> {
  const existing = walk.imageKeys.get(id);
  if (existing) return existing;
  const url = await load();
  if (!url) return null;
  const key = `img${walk.imageKeys.size + 1}`;
  walk.imageKeys.set(id, key);
  walk.images[key] = { url, name: name.slice(0, 60), ...(size ? { width: Math.round(size[0]), height: Math.round(size[1]) } : {}) };
  return key;
}

/** The untransformed box and rotation of a node, in the capture root's coordinates. */
function placement(walk: Walk, node: FigmaNodeLike): { box: Box; rotation?: number } {
  const t = node.absoluteTransform;
  const [cx, cy] = apply(t, node.width / 2, node.height / 2);
  const rotation = round2((Math.atan2(t[1][0], t[0][0]) * 180) / Math.PI);
  const box: Box = [round2(cx - node.width / 2 - walk.origin[0]), round2(cy - node.height / 2 - walk.origin[1]), round2(node.width), round2(node.height)];
  return Math.abs(rotation) >= 0.01 ? { box, rotation } : { box };
}

function base(walk: Walk, node: FigmaNodeLike) {
  const { box, rotation } = placement(walk, node);
  const out: { name: string; nameRank: number; box: Box; opacity?: number; rotation?: number; blendMode?: string } = { name: node.name, nameRank: GENERIC_NAME.test(node.name.trim()) ? 0 : 5, box };
  if (isNumber(node.opacity) && node.opacity < 1) out.opacity = round2(node.opacity);
  if (rotation !== undefined) out.rotation = rotation;
  const blend = node.blendMode ? BLEND_MODES[node.blendMode] : undefined;
  if (blend) out.blendMode = blend;
  return out;
}

function radii(node: FigmaNodeLike): [number, number, number, number] | undefined {
  const r: [number, number, number, number] = isNumber(node.cornerRadius) ? [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius] : [node.topLeftRadius ?? 0, node.topRightRadius ?? 0, node.bottomRightRadius ?? 0, node.bottomLeftRadius ?? 0];
  if (node.type === "ELLIPSE") {
    const circle = Math.min(node.width, node.height) / 2;
    return [circle, circle, circle, circle];
  }
  return r.some((x) => x > 0) ? (clampRadii(r, node.width, node.height).map(round2) as [number, number, number, number]) : undefined;
}

function border(node: FigmaNodeLike): CaptureBorder | undefined {
  const stroke = visiblePaints(node.strokes).find((p) => p.type === "SOLID");
  if (!stroke) return undefined;
  const all = isNumber(node.strokeWeight) ? node.strokeWeight : undefined;
  const widths: [number, number, number, number] = [node.strokeTopWeight ?? all ?? 0, node.strokeRightWeight ?? all ?? 0, node.strokeBottomWeight ?? all ?? 0, node.strokeLeftWeight ?? all ?? 0];
  if (widths.every((w) => w <= 0)) return undefined;
  const color = colorHex(stroke.color, stroke.opacity ?? 1);
  return { widths: widths.map(round2) as CaptureBorder["widths"], colors: [color, color, color, color] };
}

function effects(node: FigmaNodeLike): { shadows?: CaptureShadow[]; blur?: number; backgroundBlur?: number } {
  const out: { shadows?: CaptureShadow[]; blur?: number; backgroundBlur?: number } = {};
  const shadows: CaptureShadow[] = [];
  for (const e of (node.effects ?? []).filter((x) => x.visible !== false)) {
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      shadows.push({ x: round2(e.offset?.x ?? 0), y: round2(e.offset?.y ?? 0), blur: round2(e.radius ?? 0), spread: round2(e.spread ?? 0), color: colorHex(e.color), ...(e.type === "INNER_SHADOW" ? { inset: true } : {}) });
    } else if (e.type === "LAYER_BLUR") out.blur = round2((e.radius ?? 0) / 2);
    else if (e.type === "BACKGROUND_BLUR") out.backgroundBlur = round2((e.radius ?? 0) / 2);
  }
  // Figma lists effects bottom first; captures list shadows front first, like CSS.
  if (shadows.length) out.shadows = shadows.reverse();
  return out;
}

async function frameNode(walk: Walk, node: FigmaNodeLike): Promise<CaptureNode[]> {
  walk.nodes++;
  const frame: CaptureFrame = { kind: "frame", ...base(walk, node), children: [] };
  const [, , w, h] = frame.box;
  const paints = visiblePaints(node.fills);
  if (node.fills !== undefined && !Array.isArray(node.fills)) walk.notes.add("Some layers mixed several fills per character range; they use none.");
  const imageLayers: CaptureImage[] = [];
  for (const paint of paints) {
    if (paint.type === "SOLID") {
      const color = colorHex(paint.color, paint.opacity ?? 1);
      if (!frame.fill && !frame.gradients && !imageLayers.length) frame.fill = color;
      else (frame.gradients ??= []).push({ kind: "linear", stops: [[0, color], [1, color]], start: [0.5, 0], end: [0.5, 1] });
    } else if (paint.type.startsWith("GRADIENT_")) {
      const g = figmaGradient(paint, w, h);
      if (g) (frame.gradients ??= []).push(g);
    } else if (paint.type === "IMAGE" && paint.imageHash) {
      const hash = paint.imageHash;
      const key = await imageKey(walk, `hash:${hash}`, () => walk.deps.imageData(hash), node.name);
      if (key) imageLayers.push({ kind: "image", name: node.name, nameRank: 1, image: key, fit: FIT[paint.scaleMode ?? "FILL"] ?? "cover", box: frame.box, ...(radii(node) ? { radii: radii(node)! } : {}) });
    }
  }
  const r = radii(node);
  if (r) frame.radii = r;
  const b = border(node);
  if (b) frame.border = b;
  Object.assign(frame, effects(node));
  if (node.clipsContent) frame.clip = true;
  frame.children.push(...imageLayers);
  for (const child of node.children ?? []) frame.children.push(...(await visit(walk, child)));
  if (node.type === "GROUP" && !frame.fill && !frame.gradients && !frame.border && !frame.shadows) frame.keep = frame.nameRank === 5;
  else frame.keep = true;
  return [frame];
}

function textStyle(node: FigmaNodeLike, notes: Set<string>): CaptureTextStyle {
  const mixed = [node.fontName, node.fontSize, node.fontWeight, node.lineHeight, node.letterSpacing, node.textCase, node.textDecoration].some((v) => typeof v === "symbol") || !Array.isArray(node.fills);
  if (mixed) notes.add("Text with several styles in one layer uses its first style.");
  const fontName = typeof node.fontName === "object" ? node.fontName : { family: "Inter", style: "Regular" };
  const fontSize = isNumber(node.fontSize) ? node.fontSize : 16;
  const fill = visiblePaints(node.fills).find((p) => p.type === "SOLID");
  const style: CaptureTextStyle = { fontFamily: fontName.family, fontSize: round2(fontSize), fontWeight: isNumber(node.fontWeight) ? node.fontWeight : /bold/i.test(fontName.style) ? 700 : 400, color: fill ? colorHex(fill.color, fill.opacity ?? 1) : "#000000FF" };
  if (/italic|oblique/i.test(fontName.style)) style.italic = true;
  const lh = typeof node.lineHeight === "object" ? node.lineHeight : undefined;
  if (lh?.unit === "PIXELS" && isNumber(lh.value)) style.lineHeight = round2(lh.value);
  else if (lh?.unit === "PERCENT" && isNumber(lh.value)) style.lineHeight = round2((fontSize * lh.value) / 100);
  const ls = typeof node.letterSpacing === "object" ? node.letterSpacing : undefined;
  if (ls && ls.value) style.letterSpacing = round2(ls.unit === "PERCENT" ? (fontSize * ls.value) / 100 : ls.value);
  const align = ({ CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" } as Record<string, CaptureTextStyle["align"]>)[node.textAlignHorizontal ?? ""];
  if (align) style.align = align;
  if (node.textCase === "UPPER") style.transform = "uppercase";
  else if (node.textCase === "LOWER") style.transform = "lowercase";
  else if (node.textCase === "TITLE") style.transform = "capitalize";
  if (node.textDecoration === "UNDERLINE") style.decoration = "underline";
  else if (node.textDecoration === "STRIKETHROUGH") style.decoration = "strikethrough";
  return style;
}

function textNode(walk: Walk, node: FigmaNodeLike): CaptureText {
  walk.nodes++;
  const text = node.characters ?? "";
  const out: CaptureText = { kind: "text", ...base(walk, node), text, style: textStyle(node, walk.notes) };
  // A text layer keeps its designer-given name only when someone renamed it from its content.
  if (out.name === text || !out.name?.trim()) out.nameRank = 1;
  if (node.textAutoResize !== "WIDTH_AND_HEIGHT") out.wraps = true;
  if (node.textAutoResize === "TRUNCATE") out.maxLines = 1;
  return out;
}

async function vectorNode(walk: Walk, node: FigmaNodeLike): Promise<CaptureNode[]> {
  walk.nodes++;
  const key = await imageKey(walk, `node:${walk.nodes}:${node.name}`, () => walk.deps.exportSvg(node), node.name, [node.width, node.height]);
  if (!key) return [];
  return [{ kind: "image", ...base(walk, node), image: key, fit: "stretch" }];
}

async function visit(walk: Walk, node: FigmaNodeLike): Promise<CaptureNode[]> {
  if (node.visible === false) return [];
  if (node.isMask) {
    walk.notes.add("Masks aren't imported; the layers they masked show in full.");
    return [];
  }
  switch (node.type) {
    case "TEXT":
      return [textNode(walk, node)];
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "STAR":
    case "POLYGON":
    case "LINE":
      return vectorNode(walk, node);
    case "ELLIPSE":
      // A circle is a round frame (so an avatar keeps its image fill); other ellipses and arcs export as SVG.
      return Math.abs(node.width - node.height) < 0.5 ? frameNode(walk, node) : vectorNode(walk, node);
    case "RECTANGLE":
    case "FRAME":
    case "GROUP":
    case "COMPONENT":
    case "COMPONENT_SET":
    case "INSTANCE":
    case "SECTION":
      return frameNode(walk, node);
    default:
      walk.notes.add(`Layers of type ${node.type.toLowerCase().replace(/_/g, " ")} aren't imported.`);
      return [];
  }
}

/** A capture of the selected Figma nodes. One frame becomes the screen; several are wrapped in one. */
export async function figmaToCapture(selection: readonly FigmaNodeLike[], deps: FigmaCaptureDeps, source: { title?: string } = {}): Promise<DesignCapture> {
  const nodes = selection.filter((n) => n.visible !== false);
  if (nodes.length === 0) throw new Error("Select a frame or layers to copy for Sonobe.");
  const corners = nodes.flatMap((n) => [apply(n.absoluteTransform, 0, 0), apply(n.absoluteTransform, n.width, 0), apply(n.absoluteTransform, 0, n.height), apply(n.absoluteTransform, n.width, n.height)]);
  const left = Math.min(...corners.map((c) => c[0]));
  const top = Math.min(...corners.map((c) => c[1]));
  const right = Math.max(...corners.map((c) => c[0]));
  const bottom = Math.max(...corners.map((c) => c[1]));
  const walk: Walk = { origin: [left, top], deps, images: {}, imageKeys: new Map(), notes: new Set(), nodes: 0 };
  let root: CaptureFrame;
  const single = nodes.length === 1 ? nodes[0]! : null;
  if (single && ["FRAME", "COMPONENT", "INSTANCE", "SECTION", "GROUP"].includes(single.type)) {
    root = (await frameNode(walk, single))[0] as CaptureFrame;
  } else {
    const children: CaptureNode[] = [];
    for (const node of nodes) children.push(...(await visit(walk, node)));
    root = { kind: "frame", name: single?.name ?? "Figma Selection", nameRank: 5, box: [0, 0, round2(right - left), round2(bottom - top)], children };
  }
  root.keep = true;
  return {
    format: CAPTURE_FORMAT,
    version: CAPTURE_VERSION,
    source: { kind: "figma", ...(source.title ? { title: source.title } : {}), generator: "sonobe-figma/0.1.0" },
    viewport: { width: round2(Math.max(1, right - left)), height: round2(Math.max(1, bottom - top)) },
    root,
    images: walk.images,
    ...(walk.notes.size ? { notes: [...walk.notes] } : {}),
    stats: { elements: walk.nodes, nodes: walk.nodes },
  };
}
