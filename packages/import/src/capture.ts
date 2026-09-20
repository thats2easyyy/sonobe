/**
 * The design capture format: a JSON snapshot of a rendered design (boxes, fills, borders, shadows,
 * text, images, text fields) that `planImport` turns into Sonobe layers. The DOM walker writes it from
 * any web page (a running app, HTML Claude wrote, a site in Chrome); a Figma plugin can write the same
 * format, so every source goes through one converter.
 *
 * Units are CSS pixels, which Sonobe treats as points. Every box is `[x, y, width, height]` in the
 * capture root's coordinates: the root sits at [0, 0], and a child's box is not relative to its
 * parent. Colors are `"#RRGGBBAA"`, like document literals.
 */

import { z } from "zod";
import { CAPTURE_FORMAT, CAPTURE_VERSION } from "./constants.ts";

export { CAPTURE_FORMAT, CAPTURE_VERSION };

export type Box = [number, number, number, number];

/** Where a layer came from, for names, re-imports, and people reading the layer list. */
export interface CaptureSource {
  /** Lowercase tag name ("button", "img"). */
  tag?: string;
  /** Framework component that rendered the element ("PricingCard"). */
  component?: string;
  /** The element's id attribute. */
  id?: string;
  /** data-testid. */
  testId?: string;
}

interface CaptureNodeBase {
  /** Display name (explicit data-name, component name, aria-label, semantic role...). */
  name?: string;
  /**
   * How much to trust `name`: 0 generic ("Group"), 1 semantic tag, 2 id or test id, 3 aria-label, 4 component, 5 explicit.
   * Text named by its words is 1; text named by the element holding it takes that element's rank.
   */
  nameRank?: number;
  box: Box;
  /** 0..1. Default 1. */
  opacity?: number;
  /** Degrees clockwise about the box center. */
  rotation?: number;
  /** Uniform scale about the box center. */
  scale?: number;
  /** Sonobe blend mode key ("multiply"). */
  blendMode?: string;
  /** Gaussian blur radius. */
  blur?: number;
  source?: CaptureSource;
  /** People tap or click it (a button, a link, a control, cursor: pointer). */
  interactive?: boolean;
}

export interface CaptureShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset?: boolean;
}

export interface CaptureGradient {
  kind: "linear" | "radial" | "angular";
  /** [offset 0..1, color]. */
  stops: [number, string][];
  /** Normalized points in the node's box (see GradientValue in @sonobe/core). */
  start: [number, number];
  end: [number, number];
  /** Horizontal stretch of a radial gradient. */
  ratio?: number;
}

export type ImageFit = "cover" | "contain" | "stretch" | "tile";

export interface CaptureBorder {
  /** [top, right, bottom, left]. */
  widths: [number, number, number, number];
  colors: [string, string, string, string];
}

/** A box: a background, a border, children. Becomes a Group (or a Rectangle when it has no children). */
export interface CaptureFrame extends CaptureNodeBase {
  kind: "frame";
  /** Solid background. */
  fill?: string;
  /** Gradients painted over the fill, back to front. */
  gradients?: CaptureGradient[];
  /** A background image painted over the fill. */
  backgroundImage?: { image: string; fit: ImageFit };
  /** [topLeft, topRight, bottomRight, bottomLeft]. */
  radii?: [number, number, number, number];
  border?: CaptureBorder;
  /** Outer shadows, front first (like CSS). */
  shadows?: CaptureShadow[];
  /** Children outside the box are hidden. */
  clip?: boolean;
  backgroundBlur?: number;
  /** A scroll container (overflow: auto or scroll): its children are taller or wider than it and move together. */
  scroll?: { x: boolean; y: boolean };
  /** This frame is the page's scrolling content: it's taller than its parent, which clips it, and moves inside it. */
  scrollContent?: boolean;
  /** Keep this frame when it has no paint and a single child (it names something, or scripts target it). */
  keep?: boolean;
  children: CaptureNode[];
}

export interface CaptureTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic?: boolean;
  color: string;
  align?: "left" | "center" | "right" | "justify";
  letterSpacing?: number;
  /** Line height in points. */
  lineHeight?: number;
  decoration?: "underline" | "strikethrough";
  transform?: "uppercase" | "lowercase" | "capitalize";
}

export interface CaptureText extends CaptureNodeBase {
  kind: "text";
  text: string;
  style: CaptureTextStyle;
  /** The text runs over several lines, so its width is fixed. Single lines hug their text. */
  wraps?: boolean;
  /** Visible lines before truncation (line clamp, or 1 for an ellipsis). */
  maxLines?: number;
}

export interface CaptureImage extends CaptureNodeBase {
  kind: "image";
  /** Key into DesignCapture.images. */
  image: string;
  fit: ImageFit;
  radii?: [number, number, number, number];
}

/** An editable field (input, textarea). Becomes a Text Field that people can type into in the prototype. */
export interface CaptureInput extends CaptureNodeBase {
  kind: "input";
  value: string;
  placeholder?: string;
  placeholderColor?: string;
  style: CaptureTextStyle;
  multiline?: boolean;
  secure?: boolean;
  keyboard?: "default" | "number" | "email" | "url" | "phone";
}

export type CaptureNode = CaptureFrame | CaptureText | CaptureImage | CaptureInput;

export interface CaptureImageSource {
  /** A data: URL holding the bytes, or an http(s) URL the importer downloads. */
  url: string;
  mime?: string;
  /** Intrinsic size in pixels. */
  width?: number;
  height?: number;
  /** Suggested asset name ("hero-photo"). */
  name?: string;
}

/** A web font the captured text uses (an @font-face rule with a downloadable file). */
export interface CaptureFont {
  family: string;
  /** A data: URL or an http(s) URL of the font file. */
  url: string;
  weight?: string;
  style?: string;
  unicodeRange?: string;
}

export interface DesignCapture {
  format: typeof CAPTURE_FORMAT;
  version: typeof CAPTURE_VERSION;
  source: {
    /** "url", "html", "figma", "chrome"... */
    kind: string;
    url?: string;
    title?: string;
    /** The tool that wrote the capture ("sonobe-walker/1"). */
    generator?: string;
  };
  /** The viewport the design was laid out in. */
  viewport: { width: number; height: number };
  root: CaptureFrame;
  images: Record<string, CaptureImageSource>;
  /** Web fonts the text uses. Their files resolve under the keys "font:0", "font:1"… */
  fonts?: CaptureFont[];
  /** What the capture approximated or left out, in plain words. */
  notes?: string[];
  stats?: { elements: number; nodes: number; truncated?: boolean };
}

// ---------------------------------------------------------------------------
// Validation (for captures that arrive from outside: paste, MCP, plugins)
// ---------------------------------------------------------------------------

const num = z.number().finite();
const color = z.string().regex(/^#[0-9A-Fa-f]{8}$/, 'Colors are "#RRGGBBAA".');
const box = z.tuple([num, num, num.min(0), num.min(0)]);
const quad = z.tuple([num, num, num, num]);

const textStyle = z.object({
  fontFamily: z.string().max(500),
  fontSize: num.min(0),
  fontWeight: num,
  italic: z.boolean().optional(),
  color,
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  letterSpacing: num.optional(),
  lineHeight: num.min(0).optional(),
  decoration: z.enum(["underline", "strikethrough"]).optional(),
  transform: z.enum(["uppercase", "lowercase", "capitalize"]).optional(),
});

const base = {
  name: z.string().max(200).optional(),
  nameRank: num.optional(),
  box,
  opacity: num.min(0).max(1).optional(),
  rotation: num.optional(),
  scale: num.optional(),
  blendMode: z.string().max(40).optional(),
  blur: num.min(0).optional(),
  source: z.object({ tag: z.string().max(60).optional(), component: z.string().max(200).optional(), id: z.string().max(200).optional(), testId: z.string().max(200).optional() }).optional(),
  interactive: z.boolean().optional(),
};

const imageFit = z.enum(["cover", "contain", "stretch", "tile"]);

const gradient = z.object({
  kind: z.enum(["linear", "radial", "angular"]),
  stops: z.array(z.tuple([num, color])).min(1).max(64),
  start: z.tuple([num, num]),
  end: z.tuple([num, num]),
  ratio: num.positive().optional(),
});

const shadow = z.object({ x: num, y: num, blur: num.min(0), spread: num, color, inset: z.boolean().optional() });

const frame: z.ZodType<CaptureFrame> = z.lazy(() =>
  z.object({
    ...base,
    kind: z.literal("frame"),
    fill: color.optional(),
    gradients: z.array(gradient).max(16).optional(),
    backgroundImage: z.object({ image: z.string(), fit: imageFit }).optional(),
    radii: quad.optional(),
    border: z.object({ widths: quad, colors: z.tuple([color, color, color, color]) }).optional(),
    shadows: z.array(shadow).max(16).optional(),
    clip: z.boolean().optional(),
    backgroundBlur: num.min(0).optional(),
    scroll: z.object({ x: z.boolean(), y: z.boolean() }).optional(),
    scrollContent: z.boolean().optional(),
    keep: z.boolean().optional(),
    children: z.array(node),
  }),
) as z.ZodType<CaptureFrame>;

const node: z.ZodType<CaptureNode> = z.lazy(() =>
  z.union([
    frame,
    z.object({ ...base, kind: z.literal("text"), text: z.string().max(100_000), style: textStyle, wraps: z.boolean().optional(), maxLines: num.min(0).optional() }),
    z.object({ ...base, kind: z.literal("image"), image: z.string(), fit: imageFit, radii: quad.optional() }),
    z.object({
      ...base,
      kind: z.literal("input"),
      value: z.string().max(100_000),
      placeholder: z.string().max(10_000).optional(),
      placeholderColor: color.optional(),
      style: textStyle,
      multiline: z.boolean().optional(),
      secure: z.boolean().optional(),
      keyboard: z.enum(["default", "number", "email", "url", "phone"]).optional(),
    }),
  ]),
) as z.ZodType<CaptureNode>;

export const DesignCaptureSchema = z.object({
  format: z.literal(CAPTURE_FORMAT),
  version: z.literal(CAPTURE_VERSION),
  source: z.object({ kind: z.string().max(40), url: z.string().max(10_000).optional(), title: z.string().max(500).optional(), generator: z.string().max(200).optional() }),
  viewport: z.object({ width: num.positive(), height: num.positive() }),
  root: frame,
  images: z.record(z.string(), z.object({ url: z.string(), mime: z.string().max(100).optional(), width: num.optional(), height: num.optional(), name: z.string().max(200).optional() })),
  fonts: z.array(z.object({ family: z.string().min(1).max(200), url: z.string(), weight: z.string().max(40).optional(), style: z.string().max(40).optional(), unicodeRange: z.string().max(4000).optional() })).max(64).optional(),
  notes: z.array(z.string().max(2000)).max(200).optional(),
  stats: z.object({ elements: num, nodes: num, truncated: z.boolean().optional() }).optional(),
});

export class CaptureFormatError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "CaptureFormatError";
    this.issues = issues;
  }
}

/** True for anything shaped like a capture at the top level (a quick check before validating). */
export function looksLikeCapture(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { format?: unknown }).format === CAPTURE_FORMAT;
}

/** Validate a capture from outside. Throws CaptureFormatError with readable issues. */
export function parseCapture(value: unknown): DesignCapture {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new CaptureFormatError("That isn't a design capture: it isn't JSON.");
    }
  }
  if (!looksLikeCapture(value)) throw new CaptureFormatError(`That isn't a design capture: it needs "format": "${CAPTURE_FORMAT}".`);
  const result = DesignCaptureSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new CaptureFormatError(`The design capture isn't valid: ${issues[0]}`, issues);
  }
  return result.data as DesignCapture;
}

/** Visit every node, parents before children. */
export function walkCapture(root: CaptureNode, visit: (node: CaptureNode, depth: number) => void, depth = 0): void {
  visit(root, depth);
  if (root.kind === "frame") for (const child of root.children) walkCapture(child, visit, depth + 1);
}
