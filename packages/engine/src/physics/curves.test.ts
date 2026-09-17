import { describe, expect, it } from "vitest";
import {
  CURVE_OPTIONS,
  CURVES,
  cubicBezier,
  curveToCSSLinear,
  EASINGS,
  evaluateCurve,
  getCurve,
  ORIGAMI_CURVE_KEYS,
  sampleCurve,
} from "./curves.ts";

describe("easing curves", () => {
  it("registry covers linear plus 10 families × in/out/inOut with unique keys", () => {
    expect(CURVES.length).toBe(31);
    expect(new Set(CURVES.map((c) => c.key)).size).toBe(31);
    expect(CURVE_OPTIONS.length).toBe(31);
    expect(CURVES[0]!.key).toBe("linear");
    expect(getCurve("quadraticInOut")!.name).toBe("Quadratic In & Out");
    expect(getCurve("sineIn")!.name).toBe("Sinusoidal In");
    for (const key of ORIGAMI_CURVE_KEYS) expect(getCurve(key)).toBeDefined();
  });

  it("every curve starts at 0 and ends at 1", () => {
    for (const curve of CURVES) {
      expect(curve.fn(0), curve.key).toBeCloseTo(0, 9);
      expect(curve.fn(1), curve.key).toBeCloseTo(1, 9);
    }
  });

  it("monotonic families never reverse or leave 0..1", () => {
    for (const curve of CURVES.filter((c) => c.monotonic)) {
      let prev = curve.fn(0);
      for (let i = 1; i <= 1000; i++) {
        const v = curve.fn(i / 1000);
        expect(v, `${curve.key} at ${i / 1000}`).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(v).toBeGreaterThanOrEqual(-1e-12);
        expect(v).toBeLessThanOrEqual(1 + 1e-12);
        prev = v;
      }
    }
  });

  it("in & out curves pass through the midpoint", () => {
    for (const curve of CURVES.filter((c) => c.direction === "inOut")) {
      expect(curve.fn(0.5), curve.key).toBeCloseTo(0.5, 9);
    }
  });

  it("in curves mirror out curves", () => {
    for (const curve of CURVES.filter((c) => c.direction === "in")) {
      const out = getCurve(`${curve.family}Out`)!;
      for (const t of [0.1, 0.3, 0.7, 0.9]) expect(curve.fn(t)).toBeCloseTo(1 - out.fn(1 - t), 9);
    }
  });

  it("back overshoots, elastic wobbles, bounce stays within 0..1", () => {
    const samples = (fn: (t: number) => number) =>
      Array.from({ length: 1001 }, (_, i) => fn(i / 1000));
    expect(Math.max(...samples(EASINGS.backOut))).toBeGreaterThan(1.05);
    expect(Math.min(...samples(EASINGS.backIn))).toBeLessThan(-0.05);
    expect(Math.max(...samples(EASINGS.elasticOut))).toBeGreaterThan(1.1);
    const bounce = samples(EASINGS.bounceOut);
    expect(Math.max(...bounce)).toBeLessThanOrEqual(1 + 1e-12);
    expect(Math.min(...bounce)).toBeGreaterThanOrEqual(0);
  });

  it("matches the published formulas at sample points", () => {
    expect(EASINGS.quadraticIn(0.5)).toBe(0.25);
    expect(EASINGS.cubicOut(0.5)).toBe(0.875);
    expect(EASINGS.quinticInOut(0.25)).toBeCloseTo(16 * 0.25 ** 5, 12);
    expect(EASINGS.sineOut(0.5)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(EASINGS.exponentialIn(0.5)).toBeCloseTo(2 ** -5, 12);
    expect(EASINGS.circularOut(0.5)).toBeCloseTo(Math.sqrt(0.75), 12);
    expect(EASINGS.bounceOut(0.5)).toBeCloseTo(0.765625, 12);
  });

  it("getCurve accepts display names and common aliases", () => {
    expect(getCurve("Quadratic In & Out")!.key).toBe("quadraticInOut");
    expect(getCurve("Sinusoidal In")!.key).toBe("sineIn");
    expect(getCurve("easeInOutCubic")!.key).toBe("cubicInOut");
    expect(getCurve("ease-out-sine")!.key).toBe("sineOut");
    expect(getCurve("EXPO IN")!.key).toBe("exponentialIn");
    expect(getCurve("easeOutBack")!.key).toBe("backOut");
    expect(getCurve("Linear")!.key).toBe("linear");
    expect(getCurve("wobble")).toBeUndefined();
    expect(getCurve("in")).toBeUndefined();
  });

  it("evaluateCurve clamps progress and falls back to linear", () => {
    expect(evaluateCurve("cubicIn", 2)).toBe(1);
    expect(evaluateCurve("cubicIn", -1)).toBe(0);
    expect(evaluateCurve("nope", 0.3)).toBe(0.3);
    expect(evaluateCurve("linear", Number.NaN)).toBe(0);
  });
});

describe("cubicBezier", () => {
  it("matches CSS ease and ease-in-out (independent bisection reference)", () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0.1)).toBeCloseTo(0.09479630571604324, 6);
    expect(ease(0.25)).toBeCloseTo(0.40851059135539586, 6);
    expect(ease(0.5)).toBeCloseTo(0.802403387584857, 6);
    expect(ease(0.75)).toBeCloseTo(0.9604589783489741, 6);
    const inOut = cubicBezier(0.42, 0, 0.58, 1);
    expect(inOut(0.1)).toBeCloseTo(0.019722453548311196, 6);
    expect(inOut(0.5)).toBeCloseTo(0.5, 9);
    expect(inOut(0.9)).toBeCloseTo(0.9802775464516889, 6);
  });

  it("is the identity for a straight line and pins endpoints", () => {
    const line = cubicBezier(0, 0, 1, 1);
    for (const t of [0.1, 0.37, 0.8]) expect(line(t)).toBeCloseTo(t, 12);
    const overshoot = cubicBezier(0.34, 1.56, 0.64, 1);
    expect(overshoot(0)).toBe(0);
    expect(overshoot(1)).toBe(1);
    expect(overshoot(-3)).toBe(0);
    expect(overshoot(4)).toBe(1);
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => overshoot(i / 100)))).toBeGreaterThan(
      1,
    );
  });

  it("clamps x control points like CSS and stays monotonic in x", () => {
    const steep = cubicBezier(-1, 0, 2, 1);
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const v = steep(i / 200);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe("curve sampling and CSS", () => {
  it("sampleCurve returns count + 1 points", () => {
    const pts = sampleCurve(EASINGS.cubicIn, 10);
    expect(pts.length).toBe(11);
    expect(pts[5]).toEqual([0.5, 0.125]);
  });

  it("curveToCSSLinear compresses and stays accurate", () => {
    expect(curveToCSSLinear(EASINGS.linear)).toBe("linear(0, 1)");
    const css = curveToCSSLinear(EASINGS.cubicInOut);
    expect(css.startsWith("linear(0, ")).toBe(true);
    expect(css.endsWith(", 1)")).toBe(true);
    expect(css.split(",").length).toBeLessThan(40);
  });
});
