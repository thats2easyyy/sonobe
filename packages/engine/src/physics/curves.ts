/**
 * Easing curves for Classic Animation, Curve, and Repeating Animation: the Penner
 * families (in / out / in & out) plus a CSS-compatible cubic Bézier solver.
 * Formulations follow the BSD jQuery Easing equations cited in docs/research/semantics.md §7.8.
 */

import type { EnumOption } from "@sonobe/core";
import { simplifyPolyline, toCssLinear, type CurvePoint } from "../math/polyline.ts";

/** Maps progress 0..1 to eased progress (0 → 0, 1 → 1; may overshoot in between). */
export type EasingFunction = (t: number) => number;

const PI = Math.PI;
const BACK_C1 = 1.70158;
const BACK_C2 = BACK_C1 * 1.525;
const BACK_C3 = BACK_C1 + 1;
const ELASTIC_C4 = (2 * PI) / 3;
const ELASTIC_C5 = (2 * PI) / 4.5;

function bounceOut(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) {
    const u = x - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (x < 2.5 / d1) {
    const u = x - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = x - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

/** Every built-in curve keyed by its stable document key. */
export const EASINGS = {
  linear: (x: number) => x,

  quadraticIn: (x: number) => x * x,
  quadraticOut: (x: number) => 1 - (1 - x) * (1 - x),
  quadraticInOut: (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),

  cubicIn: (x: number) => x * x * x,
  cubicOut: (x: number) => 1 - (1 - x) ** 3,
  cubicInOut: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),

  quarticIn: (x: number) => x ** 4,
  quarticOut: (x: number) => 1 - (1 - x) ** 4,
  quarticInOut: (x: number) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),

  quinticIn: (x: number) => x ** 5,
  quinticOut: (x: number) => 1 - (1 - x) ** 5,
  quinticInOut: (x: number) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),

  sineIn: (x: number) => 1 - Math.cos((x * PI) / 2),
  sineOut: (x: number) => Math.sin((x * PI) / 2),
  sineInOut: (x: number) => -(Math.cos(PI * x) - 1) / 2,

  exponentialIn: (x: number) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  exponentialOut: (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  exponentialInOut: (x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,

  circularIn: (x: number) => 1 - Math.sqrt(Math.max(0, 1 - x * x)),
  circularOut: (x: number) => Math.sqrt(Math.max(0, 1 - (x - 1) ** 2)),
  circularInOut: (x: number) =>
    x < 0.5
      ? (1 - Math.sqrt(Math.max(0, 1 - (2 * x) ** 2))) / 2
      : (Math.sqrt(Math.max(0, 1 - (-2 * x + 2) ** 2)) + 1) / 2,

  backIn: (x: number) => BACK_C3 * x * x * x - BACK_C1 * x * x,
  backOut: (x: number) => 1 + BACK_C3 * (x - 1) ** 3 + BACK_C1 * (x - 1) ** 2,
  backInOut: (x: number) =>
    x < 0.5
      ? ((2 * x) ** 2 * ((BACK_C2 + 1) * 2 * x - BACK_C2)) / 2
      : ((2 * x - 2) ** 2 * ((BACK_C2 + 1) * (x * 2 - 2) + BACK_C2) + 2) / 2,

  elasticIn: (x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * ELASTIC_C4),
  elasticOut: (x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ELASTIC_C4) + 1,
  elasticInOut: (x: number) =>
    x <= 0
      ? 0
      : x >= 1
        ? 1
        : x < 0.5
          ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * ELASTIC_C5)) / 2
          : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * ELASTIC_C5)) / 2 + 1,

  bounceIn: (x: number) => 1 - bounceOut(1 - x),
  bounceOut,
  bounceInOut: (x: number) =>
    x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2,
} satisfies Record<string, EasingFunction>;

export type CurveKey = keyof typeof EASINGS;

export type CurveFamily =
  | "linear"
  | "quadratic"
  | "cubic"
  | "quartic"
  | "quintic"
  | "sine"
  | "exponential"
  | "circular"
  | "back"
  | "elastic"
  | "bounce";

export interface CurveInfo {
  key: CurveKey;
  /** Display name, e.g. "Quadratic In & Out" (Origami wording). */
  name: string;
  family: CurveFamily;
  direction: "none" | "in" | "out" | "inOut";
  /** Stays within 0..1 and never reverses (safe for opacity, progress). */
  monotonic: boolean;
  description: string;
  fn: EasingFunction;
}

const FAMILY_NAMES: Record<Exclude<CurveFamily, "linear">, string> = {
  quadratic: "Quadratic",
  cubic: "Cubic",
  quartic: "Quartic",
  quintic: "Quintic",
  sine: "Sinusoidal",
  exponential: "Exponential",
  circular: "Circular",
  back: "Back",
  elastic: "Elastic",
  bounce: "Bounce",
};

const FAMILY_DESCRIPTIONS: Record<Exclude<CurveFamily, "linear">, string> = {
  quadratic: "Gentle acceleration (t²).",
  cubic: "Moderate acceleration (t³); a good general-purpose ease.",
  quartic: "Strong acceleration (t⁴).",
  quintic: "Very strong acceleration (t⁵).",
  sine: "The softest ease, based on a quarter sine wave.",
  exponential: "Dramatic: very slow at one end, very fast at the other.",
  circular: "Accelerates along a quarter circle; sharp near the end.",
  back: "Pulls back slightly past the start or end (anticipation / overshoot).",
  elastic: "Wobbles like a rubber band around the end value.",
  bounce: "Bounces like a dropped ball.",
};

const DIRECTION_NAMES = { in: "In", out: "Out", inOut: "In & Out" } as const;

function buildRegistry(): CurveInfo[] {
  const list: CurveInfo[] = [
    {
      key: "linear",
      name: "Linear",
      family: "linear",
      direction: "none",
      monotonic: true,
      description: "Constant speed from start to end.",
      fn: EASINGS.linear,
    },
  ];
  const families = Object.keys(FAMILY_NAMES) as Exclude<CurveFamily, "linear">[];
  for (const family of families) {
    for (const direction of ["in", "out", "inOut"] as const) {
      const key =
        `${family}${direction === "in" ? "In" : direction === "out" ? "Out" : "InOut"}` as CurveKey;
      list.push({
        key,
        name: `${FAMILY_NAMES[family]} ${DIRECTION_NAMES[direction]}`,
        family,
        direction,
        monotonic: family !== "back" && family !== "elastic" && family !== "bounce",
        description: FAMILY_DESCRIPTIONS[family],
        fn: EASINGS[key],
      });
    }
  }
  return list;
}

/** Registry of every curve in picker order: Linear, then each family × In / Out / In & Out. */
export const CURVES: readonly CurveInfo[] = buildRegistry();

/** Enum options for a curve port (key + display name). */
export const CURVE_OPTIONS: EnumOption[] = CURVES.map((c) => ({
  key: c.key,
  name: c.name,
  description: c.description,
}));

/** The curves Origami's Classic Animation offers (for importers and compatibility docs). */
export const ORIGAMI_CURVE_KEYS: readonly CurveKey[] = [
  "linear",
  "quadraticIn",
  "quadraticOut",
  "quadraticInOut",
  "cubicIn",
  "cubicOut",
  "cubicInOut",
  "exponentialIn",
  "exponentialOut",
  "exponentialInOut",
  "sineIn",
  "sineOut",
  "sineInOut",
];

const FAMILY_ALIASES: Record<string, CurveFamily> = {
  quad: "quadratic",
  quadratic: "quadratic",
  cubic: "cubic",
  quart: "quartic",
  quartic: "quartic",
  quint: "quintic",
  quintic: "quintic",
  sine: "sine",
  sin: "sine",
  sinusoidal: "sine",
  expo: "exponential",
  exponential: "exponential",
  circ: "circular",
  circular: "circular",
  back: "back",
  elastic: "elastic",
  bounce: "bounce",
};

const BY_KEY = new Map<string, CurveInfo>(CURVES.map((c) => [c.key, c]));

/**
 * Look up a curve by key, display name, or common alias, case-insensitively:
 * "cubicInOut", "Cubic In & Out", "easeInOutCubic", "ease-in-out-cubic", "sinusoidalIn".
 */
export function getCurve(name: string): CurveInfo | undefined {
  const direct = BY_KEY.get(name);
  if (direct) return direct;
  const s = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z]/g, "");
  if (s === "linear" || s === "none") return BY_KEY.get("linear");
  let direction: "In" | "Out" | "InOut" | undefined;
  let rest = s;
  const penner = /^ease(inout|in|out)(.+)$/.exec(s);
  if (penner) {
    direction = penner[1] === "inout" ? "InOut" : penner[1] === "in" ? "In" : "Out";
    rest = penner[2]!;
  } else {
    const suffix = /(inandout|inout|in|out)$/.exec(s);
    if (!suffix) return undefined;
    direction = suffix[1] === "in" ? "In" : suffix[1] === "out" ? "Out" : "InOut";
    rest = s.slice(0, s.length - suffix[1]!.length);
    if (rest.startsWith("ease")) rest = rest.slice(4);
  }
  const family = FAMILY_ALIASES[rest];
  if (!family || family === "linear") return undefined;
  return BY_KEY.get(`${family}${direction}`);
}

/** Evaluate a curve by name at progress `t` (clamped to 0..1). Unknown names fall back to linear. */
export function evaluateCurve(name: string, t: number): number {
  const curve = getCurve(name) ?? BY_KEY.get("linear")!;
  const x = t <= 0 ? 0 : t >= 1 ? 1 : Number.isFinite(t) ? t : 0;
  return curve.fn(x);
}

/**
 * CSS-compatible `cubic-bezier(x1, y1, x2, y2)`. X control values are clamped to 0..1
 * (as in CSS); the returned function clamps its input to 0..1.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  const ax1 = Math.min(1, Math.max(0, x1));
  const ax2 = Math.min(1, Math.max(0, x2));
  const cx = 3 * ax1;
  const bx = 3 * (ax2 - ax1) - cx;
  const axx = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ayy = 1 - cy - by;
  const sampleX = (t: number) => ((axx * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ayy * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * axx * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-9) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 60; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-9) return t;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number) => {
    if (!(x > 0)) return 0;
    if (x >= 1) return 1;
    if (ax1 === y1 && ax2 === y2) return x;
    return sampleY(solveT(x));
  };
}

/** Sample a curve into `count + 1` evenly spaced `[t, value]` points (for previews). */
export function sampleCurve(fn: EasingFunction, count = 60): CurvePoint[] {
  const n = Math.max(1, Math.floor(count));
  const out: CurvePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([t, fn(t)]);
  }
  return out;
}

/** CSS `linear()` approximation of any easing (within `tolerance` of the true curve). */
export function curveToCSSLinear(fn: EasingFunction, tolerance = 0.002): string {
  return toCssLinear(simplifyPolyline(sampleCurve(fn, 400), tolerance));
}
