import { describe, expect, it } from "vitest";
import {
  bouncyConversion,
  createSpringState,
  createVectorSpringState,
  dampingRatio,
  estimateSettleTime,
  fromBouncinessSpeed,
  fromDurationBounce,
  fromMassStiffnessDamping,
  fromOrigamiTensionFriction,
  fromResponseDampingFraction,
  frictionFromOrigamiValue,
  isSpringAtRest,
  origamiValueFromFriction,
  origamiValueFromTension,
  sampleSpringCurve,
  setSpringTarget,
  setVectorSpringTarget,
  Spring,
  SPRING_PRESETS,
  springEquivalents,
  springPreset,
  springToAndroid,
  springToCSSLinear,
  springToMotion,
  springToSwiftUI,
  stepSpring,
  stepVectorSpring,
  tensionFromOrigamiValue,
  toBouncinessSpeed,
  toDurationBounce,
  toOrigamiTensionFriction,
  toResponseDampingFraction,
  VectorSpring,
  type SpringConfig,
} from "./spring.ts";

/** Independent reference: closed-form underdamped step response from 0 to 1 (mass 1, v0 = 0). */
function analyticStep(config: SpringConfig, t: number): { x: number; v: number } {
  const w0 = Math.sqrt(config.stiffness);
  const z = config.damping / (2 * w0);
  const wd = w0 * Math.sqrt(1 - z * z);
  const e = Math.exp(-z * w0 * t);
  return {
    x: 1 - e * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t)),
    v: e * ((w0 * w0) / wd) * Math.sin(wd * t),
  };
}

function runFor(config: SpringConfig, seconds: number, dt: number) {
  const state = createSpringState(0, 1);
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) stepSpring(state, config, dt);
  return state;
}

describe("Rebound conversions (golden, docs/research/semantics.md §7.4)", () => {
  // Reference values computed independently from the published Rebound formulas.
  const table = [
    {
      b: 5,
      s: 10,
      tension: 59.1764705882353,
      friction: 8.68290146857747,
      k: 299.61882352941177,
      c: 27.04870440573241,
    },
    {
      b: 0,
      s: 10,
      tension: 59.1764705882353,
      friction: 11.149860108528394,
      k: 299.61882352941177,
      c: 34.44958032558518,
    },
    {
      b: 10,
      s: 10,
      tension: 59.1764705882353,
      friction: 6.524312658620409,
      k: 299.61882352941177,
      c: 20.572937975861226,
    },
    {
      b: 5,
      s: 20,
      tension: 117.8529411764706,
      friction: 11.423415204799563,
      k: 512.0276470588235,
      c: 35.27024561439869,
    },
    {
      b: 4,
      s: 12,
      tension: 70.91176470588235,
      friction: 9.828993216081418,
      k: 342.10058823529414,
      c: 30.486979648244255,
    },
  ];

  for (const row of table) {
    it(`bounciness ${row.b}, speed ${row.s} → k ${row.k.toFixed(4)}, c ${row.c.toFixed(4)}`, () => {
      const qc = bouncyConversion(row.b, row.s);
      expect(qc.tension).toBeCloseTo(row.tension, 10);
      expect(qc.friction).toBeCloseTo(row.friction, 10);
      const config = fromBouncinessSpeed(row.b, row.s);
      expect(config.mass).toBe(1);
      expect(config.stiffness).toBeCloseTo(row.k, 9);
      expect(config.damping).toBeCloseTo(row.c, 9);
    });
  }

  it("matches the research table's rounded damping ratios", () => {
    expect(dampingRatio(fromBouncinessSpeed(5, 10))).toBeCloseTo(0.781, 3);
    expect(dampingRatio(fromBouncinessSpeed(0, 10))).toBeCloseTo(0.995, 3);
    expect(dampingRatio(fromBouncinessSpeed(10, 10))).toBeCloseTo(0.594, 3);
  });

  it("speed 0 still yields k = 87.21", () => {
    expect(fromBouncinessSpeed(5, 0).stiffness).toBeCloseTo(87.21, 2);
  });

  it("OrigamiValueConverter anchors and the Rebound default config", () => {
    expect(tensionFromOrigamiValue(30)).toBe(194);
    expect(frictionFromOrigamiValue(8)).toBe(25);
    expect(tensionFromOrigamiValue(0)).toBe(0);
    expect(frictionFromOrigamiValue(0)).toBe(0);
    expect(origamiValueFromTension(194)).toBe(30);
    expect(origamiValueFromFriction(25)).toBe(8);
    const def = fromOrigamiTensionFriction(40, 7);
    expect(def.stiffness).toBeCloseTo(230.2, 10);
    expect(def.damping).toBeCloseTo(22, 10);
  });

  it("Apple response/damping fraction (SwiftUI defaults 0.55, 0.825)", () => {
    const config = fromResponseDampingFraction(0.55, 0.825);
    expect(config.stiffness).toBeCloseTo(130.51, 2);
    expect(config.damping).toBeCloseTo(18.85, 2);
  });
});

describe("converters round-trip", () => {
  it("bounciness/speed", () => {
    for (const [b, s] of [
      [5, 10],
      [0, 10],
      [10, 10],
      [20, 20],
      [4, 12],
      [1, 3],
      [-3, 8],
      [40, 15],
    ] as const) {
      const back = toBouncinessSpeed(fromBouncinessSpeed(b, s));
      expect(back.bounciness).toBeCloseTo(b, 6);
      expect(back.speed).toBeCloseTo(s, 6);
    }
  });

  it("bounciness/speed ignores mass scaling (same motion)", () => {
    const base = fromBouncinessSpeed(7, 14);
    const heavy = fromMassStiffnessDamping(3, base.stiffness * 3, base.damping * 3);
    const back = toBouncinessSpeed(heavy);
    expect(back.bounciness).toBeCloseTo(7, 6);
    expect(back.speed).toBeCloseTo(14, 6);
  });

  it("Origami tension/friction", () => {
    const qc = toOrigamiTensionFriction(fromOrigamiTensionFriction(55, 9.5));
    expect(qc.tension).toBeCloseTo(55, 10);
    expect(qc.friction).toBeCloseTo(9.5, 10);
  });

  it("response/damping fraction with mass", () => {
    const back = toResponseDampingFraction(fromResponseDampingFraction(0.42, 0.63, 2));
    expect(back.response).toBeCloseTo(0.42, 10);
    expect(back.dampingFraction).toBeCloseTo(0.63, 10);
  });

  it("duration/bounce including overdamped negative bounce", () => {
    for (const [d, b] of [
      [0.5, 0],
      [0.35, 0.2],
      [0.8, 0.6],
      [0.5, -0.5],
    ] as const) {
      const back = toDurationBounce(fromDurationBounce(d, b));
      expect(back.duration).toBeCloseTo(d, 10);
      expect(back.bounce).toBeCloseTo(b, 10);
    }
    expect(dampingRatio(fromDurationBounce(0.5, -0.5))).toBeCloseTo(2, 10);
  });

  it("springEquivalents reports every parameterization", () => {
    const eq = springEquivalents(fromBouncinessSpeed(5, 10));
    expect(eq.bounciness).toBeCloseTo(5, 6);
    expect(eq.speed).toBeCloseTo(10, 6);
    expect(eq.tension).toBeCloseTo(59.1764705882353, 9);
    expect(eq.friction).toBeCloseTo(8.68290146857747, 9);
    expect(eq.stiffness).toBeCloseTo(299.6188, 4);
    expect(eq.dampingFraction).toBeCloseTo(0.7813, 4);
    expect(eq.bounce).toBeCloseTo(1 - eq.dampingFraction, 10);
    expect(eq.response).toBeCloseTo((2 * Math.PI) / Math.sqrt(eq.stiffness), 10);
  });

  it("sanitizes invalid physical parameters", () => {
    const c = fromMassStiffnessDamping(0, -5, Number.NaN);
    expect(c.mass).toBeGreaterThan(0);
    expect(c.stiffness).toBe(0);
    expect(c.damping).toBe(0);
  });
});

describe("RK4 integration", () => {
  const pop = fromBouncinessSpeed(5, 10);

  it("matches an independent 1 ms RK4 reference exactly at whole milliseconds", () => {
    // Python port of the Rebound RK4 substep, run in 1 ms steps.
    const golden: [number, number, number][] = [
      [16, 0.033162555969021894, 3.841912388131914],
      [50, 0.23646526643549254, 7.25325115892287],
      [100, 0.5926033193758072, 6.326774007516203],
      [200, 0.9676245887479732, 1.5413973227300097],
      [300, 1.019358628752194, -0.047596304065321095],
      [500, 1.0003818830647258, -0.02475712909845949],
    ];
    const state = createSpringState(0, 1);
    let ms = 0;
    for (const [atMs, x, v] of golden) {
      while (ms < atMs) {
        stepSpring(state, pop, 0.001);
        ms++;
      }
      expect(state.value).toBeCloseTo(x, 11);
      expect(state.velocity).toBeCloseTo(v, 9);
    }
  });

  it("tracks the closed-form damped oscillator at 60 fps", () => {
    const state = createSpringState(0, 1);
    // Up to 0.5 s: past this the spring nears a turning point within the rest threshold and snaps.
    for (let frame = 1; frame <= 30; frame++) {
      stepSpring(state, pop, 1 / 60);
      const ref = analyticStep(pop, frame / 60);
      expect(Math.abs(state.value - ref.x)).toBeLessThan(1e-7);
      expect(Math.abs(state.velocity - ref.v)).toBeLessThan(1e-5);
    }
  });

  it("gives the same trajectory at any frame rate", () => {
    const a = runFor(pop, 0.5, 1 / 60);
    const b = runFor(pop, 0.5, 1 / 120);
    // Irregular frames (dropped frames, jitter) totalling 0.5 s.
    const c = createSpringState(0, 1);
    let elapsed = 0;
    for (let i = 0; elapsed < 0.5 - 1e-12; i++) {
      const dt = Math.min(0.004 + ((i * 7919) % 23) / 1000, 0.5 - elapsed);
      stepSpring(c, pop, dt);
      elapsed += dt;
    }
    expect(a.value).toBeCloseTo(b.value, 10);
    expect(a.velocity).toBeCloseTo(b.velocity, 8);
    expect(c.value).toBeCloseTo(a.value, 9);
    expect(c.velocity).toBeCloseTo(a.velocity, 7);
    expect(analyticStep(pop, 0.5).x).toBeCloseTo(a.value, 7);
  });

  it("caps a frame at 64 ms", () => {
    const long = createSpringState(0, 1);
    const capped = createSpringState(0, 1);
    stepSpring(long, pop, 2);
    stepSpring(capped, pop, 0.064);
    expect(long.value).toBe(capped.value);
    expect(long.velocity).toBe(capped.velocity);
  });

  it("ignores zero, negative, and NaN dt", () => {
    const state = createSpringState(0, 1);
    stepSpring(state, pop, 0);
    stepSpring(state, pop, -1);
    stepSpring(state, pop, Number.NaN);
    expect(state.value).toBe(0);
    expect(state.velocity).toBe(0);
  });

  it("supports mass (same motion as k/m, c/m)", () => {
    const heavy = fromMassStiffnessDamping(2, pop.stiffness * 2, pop.damping * 2);
    const a = runFor(pop, 0.3, 1 / 60);
    const b = runFor(heavy, 0.3, 1 / 60);
    expect(b.value).toBeCloseTo(a.value, 10);
  });

  it("stays stable for extremely damped springs", () => {
    const thick = fromMassStiffnessDamping(1, 100, 5000);
    const state = runFor(thick, 1, 1 / 60);
    expect(Number.isFinite(state.value)).toBe(true);
    expect(state.value).toBeGreaterThan(0);
    expect(state.value).toBeLessThan(1);
    // Overdamped slow root λ ≈ k/c = 0.02 → x(1) ≈ 1 − e^(−0.02)
    expect(state.value).toBeCloseTo(1 - Math.exp(-100 / 5000), 3);
  });
});

describe("rest detection", () => {
  const pop = fromBouncinessSpeed(5, 10);

  it("snaps to the target with zero velocity once within 0.001", () => {
    const state = createSpringState(0, 1);
    let frames = 0;
    while (!stepSpring(state, pop, 1 / 60)) {
      frames++;
      expect(frames).toBeLessThan(600);
    }
    expect(state.value).toBe(1);
    expect(state.velocity).toBe(0);
    expect(isSpringAtRest(state, pop)).toBe(true);
    const settle = estimateSettleTime(pop);
    expect(settle).not.toBeNull();
    expect(settle!).toBeGreaterThan(0.4);
    expect(settle!).toBeLessThan(1.2);
    expect(frames / 60).toBeCloseTo(settle!, 1);
  });

  it("is at rest immediately when value equals target", () => {
    const state = createSpringState(3, 3);
    expect(stepSpring(state, pop, 1 / 60)).toBe(true);
    expect(state.value).toBe(3);
  });

  it("a coasting spring (stiffness 0) stops where it is", () => {
    const coast = fromOrigamiTensionFriction(0, 7);
    expect(coast.stiffness).toBe(0);
    const state = createSpringState(0, 0, 100);
    let frames = 0;
    while (!stepSpring(state, coast, 1 / 60)) frames++;
    expect(frames).toBeGreaterThan(10);
    expect(state.velocity).toBe(0);
    expect(state.target).toBe(state.value);
    expect(state.value).toBeCloseTo(100 / coast.damping, 2);
  });

  it("an undamped spring never settles", () => {
    expect(estimateSettleTime(fromMassStiffnessDamping(1, 200, 0), { maxDuration: 3 })).toBeNull();
  });
});

describe("retargeting", () => {
  const pop = fromBouncinessSpeed(5, 10);

  it("preserves velocity (C¹ continuity)", () => {
    const state = createSpringState(0, 1);
    for (let i = 0; i < 6; i++) stepSpring(state, pop, 1 / 60);
    const v = state.velocity;
    const x = state.value;
    expect(v).toBeGreaterThan(1);
    setSpringTarget(state, -1);
    expect(state.velocity).toBe(v);
    expect(state.value).toBe(x);
    stepSpring(state, pop, 0.001);
    // One millisecond later velocity has only changed by ≈ acceleration × 1 ms.
    const accel = pop.stiffness * (-1 - x) - pop.damping * v;
    expect(state.velocity - v).toBeCloseTo(accel * 0.001, 1);
    expect(Math.abs(state.velocity - v)).toBeLessThan(1);
  });

  it("Spring class: setTarget keeps velocity, setValue jumps to rest, setVelocity injects", () => {
    const spring = new Spring(pop, 0).setTarget(10);
    spring.step(0.05);
    const v = spring.velocity;
    spring.setTarget(20);
    expect(spring.velocity).toBe(v);
    spring.setValue(4);
    expect(spring.value).toBe(4);
    expect(spring.target).toBe(4);
    expect(spring.atRest).toBe(true);
    spring.setVelocity(500);
    expect(spring.atRest).toBe(false);
    spring.step(0.05);
    expect(spring.value).toBeGreaterThan(4);
    spring.setValue(8, true);
    expect(spring.target).toBe(4);
    expect(spring.velocity).not.toBe(0);
  });
});

describe("vector springs", () => {
  const pop = fromBouncinessSpeed(8, 12);

  it("each component matches the scalar spring", () => {
    const vec = createVectorSpringState([0, 10, 1, 0.2], [100, -10, 0, 0.9]);
    const scalars = [
      createSpringState(0, 100),
      createSpringState(10, -10),
      createSpringState(1, 0),
      createSpringState(0.2, 0.9),
    ];
    for (let i = 0; i < 20; i++) {
      stepVectorSpring(vec, pop, 1 / 60);
      for (const s of scalars) stepSpring(s, pop, 1 / 60);
    }
    scalars.forEach((s, i) => {
      expect(vec.value[i]).toBeCloseTo(s.value, 12);
      expect(vec.velocity[i]).toBeCloseTo(s.velocity, 10);
    });
  });

  it("settles every component together and snaps exactly", () => {
    const spring = new VectorSpring(pop, [0, 0]).setTarget([50, -20]);
    let frames = 0;
    while (!spring.atRest && frames < 1000) {
      spring.step(1 / 60);
      frames++;
    }
    expect(spring.value).toEqual([50, -20]);
    expect(spring.velocity).toEqual([0, 0]);
  });

  it("retarget keeps velocity and adapts to dimension changes", () => {
    const state = createVectorSpringState([0, 0], [1, 1]);
    stepVectorSpring(state, pop, 0.05);
    const v = [...state.velocity];
    setVectorSpringTarget(state, [2, 2, 7]);
    expect(state.velocity.slice(0, 2)).toEqual(v);
    expect(state.value[2]).toBe(7);
    expect(state.velocity[2]).toBe(0);
    setVectorSpringTarget(state, [1]);
    expect(state.value.length).toBe(1);
  });
});

describe("presets and curve sampling", () => {
  it("defines smooth, snappy, bouncy, gentle with distinct feels", () => {
    expect(SPRING_PRESETS.map((p) => p.key)).toEqual(["smooth", "snappy", "bouncy", "gentle"]);
    for (const p of SPRING_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(10);
    }
    expect(dampingRatio(springPreset("smooth"))).toBeCloseTo(1, 10);
    const smooth = sampleSpringCurve(springPreset("smooth"), 0, 60);
    const bouncy = sampleSpringCurve(springPreset("bouncy"), 0, 60);
    expect(smooth.overshoot).toBeLessThan(1e-6);
    // Underdamped peak overshoot e^(−πζ/√(1−ζ²)) with ζ = 0.7; frame sampling can only miss the peak.
    const peak = Math.exp((-Math.PI * 0.7) / Math.sqrt(1 - 0.49));
    expect(bouncy.overshoot).toBeLessThanOrEqual(peak + 1e-9);
    expect(bouncy.overshoot).toBeGreaterThan(peak - 0.002);
    expect(estimateSettleTime(springPreset("snappy"))!).toBeLessThan(
      estimateSettleTime(springPreset("gentle"))!,
    );
  });

  it("samples a fixed duration at fps", () => {
    const curve = sampleSpringCurve(fromBouncinessSpeed(5, 10), 1, 60);
    expect(curve.times.length).toBe(61);
    expect(curve.values.length).toBe(61);
    expect(curve.values[0]).toBe(0);
    expect(curve.times[60]).toBeCloseTo(1, 12);
    expect(curve.values[60]).toBeCloseTo(1, 3);
    const zeta = dampingRatio(fromBouncinessSpeed(5, 10));
    expect(curve.overshoot).toBeCloseTo(
      Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)),
      2,
    );
    expect(curve.settleTime).not.toBeNull();
    expect(analyticStep(fromBouncinessSpeed(5, 10), 0.25).x).toBeCloseTo(curve.values[15]!, 6);
  });

  it("samples until settled when no duration is given, with custom from/to", () => {
    const curve = sampleSpringCurve(fromBouncinessSpeed(5, 10), 0, 30, { from: 100, to: 40 });
    expect(curve.values[0]).toBe(100);
    expect(curve.values.at(-1)).toBe(40);
    expect(curve.overshoot).toBeGreaterThan(0);
  });
});

describe("code generation", () => {
  it("SwiftUI", () => {
    expect(springToSwiftUI(springPreset("bouncy"))).toBe(".spring(duration: 0.5, bounce: 0.3)");
    expect(springToSwiftUI(springPreset("bouncy"), "responseDampingFraction")).toBe(
      ".spring(response: 0.5, dampingFraction: 0.7)",
    );
    expect(springToSwiftUI(fromBouncinessSpeed(5, 10), "interpolating")).toBe(
      ".interpolatingSpring(mass: 1, stiffness: 299.62, damping: 27.05)",
    );
  });

  it("CSS linear() reproduces the curve", () => {
    const config = fromBouncinessSpeed(5, 10);
    const css = springToCSSLinear(config);
    expect(css.easing.startsWith("linear(0, ")).toBe(true);
    expect(css.easing.endsWith(", 1)")).toBe(true);
    expect(css.durationMs).toBe(Math.round(estimateSettleTime(config)! * 1000));
    expect(css.css).toBe(`${css.durationMs}ms ${css.easing}`);

    const stops = css.easing
      .slice("linear(".length, -1)
      .split(", ")
      .map((part, i, all) => {
        const [value, pct] = part.split(" ");
        return {
          t: i === 0 ? 0 : i === all.length - 1 ? 1 : Number.parseFloat(pct!) / 100,
          v: Number.parseFloat(value!),
        };
      });
    expect(stops.length).toBeGreaterThan(5);
    expect(stops.length).toBeLessThan(60);
    for (let i = 1; i < stops.length; i++) expect(stops[i]!.t).toBeGreaterThan(stops[i - 1]!.t);
    const duration = css.durationMs / 1000;
    for (const t of [0.05, 0.1, 0.2, 0.3]) {
      const u = t / duration;
      const j = stops.findIndex((s) => s.t >= u);
      const a = stops[j - 1]!;
      const b = stops[j]!;
      const interpolated = a.v + ((u - a.t) / (b.t - a.t)) * (b.v - a.v);
      expect(Math.abs(interpolated - analyticStep(config, t).x)).toBeLessThan(0.01);
    }
  });

  it("CSS falls back to linear for springs that can't settle", () => {
    expect(springToCSSLinear(fromOrigamiTensionFriction(0, 7)).easing).toBe("linear");
  });

  it("motion.dev", () => {
    const { options, code } = springToMotion(fromBouncinessSpeed(5, 10));
    expect(options).toEqual({ type: "spring", stiffness: 299.62, damping: 27.05, mass: 1 });
    expect(code).toBe('{ type: "spring", stiffness: 299.62, damping: 27.05, mass: 1 }');
  });

  it("Android SpringForce and Compose", () => {
    const android = springToAndroid(fromBouncinessSpeed(5, 10));
    expect(android.stiffness).toBe(299.62);
    expect(android.dampingRatio).toBe(0.781);
    expect(android.code).toBe("SpringForce().setStiffness(299.62f).setDampingRatio(0.781f)");
    expect(android.compose).toBe("spring(dampingRatio = 0.781f, stiffness = 299.62f)");
  });
});
