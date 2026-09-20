/**
 * Style digest: the colors, fonts, font sizes, corner radii and shadows a component's layers use
 * most, counted from their explicit literal props. Pure and deterministic, so the canvas's Design
 * with Claude box, get_outline({ detail: "styles" }) and copied prompts all ground a new design
 * the same way.
 *
 * Only props a layer stores count, and only literals: links (knobs included, "$knob.id") and
 * defaults don't. Paint that can't show is left out: a color with alpha 0, a fill under a gradient,
 * a stroke whose width is 0, and a shadow whose opacity is 0 (the default). A text layer that sets
 * only its weight counts toward its type's default font.
 */

import { getOwn } from "./ids.ts";
import { LAYER_TYPE_MAP } from "./layerTypes.ts";
import { allLayers } from "./registry.ts";
import type { Id, InputValue, SonobeDocument } from "./types.ts";
import { formatColor, formatNumber, isGradientLiteral, isLinkInput, parseColor, roundNumber } from "./values.ts";

export interface StyleDigest {
  component: Id;
  layers: number;
  /** At most 12, as "#RRGGBBAA". */
  colors: { value: string; uses: number; roles: ("fill" | "text" | "stroke" | "shadow" | "gradient")[] }[];
  /** At most 4. */
  fonts: { family: string; weights: number[]; uses: number }[];
  /** At most 8. */
  fontSizes: { size: number; uses: number }[];
  /** At most 6. */
  radii: { radius: number; uses: number }[];
  /** At most 3. */
  shadows: { color: string; radius: number; offset: [number, number]; opacity: number; uses: number }[];
}

type ColorRole = StyleDigest["colors"][number]["roles"][number];

const ROLE_ORDER: readonly ColorRole[] = ["fill", "text", "stroke", "shadow", "gradient"];
const MAX_COLORS = 12;
const MAX_FONTS = 4;
const MAX_FONT_SIZES = 8;
const MAX_RADII = 6;
const MAX_SHADOWS = 3;

/** Uses descending, then value ascending. */
const byUses = <T extends { uses: number }>(value: (a: T, b: T) => number) => (a: T, b: T) => b.uses - a.uses || value(a, b);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A number the layer stores itself; undefined for links, other values and props it doesn't set. */
const literalNumber = (v: InputValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? roundNumber(v) : undefined);
const literalColor = (v: InputValue | undefined): string | undefined => {
  if (typeof v !== "string") return undefined;
  const c = parseColor(v);
  return c ? formatColor(c) : undefined;
};

/** The digest of `componentId` (default: the project's root component). */
export function styleDigest(doc: SonobeDocument, componentId?: Id): StyleDigest {
  const id = componentId ?? doc.project.root;
  const component = getOwn(doc.components, id);
  if (!component) throw new Error(`There's no component "${id}".`);
  const layers = allLayers(component.layers);

  const colors = new Map<string, { uses: number; roles: Set<ColorRole> }>();
  const fonts = new Map<string, { weights: Set<number>; uses: number }>();
  const fontSizes = new Map<number, number>();
  const radii = new Map<number, number>();
  const shadows = new Map<string, StyleDigest["shadows"][number]>();

  const addColor = (value: string | undefined, role: ColorRole) => {
    // Alpha 0 ("#RRGGBB00") draws nothing.
    if (value === undefined || value.endsWith("00", 9)) return;
    const entry = colors.get(value) ?? { uses: 0, roles: new Set<ColorRole>() };
    entry.uses++;
    entry.roles.add(role);
    colors.set(value, entry);
  };
  const count = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

  for (const layer of layers) {
    const spec = LAYER_TYPE_MAP.get(layer.type);
    if (!spec) continue;
    const declared = new Map(spec.props.map((p) => [p.key, p]));
    const props = layer.props;
    const has = (key: string) => declared.has(key) && Object.hasOwn(props, key);
    const own = (key: string): InputValue | undefined => (has(key) ? props[key] : undefined);
    const fallback = <T>(key: string, isType: (v: unknown) => v is T): T | undefined => {
      const def = declared.get(key)?.default;
      return isType(def) ? def : undefined;
    };

    const gradient = own("gradient");
    if (has("color") && !isGradientLiteral(gradient)) addColor(literalColor(own("color")), "fill");
    if (has("textColor")) addColor(literalColor(own("textColor")), "text");
    // A stroke shows only with a width: a linked width may, a missing one is the default 0.
    const strokeWidth = own("strokeWidth");
    if (has("strokeColor") && (isLinkInput(strokeWidth) || (literalNumber(strokeWidth) ?? 0) > 0)) addColor(literalColor(own("strokeColor")), "stroke");
    if (isGradientLiteral(gradient)) for (const stop of gradient.gradient.stops ?? []) addColor(Array.isArray(stop) ? literalColor(stop[1]) : undefined, "gradient");

    // Text: the family with the weights it's set in.
    if (declared.has("fontFamily") && (has("fontFamily") || has("fontWeight"))) {
      const familyValue = own("fontFamily");
      const family = familyValue === undefined ? fallback("fontFamily", (v): v is string => typeof v === "string") : typeof familyValue === "string" ? familyValue.trim() : undefined;
      if (family) {
        const weightValue = own("fontWeight");
        const weight = weightValue === undefined ? fallback("fontWeight", (v): v is number => typeof v === "number") : literalNumber(weightValue);
        const entry = fonts.get(family) ?? { weights: new Set<number>(), uses: 0 };
        entry.uses++;
        if (weight !== undefined) entry.weights.add(weight);
        fonts.set(family, entry);
      }
    }
    const fontSize = literalNumber(own("fontSize"));
    if (fontSize !== undefined && fontSize > 0) count(fontSizes, fontSize);
    const radius = literalNumber(own("cornerRadius"));
    if (radius !== undefined && radius > 0) count(radii, radius);

    // A shadow shows only with an opacity above 0 (the default is 0, which turns it off).
    const opacityValue = own("shadowOpacity");
    const opacity = literalNumber(opacityValue);
    if (isLinkInput(opacityValue) || (opacity ?? 0) > 0) addColor(literalColor(own("shadowColor")), "shadow");
    if (opacity !== undefined && opacity > 0) {
      const colorValue = own("shadowColor");
      const color = colorValue === undefined ? literalColor(fallback("shadowColor", (v): v is string => typeof v === "string")) : literalColor(colorValue);
      const radiusValue = own("shadowRadius");
      const blur = radiusValue === undefined ? (fallback("shadowRadius", (v): v is number => typeof v === "number") ?? 0) : literalNumber(radiusValue);
      const offsetValue = own("shadowOffset");
      const offset = offsetValue === undefined ? (fallback("shadowOffset", isPoint) ?? [0, 0]) : isPoint(offsetValue) ? offsetValue : undefined;
      if (color !== undefined && blur !== undefined && offset !== undefined) {
        const shadow = { color, radius: blur, offset: [roundNumber(offset[0]), roundNumber(offset[1])] as [number, number], opacity, uses: 0 };
        const key = JSON.stringify([shadow.color, shadow.radius, shadow.offset, shadow.opacity]);
        const entry = shadows.get(key) ?? shadow;
        entry.uses++;
        shadows.set(key, entry);
      }
    }
  }

  return {
    component: id,
    layers: layers.length,
    colors: [...colors]
      .map(([value, e]) => ({ value, uses: e.uses, roles: ROLE_ORDER.filter((r) => e.roles.has(r)) }))
      .sort(byUses((a, b) => compareText(a.value, b.value)))
      .slice(0, MAX_COLORS),
    fonts: [...fonts]
      .map(([family, e]) => ({ family, weights: [...e.weights].sort((a, b) => a - b), uses: e.uses }))
      .sort(byUses((a, b) => compareText(a.family, b.family)))
      .slice(0, MAX_FONTS),
    fontSizes: [...fontSizes]
      .map(([size, uses]) => ({ size, uses }))
      .sort(byUses((a, b) => a.size - b.size))
      .slice(0, MAX_FONT_SIZES),
    radii: [...radii]
      .map(([radius, uses]) => ({ radius, uses }))
      .sort(byUses((a, b) => a.radius - b.radius))
      .slice(0, MAX_RADII),
    shadows: [...shadows.values()]
      .sort(byUses((a, b) => compareText(a.color, b.color) || a.radius - b.radius || a.offset[0] - b.offset[0] || a.offset[1] - b.offset[1] || a.opacity - b.opacity))
      .slice(0, MAX_SHADOWS),
  };
}

function isPoint(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** A shadow's color with its opacity folded into the alpha, the way it draws. */
function shadowPaint(color: string, opacity: number): string {
  const c = parseColor(color);
  return c ? formatColor({ ...c, a: c.a * opacity }) : color;
}

/** The digest as a few lines of text ("styles main (64 layers)", then colors, fonts, sizes, radii, shadows). */
export function formatStyleDigest(digest: StyleDigest): string {
  if (!digest.layers) return `styles ${digest.component} (no layers yet)`;
  const lines = [`styles ${digest.component} (${digest.layers} layer${digest.layers === 1 ? "" : "s"})`];
  const line = (label: string, items: string[]) => {
    if (items.length) lines.push(`${label} ${items.join(" · ")}`);
  };
  line("colors", digest.colors.map((c) => `${c.value} ${c.roles.join(",")}×${c.uses}`));
  line("fonts", digest.fonts.map((f) => `${JSON.stringify(f.family)}${f.weights.length ? ` ${f.weights.map(formatNumber).join(",")}` : ""} ×${f.uses}`));
  line("font sizes", digest.fontSizes.map((s) => `${formatNumber(s.size)}×${s.uses}`));
  line("radii", digest.radii.map((r) => `${formatNumber(r.radius)}×${r.uses}`));
  line("shadows", digest.shadows.map((s) => `${shadowPaint(s.color, s.opacity)} r${formatNumber(s.radius)} ${formatNumber(s.offset[0])},${formatNumber(s.offset[1])} ×${s.uses}`));
  return lines.join("\n");
}

