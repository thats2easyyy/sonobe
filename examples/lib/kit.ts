/**
 * The shared design kit for the example prototypes: screen metrics, palette, type ramp, and small
 * builders for layers, patches, and ops. Everything returns plain core op shapes, so a recipe reads
 * like the ops Claude sends over MCP.
 */

import type { GradientLiteral, InputValue, LayerInput, LinkInput, LoopLiteral, NewLayer, NewPatch, Op } from "@sonobe/core";

/** iPhone 17 Pro, the default device, in points. */
export const SCREEN = { width: 402, height: 874, safeTop: 62, safeBottom: 34 } as const;

/** Colors as "#RRGGBBAA". */
export const palette = {
  canvas: "#F4F4F6FF",
  surface: "#FFFFFFFF",
  ink: "#111118FF",
  ink2: "#5F5F6BFF",
  ink3: "#A1A1AAFF",
  hairline: "#E6E6EBFF",
  fill: "#EDEDF1FF",
  night: "#0E0F1AFF",
  nightSurface: "#1A1B2AFF",
  white: "#FFFFFFFF",
  white70: "#FFFFFFB3",
  white40: "#FFFFFF66",
  black: "#000000FF",
  clear: "#00000000",
  indigo: "#5B5CF6FF",
  violet: "#8B5CF6FF",
  pink: "#FF3D71FF",
  coral: "#FF6B4AFF",
  amber: "#FFB020FF",
  green: "#22C55EFF",
  teal: "#14B8A6FF",
  sky: "#38BDF8FF",
  red: "#EF4444FF",
} as const;

export interface TypeStyle {
  fontSize: number;
  fontWeight: number;
  lineHeight?: number;
  letterSpacing?: number;
}

/** The type ramp (Inter). */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: 700, letterSpacing: -0.6 },
  title: { fontSize: 28, fontWeight: 700, letterSpacing: -0.4 },
  title2: { fontSize: 22, fontWeight: 700, letterSpacing: -0.2 },
  headline: { fontSize: 17, fontWeight: 600 },
  body: { fontSize: 17, fontWeight: 400, lineHeight: 24 },
  callout: { fontSize: 15, fontWeight: 400, lineHeight: 21 },
  subhead: { fontSize: 15, fontWeight: 600 },
  footnote: { fontSize: 13, fontWeight: 400, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: 600, letterSpacing: 0.2 },
} as const satisfies Record<string, TypeStyle>;

type Props = Record<string, InputValue>;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export const link = (address: string): LinkInput => ({ link: address });
export const layerRef = (id: string): LayerInput => ({ layer: id });
export const loopOf = (items: (number | string | boolean | number[])[]): LoopLiteral => ({ loop: items });

/** A gradient literal: stops as [offset, "#RRGGBBAA"], start and end normalized in layer bounds. */
export function gradient(stops: [number, string][], start: [number, number] = [0.5, 0], end: [number, number] = [0.5, 1], kind: "linear" | "radial" | "angular" = "linear"): GradientLiteral {
  return { gradient: { kind, stops, start, end } };
}

/** Drop shadow props: soft for cards, lifted for sheets and floating things. */
export function shadow(level: "soft" | "lifted" | "glow", color: string = palette.black): Props {
  switch (level) {
    case "soft":
      return { shadowColor: color, shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: [0, 6] };
    case "lifted":
      return { shadowColor: color, shadowOpacity: 0.18, shadowRadius: 32, shadowOffset: [0, -4] };
    case "glow":
      return { shadowColor: color, shadowOpacity: 0.45, shadowRadius: 28, shadowOffset: [0, 10] };
  }
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export function rect(id: string, name: string, props: Props): NewLayer {
  return { id, type: "rectangle", name, props };
}

export function oval(id: string, name: string, props: Props): NewLayer {
  return { id, type: "oval", name, props };
}

export function group(id: string, name: string, props: Props, children: NewLayer[] = []): NewLayer {
  return { id, type: "group", name, props, children };
}

export function gradientLayer(id: string, name: string, fill: GradientLiteral, props: Props): NewLayer {
  return { id, type: "gradient", name, props: { ...props, gradient: fill } };
}

export function hitArea(id: string, name: string, props: Props): NewLayer {
  return { id, type: "hitArea", name, props: { showInEditor: false, ...props } };
}

export function shape(id: string, name: string, props: Props): NewLayer {
  return { id, type: "shape", name, props };
}

/** A text layer. Text is left-aligned and hugs its content unless props say otherwise. */
export function text(id: string, name: string, content: string, style: TypeStyle, color: string, props: Props = {}): NewLayer {
  const styleProps: Props = { fontSize: style.fontSize, fontWeight: style.fontWeight };
  if (style.lineHeight !== undefined) styleProps.lineHeight = style.lineHeight;
  if (style.letterSpacing !== undefined) styleProps.letterSpacing = style.letterSpacing;
  return { id, type: "text", name, props: { text: content, ...styleProps, textColor: color, hitTest: false, ...props } };
}

/** The iOS status bar: time on the left, signal and battery on the right. Touches pass through. */
export function statusBar(prefix: string, tone: "dark" | "light"): NewLayer {
  const ink = tone === "dark" ? palette.ink : palette.white;
  const faint = tone === "dark" ? "#11111859" : "#FFFFFF59";
  const bars = [4, 6, 8, 10].map((h, i) => rect(`${prefix}_signal_${i + 1}`, `Signal ${i + 1}`, { position: [292 + i * 5, 34 - h], size: [3, h], cornerRadius: 1, color: ink, hitTest: false }));
  return group(`${prefix}_status_bar`, "Status Bar", { size: [SCREEN.width, SCREEN.safeTop], hitTest: false }, [
    text(`${prefix}_clock`, "Clock", "9:41", { fontSize: 17, fontWeight: 600 }, ink, { position: [72, 20], anchor: [0.5, 0], textAlignment: "center" }),
    ...bars,
    rect(`${prefix}_battery`, "Battery", { position: [322, 23], size: [25, 12], cornerRadius: 3.5, color: palette.clear, strokeColor: faint, strokeWidth: 1, hitTest: false }),
    rect(`${prefix}_battery_level`, "Battery Level", { position: [324, 25], size: [19, 8], cornerRadius: 2, color: ink, hitTest: false }),
    rect(`${prefix}_battery_cap`, "Battery Cap", { position: [348, 27], size: [2, 4], cornerRadius: 1, color: faint, hitTest: false }),
  ]);
}

/** The home indicator bar at the bottom of the screen. */
export function homeIndicator(prefix: string, tone: "dark" | "light"): NewLayer {
  return rect(`${prefix}_home_indicator`, "Home Indicator", {
    position: [SCREEN.width / 2, SCREEN.height - 8],
    anchor: [0.5, 1],
    size: [140, 5],
    cornerRadius: 3,
    color: tone === "dark" ? palette.ink : palette.white,
    hitTest: false,
  });
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

/** addLayer, at the top level or inside `parent`. */
export function addLayer(layer: NewLayer, parent?: string): Op {
  return parent === undefined ? { op: "addLayer", layer } : { op: "addLayer", parent, layer };
}

export interface PatchOptions {
  typeParam?: string;
  inputCount?: number;
  settings?: NewPatch["settings"];
}

/** addPatch with an explicit id and a display name that says what the patch does. */
export function addPatch(id: string, patchType: string, name: string, inputs: Props = {}, options: PatchOptions = {}): Op {
  const patch: NewPatch = { id, type: patchType, name, inputs };
  if (options.typeParam !== undefined) patch.typeParam = options.typeParam;
  if (options.inputCount !== undefined) patch.inputCount = options.inputCount;
  if (options.settings !== undefined) patch.settings = options.settings;
  return { op: "addPatch", patch };
}

export const connect = (from: string, to: string): Op => ({ op: "connect", from, to });

export const setInput = (target: string, value: InputValue): Op => ({ op: "setInput", target, value });

/** A comment frame in the patch editor. */
export function comment(id: string, textContent: string, rect: [number, number, number, number], color = "yellow"): Op {
  return { op: "addComment", comment: { id, text: textContent, rect, color } };
}
