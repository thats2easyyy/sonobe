/**
 * Springs: one physical model (mass, stiffness k, damping c) with every parameterization
 * designers and developers meet in the wild, a deterministic RK4 integrator, perceptual
 * presets, curve sampling for previews, and code generation for handoff.
 *
 * Compatibility: Pop Animation's (bounciness, speed) go through Rebound's BouncyConversion
 * and OrigamiValueConverter exactly as written in docs/research/semantics.md §7.2–7.5,
 * so values can be handed to POP, Rebound, and Rebound JS unchanged.
 */

import { simplifyPolyline, toCssLinear, type CurvePoint } from "../math/polyline.ts";
import { formatNumber } from "../math/vec.ts";

/** Physical spring parameters. Acceleration is `(k·(target − x) − c·v) / m`. */
export interface SpringConfig {
  mass: number;
  stiffness: number;
  damping: number;
}

/** Origami / Quartz Composer tension and friction (the scale Rebound calls "Origami values"). */
export interface OrigamiTensionFriction {
  tension: number;
  friction: number;
}

/** Pop Animation / POP / Rebound perceptual parameters. */
export interface BouncinessSpeed {
  bounciness: number;
  speed: number;
}

/** Apple `Spring(response:dampingRatio:)` and Origami's Spring Converter inputs. */
export interface ResponseDampingFraction {
  /** Approximate duration in seconds (the undamped period). */
  response: number;
  /** 0 oscillates forever, 1 is critically damped, above 1 is overdamped. */
  dampingFraction: number;
}

/** Apple `Spring(duration:bounce:)` (SwiftUI, iOS 17+). */
export interface DurationBounce {
  duration: number;
  /** 0 is no bounce, up to 1 for endless bounce; negative values are overdamped. */
  bounce: number;
}

/** Every equivalent parameterization of one spring, for inspectors and handoff. */
export interface SpringEquivalents
  extends
    SpringConfig,
    OrigamiTensionFriction,
    BouncinessSpeed,
    ResponseDampingFraction,
    DurationBounce {}

/** Rebound's fixed solver step (seconds). */
export const SPRING_SOLVER_TIMESTEP = 0.001;
/** Largest frame delta the spring integrates (seconds); longer frames are capped. */
export const SPRING_MAX_DELTA_TIME = 0.064;
/** Rest threshold on both displacement and speed (rebound-js and POP property threshold). */
export const SPRING_REST_THRESHOLD = 0.001;
/** Pop Animation defaults. */
export const DEFAULT_BOUNCINESS = 5;
export const DEFAULT_SPEED = 10;

// ---------------------------------------------------------------------------
// Rebound BouncyConversion + OrigamiValueConverter (exact)
// ---------------------------------------------------------------------------

const BOUNCY_NORMALIZATION_RANGE = 20;
const BOUNCY_NORMALIZATION_SCALE = 1.7;
const BOUNCINESS_NORMALIZED_MIN = 0;
const BOUNCINESS_NORMALIZED_MAX = 0.8;
const SPEED_NORMALIZED_MIN = 0.5;
const SPEED_NORMALIZED_MAX = 200;
const FRICTION_INTERPOLATION_MAX = 0.01;

function normalize(value: number, start: number, end: number): number {
  return (value - start) / (end - start);
}

function projectNormal(n: number, start: number, end: number): number {
  return start + n * (end - start);
}

function linearInterpolation(t: number, start: number, end: number): number {
  return t * end + (1 - t) * start;
}

function quadraticOutInterpolation(t: number, start: number, end: number): number {
  return linearInterpolation(2 * t - t * t, start, end);
}

function b3Friction1(x: number): number {
  return 0.0007 * x ** 3 - 0.031 * x ** 2 + 0.64 * x + 1.28;
}

function b3Friction2(x: number): number {
  return 0.000044 * x ** 3 - 0.006 * x ** 2 + 0.36 * x + 2.0;
}

function b3Friction3(x: number): number {
  return 0.00000045 * x ** 3 - 0.000332 * x ** 2 + 0.1078 * x + 5.84;
}

/** Rebound's "no bounce" friction fit for an Origami tension. */
export function b3Nobounce(tension: number): number {
  if (tension <= 18) return b3Friction1(tension);
  if (tension <= 44) return b3Friction2(tension);
  return b3Friction3(tension);
}

/** Rebound `BouncyConversion(bounciness, speed)` → Origami tension/friction. */
export function bouncyConversion(bounciness: number, speed: number): OrigamiTensionFriction {
  const b = projectNormal(
    normalize(bounciness / BOUNCY_NORMALIZATION_SCALE, 0, BOUNCY_NORMALIZATION_RANGE),
    BOUNCINESS_NORMALIZED_MIN,
    BOUNCINESS_NORMALIZED_MAX,
  );
  const s = normalize(speed / BOUNCY_NORMALIZATION_SCALE, 0, BOUNCY_NORMALIZATION_RANGE);
  const tension = projectNormal(s, SPEED_NORMALIZED_MIN, SPEED_NORMALIZED_MAX);
  const friction = quadraticOutInterpolation(b, b3Nobounce(tension), FRICTION_INTERPOLATION_MAX);
  return { tension, friction };
}

/**
 * Inverse of {@link bouncyConversion} (POP `convertTension:friction:toBounciness:speed:`).
 * Uses the smaller quadratic root, which round-trips for every bounciness up to 42.5.
 */
export function inverseBouncyConversion(tension: number, friction: number): BouncinessSpeed {
  const nb = b3Nobounce(tension);
  const a = nb - FRICTION_INTERPOLATION_MAX;
  const b = 2 * (FRICTION_INTERPOLATION_MAX - nb);
  const c = nb - friction;
  let normalizedBounciness: number;
  if (Math.abs(a) < 1e-12) {
    normalizedBounciness = b === 0 ? 0 : -c / b;
  } else {
    const disc = Math.max(0, b * b - 4 * a * c);
    normalizedBounciness = (-b - Math.sqrt(disc)) / (2 * a);
  }
  const bounciness =
    ((BOUNCY_NORMALIZATION_RANGE * BOUNCY_NORMALIZATION_SCALE) /
      (BOUNCINESS_NORMALIZED_MAX - BOUNCINESS_NORMALIZED_MIN)) *
    (normalizedBounciness - BOUNCINESS_NORMALIZED_MIN);
  const speed =
    ((BOUNCY_NORMALIZATION_RANGE * BOUNCY_NORMALIZATION_SCALE) /
      (SPEED_NORMALIZED_MAX - SPEED_NORMALIZED_MIN)) *
    (tension - SPEED_NORMALIZED_MIN);
  return { bounciness, speed };
}

/** Rebound `OrigamiValueConverter.tensionFromOrigamiValue` (0 stays 0). */
export function tensionFromOrigamiValue(value: number): number {
  return value === 0 ? 0 : (value - 30.0) * 3.62 + 194.0;
}

/** Rebound `OrigamiValueConverter.origamiValueFromTension` (0 stays 0). */
export function origamiValueFromTension(tension: number): number {
  return tension === 0 ? 0 : (tension - 194.0) / 3.62 + 30.0;
}

/** Rebound `OrigamiValueConverter.frictionFromOrigamiValue` (0 stays 0). */
export function frictionFromOrigamiValue(value: number): number {
  return value === 0 ? 0 : (value - 8.0) * 3.0 + 25.0;
}

/** Rebound `OrigamiValueConverter.origamiValueFromFriction` (0 stays 0). */
export function origamiValueFromFriction(friction: number): number {
  return friction === 0 ? 0 : (friction - 25.0) / 3.0 + 8.0;
}

// ---------------------------------------------------------------------------
// Config constructors and converters
// ---------------------------------------------------------------------------

const MIN_MASS = 1e-6;
const MIN_DURATION = 1e-4;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Physical spring. Mass is kept positive; stiffness and damping are kept ≥ 0. */
export function fromMassStiffnessDamping(
  mass: number,
  stiffness: number,
  damping: number,
): SpringConfig {
  return {
    mass: Math.max(MIN_MASS, finite(mass, 1)),
    stiffness: Math.max(0, finite(stiffness, 0)),
    damping: Math.max(0, finite(damping, 0)),
  };
}

/** Rebound `SpringConfig.fromOrigamiTensionAndFriction` (mass 1). */
export function fromOrigamiTensionFriction(tension: number, friction: number): SpringConfig {
  return fromMassStiffnessDamping(
    1,
    tensionFromOrigamiValue(tension),
    frictionFromOrigamiValue(friction),
  );
}

/** Rebound `SpringConfig.fromBouncinessAndSpeed`: what Pop Animation uses (mass 1). */
export function fromBouncinessSpeed(bounciness: number, speed: number): SpringConfig {
  const { tension, friction } = bouncyConversion(bounciness, speed);
  return fromOrigamiTensionFriction(tension, friction);
}

/** Apple response / damping fraction: `k = m·(2π/response)²`, `c = 4π·ζ·m/response`. */
export function fromResponseDampingFraction(
  response: number,
  dampingFraction: number,
  mass = 1,
): SpringConfig {
  const r = Math.max(MIN_DURATION, finite(response, 0.5));
  const m = Math.max(MIN_MASS, finite(mass, 1));
  const omega = (2 * Math.PI) / r;
  return fromMassStiffnessDamping(
    m,
    m * omega * omega,
    (4 * Math.PI * Math.max(0, finite(dampingFraction, 1)) * m) / r,
  );
}

/** Apple duration / bounce: `ζ = 1 − bounce` for bounce ≥ 0, `ζ = 1 / (1 + bounce)` below 0. */
export function fromDurationBounce(duration: number, bounce: number, mass = 1): SpringConfig {
  const b = Math.min(0.999999, Math.max(-0.999999, finite(bounce, 0)));
  const zeta = b >= 0 ? 1 - b : 1 / (1 + b);
  return fromResponseDampingFraction(duration, zeta, mass);
}

/** Damping ratio ζ = c / (2·√(k·m)); Infinity when stiffness is 0 and damping isn't. */
export function dampingRatio(config: SpringConfig): number {
  const denom = 2 * Math.sqrt(config.stiffness * config.mass);
  if (denom === 0) return config.damping > 0 ? Number.POSITIVE_INFINITY : 0;
  return config.damping / denom;
}

/** Origami tension/friction (normalizes mass to 1 without changing the motion). */
export function toOrigamiTensionFriction(config: SpringConfig): OrigamiTensionFriction {
  return {
    tension: origamiValueFromTension(config.stiffness / config.mass),
    friction: origamiValueFromFriction(config.damping / config.mass),
  };
}

/** Pop Animation bounciness/speed for the same motion. */
export function toBouncinessSpeed(config: SpringConfig): BouncinessSpeed {
  const { tension, friction } = toOrigamiTensionFriction(config);
  return inverseBouncyConversion(tension, friction);
}

export function toResponseDampingFraction(config: SpringConfig): ResponseDampingFraction {
  const omega = Math.sqrt(config.stiffness / config.mass);
  return {
    response: omega === 0 ? Number.POSITIVE_INFINITY : (2 * Math.PI) / omega,
    dampingFraction: dampingRatio(config),
  };
}

export function toDurationBounce(config: SpringConfig): DurationBounce {
  const { response, dampingFraction } = toResponseDampingFraction(config);
  const bounce = dampingFraction <= 1 ? 1 - dampingFraction : 1 / dampingFraction - 1;
  return { duration: response, bounce };
}

/** All parameterizations of `config` at once. */
export function springEquivalents(config: SpringConfig): SpringEquivalents {
  return {
    mass: config.mass,
    stiffness: config.stiffness,
    damping: config.damping,
    ...toOrigamiTensionFriction(config),
    ...toBouncinessSpeed(config),
    ...toResponseDampingFraction(config),
    ...toDurationBounce(config),
  };
}

// ---------------------------------------------------------------------------
// Perceptual presets
// ---------------------------------------------------------------------------

export type SpringPresetKey = "smooth" | "snappy" | "bouncy" | "gentle";

export interface SpringPreset extends DurationBounce {
  key: SpringPresetKey;
  name: string;
  description: string;
}

/** Named feels in picker order. Each maps to exact duration/bounce values. */
export const SPRING_PRESETS: readonly SpringPreset[] = [
  {
    key: "smooth",
    name: "Smooth",
    description: "Settles calmly with no overshoot. A safe default for screens, sheets, and fades.",
    duration: 0.5,
    bounce: 0,
  },
  {
    key: "snappy",
    name: "Snappy",
    description: "Quick with a hint of overshoot. Good for toggles, taps, and small UI.",
    duration: 0.3,
    bounce: 0.15,
  },
  {
    key: "bouncy",
    name: "Bouncy",
    description: "Playful overshoot that wobbles into place. Good for likes, badges, and delight.",
    duration: 0.5,
    bounce: 0.3,
  },
  {
    key: "gentle",
    name: "Gentle",
    description: "Slow and soft with a little give. Good for large surfaces and ambient motion.",
    duration: 0.75,
    bounce: 0.1,
  },
];

/** Spring config for a named preset. */
export function springPreset(key: SpringPresetKey): SpringConfig {
  const preset = SPRING_PRESETS.find((p) => p.key === key) ?? SPRING_PRESETS[0]!;
  return fromDurationBounce(preset.duration, preset.bounce);
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

/** Scalar spring state; plain data so it can live in per-loop-index patch state. */
export interface SpringState {
  value: number;
  velocity: number;
  target: number;
}

/** N-dimensional spring state (points, sizes, colors): independent springs sharing one config. */
export interface VectorSpringState {
  value: number[];
  velocity: number[];
  target: number[];
}

let outX = 0;
let outV = 0;

/**
 * Advance one component by `dt` seconds (already capped). Uses 1 ms RK4 substeps plus one
 * final partial substep, so the state lands exactly on the frame time and results agree at
 * any frame rate. Substeps shrink below 1 ms only for springs stiff or damped enough to be
 * unstable at 1 ms. Writes into `outX` / `outV`.
 */
function integrate(
  x: number,
  v: number,
  target: number,
  k: number,
  c: number,
  invMass: number,
  dt: number,
): void {
  const kk = k * invMass;
  const cc = c * invMass;
  let h = SPRING_SOLVER_TIMESTEP;
  const lambda = Math.max(cc, Math.sqrt(kk));
  if (lambda * h > 1) h = 1 / lambda;
  let remaining = dt;
  while (remaining > 1e-12) {
    const step = remaining < h ? remaining : h;
    const half = step * 0.5;
    const aV = v;
    const aA = kk * (target - x) - cc * v;
    const bX = x + aV * half;
    const bV = v + aA * half;
    const bA = kk * (target - bX) - cc * bV;
    const cX = x + bV * half;
    const cV = v + bA * half;
    const cA = kk * (target - cX) - cc * cV;
    const dX = x + cV * step;
    const dV = v + cA * step;
    const dA = kk * (target - dX) - cc * dV;
    x += ((aV + 2 * (bV + cV) + dV) / 6) * step;
    v += ((aA + 2 * (bA + cA) + dA) / 6) * step;
    remaining -= step;
  }
  outX = x;
  outV = v;
}

function capDelta(dt: number): number {
  if (!(dt > 0)) return 0;
  return dt > SPRING_MAX_DELTA_TIME ? SPRING_MAX_DELTA_TIME : dt;
}

function componentAtRest(
  x: number,
  v: number,
  target: number,
  k: number,
  threshold: number,
): boolean {
  return Math.abs(v) < threshold && (Math.abs(target - x) <= threshold || k === 0);
}

export function createSpringState(value = 0, target = value, velocity = 0): SpringState {
  return { value, velocity, target };
}

/** Retarget mid-flight. Velocity is untouched, so motion stays smooth (C¹). */
export function setSpringTarget(state: SpringState, target: number): void {
  state.target = target;
}

/** Rebound rest test: slow and at the target (or any position for a coasting spring). */
export function isSpringAtRest(
  state: SpringState,
  config: SpringConfig,
  threshold = SPRING_REST_THRESHOLD,
): boolean {
  return componentAtRest(state.value, state.velocity, state.target, config.stiffness, threshold);
}

/**
 * Advance a spring by `dt` seconds (capped at 64 ms). When it comes to rest it snaps to the
 * target with zero velocity (a coasting spring, stiffness 0, stops where it is).
 * Returns true when the spring is at rest.
 */
export function stepSpring(
  state: SpringState,
  config: SpringConfig,
  dt: number,
  threshold = SPRING_REST_THRESHOLD,
): boolean {
  const k = config.stiffness;
  if (!componentAtRest(state.value, state.velocity, state.target, k, threshold)) {
    const h = capDelta(dt);
    if (h > 0) {
      integrate(
        state.value,
        state.velocity,
        state.target,
        k,
        config.damping,
        1 / Math.max(MIN_MASS, config.mass),
        h,
      );
      if (Number.isFinite(outX) && Number.isFinite(outV)) {
        state.value = outX;
        state.velocity = outV;
      } else {
        state.value = state.target;
        state.velocity = 0;
      }
    }
    if (!componentAtRest(state.value, state.velocity, state.target, k, threshold)) return false;
  }
  if (k > 0) state.value = state.target;
  else state.target = state.value;
  state.velocity = 0;
  return true;
}

export function createVectorSpringState(
  value: readonly number[],
  target: readonly number[] = value,
  velocity?: readonly number[],
): VectorSpringState {
  const n = Math.max(value.length, target.length);
  const out: VectorSpringState = {
    value: new Array(n),
    velocity: new Array(n),
    target: new Array(n),
  };
  for (let i = 0; i < n; i++) {
    out.value[i] = value[i] ?? target[i] ?? 0;
    out.target[i] = target[i] ?? out.value[i]!;
    out.velocity[i] = velocity?.[i] ?? 0;
  }
  return out;
}

/**
 * Retarget a vector spring, preserving velocity. If the dimension grows, new components
 * start at their target at rest; if it shrinks, extra components are dropped.
 */
export function setVectorSpringTarget(state: VectorSpringState, target: readonly number[]): void {
  const n = target.length;
  for (let i = 0; i < n; i++) {
    if (i >= state.value.length) {
      state.value[i] = target[i]!;
      state.velocity[i] = 0;
    }
    state.target[i] = target[i]!;
  }
  state.value.length = n;
  state.velocity.length = n;
  state.target.length = n;
}

export function isVectorSpringAtRest(
  state: VectorSpringState,
  config: SpringConfig,
  threshold = SPRING_REST_THRESHOLD,
): boolean {
  for (let i = 0; i < state.value.length; i++) {
    if (
      !componentAtRest(
        state.value[i]!,
        state.velocity[i]!,
        state.target[i]!,
        config.stiffness,
        threshold,
      )
    )
      return false;
  }
  return true;
}

/** Vector form of {@link stepSpring}: snaps all components once every component is at rest. */
export function stepVectorSpring(
  state: VectorSpringState,
  config: SpringConfig,
  dt: number,
  threshold = SPRING_REST_THRESHOLD,
): boolean {
  const k = config.stiffness;
  const n = state.value.length;
  if (!isVectorSpringAtRest(state, config, threshold)) {
    const h = capDelta(dt);
    const invMass = 1 / Math.max(MIN_MASS, config.mass);
    if (h > 0) {
      for (let i = 0; i < n; i++) {
        integrate(
          state.value[i]!,
          state.velocity[i]!,
          state.target[i]!,
          k,
          config.damping,
          invMass,
          h,
        );
        if (Number.isFinite(outX) && Number.isFinite(outV)) {
          state.value[i] = outX;
          state.velocity[i] = outV;
        } else {
          state.value[i] = state.target[i]!;
          state.velocity[i] = 0;
        }
      }
    }
    if (!isVectorSpringAtRest(state, config, threshold)) return false;
  }
  for (let i = 0; i < n; i++) {
    if (k > 0) state.value[i] = state.target[i]!;
    else state.target[i] = state.value[i]!;
    state.velocity[i] = 0;
  }
  return true;
}

/** Object wrapper around {@link SpringState} for imperative use (previews, tools, tests). */
export class Spring {
  config: SpringConfig;
  readonly state: SpringState;

  constructor(config: SpringConfig, value = 0) {
    this.config = config;
    this.state = createSpringState(value);
  }

  get value(): number {
    return this.state.value;
  }

  get velocity(): number {
    return this.state.velocity;
  }

  get target(): number {
    return this.state.target;
  }

  get atRest(): boolean {
    return isSpringAtRest(this.state, this.config);
  }

  /** Animate toward `target`, keeping the current velocity. */
  setTarget(target: number): this {
    setSpringTarget(this.state, target);
    return this;
  }

  /** Jump to `value`. By default the spring comes to rest there; `keepMotion` keeps target and velocity. */
  setValue(value: number, keepMotion = false): this {
    this.state.value = value;
    if (!keepMotion) {
      this.state.target = value;
      this.state.velocity = 0;
    }
    return this;
  }

  /** Inject velocity (units per second), e.g. a gesture fling. */
  setVelocity(velocity: number): this {
    this.state.velocity = velocity;
    return this;
  }

  /** Advance by `dt` seconds and return the new value. */
  step(dt: number): number {
    stepSpring(this.state, this.config, dt);
    return this.state.value;
  }
}

/** Object wrapper around {@link VectorSpringState}. */
export class VectorSpring {
  config: SpringConfig;
  readonly state: VectorSpringState;

  constructor(config: SpringConfig, value: readonly number[]) {
    this.config = config;
    this.state = createVectorSpringState(value);
  }

  get value(): readonly number[] {
    return this.state.value;
  }

  get velocity(): readonly number[] {
    return this.state.velocity;
  }

  get atRest(): boolean {
    return isVectorSpringAtRest(this.state, this.config);
  }

  setTarget(target: readonly number[]): this {
    setVectorSpringTarget(this.state, target);
    return this;
  }

  setValue(value: readonly number[], keepMotion = false): this {
    if (!keepMotion) {
      const next = createVectorSpringState(value);
      this.state.value = next.value;
      this.state.target = next.target;
      this.state.velocity = next.velocity;
    } else {
      for (let i = 0; i < this.state.value.length; i++)
        this.state.value[i] = value[i] ?? this.state.value[i]!;
    }
    return this;
  }

  setVelocity(velocity: readonly number[]): this {
    for (let i = 0; i < this.state.velocity.length; i++) this.state.velocity[i] = velocity[i] ?? 0;
    return this;
  }

  step(dt: number): readonly number[] {
    stepVectorSpring(this.state, this.config, dt);
    return this.state.value;
  }
}

// ---------------------------------------------------------------------------
// Sampling (previews, settle time, traces)
// ---------------------------------------------------------------------------

export interface SpringMotionOptions {
  /** Start value (default 0). */
  from?: number;
  /** Target value (default 1). */
  to?: number;
  /** Initial velocity in units per second (default 0). */
  velocity?: number;
}

export interface SpringCurve {
  /** Seconds, `i / fps`. */
  times: number[];
  values: number[];
  /** Seconds until the spring came to rest, or null if it didn't within the sampled span. */
  settleTime: number | null;
  /** Largest excursion past the target as a fraction of the distance (0 = none). */
  overshoot: number;
}

/** Longest span sampled when no duration is given. */
export const SPRING_MAX_PREVIEW_DURATION = 10;

/**
 * Seconds until a spring from `from` to `to` comes to rest (1 ms resolution),
 * or null if it doesn't within `maxDuration`.
 */
export function estimateSettleTime(
  config: SpringConfig,
  options: SpringMotionOptions & { threshold?: number; maxDuration?: number } = {},
): number | null {
  const state = createSpringState(options.from ?? 0, options.to ?? 1, options.velocity ?? 0);
  const threshold = options.threshold ?? SPRING_REST_THRESHOLD;
  const max = options.maxDuration ?? SPRING_MAX_PREVIEW_DURATION;
  const steps = Math.ceil(max / SPRING_SOLVER_TIMESTEP);
  for (let i = 0; i <= steps; i++) {
    if (isSpringAtRest(state, config, threshold)) return i * SPRING_SOLVER_TIMESTEP;
    stepSpring(state, config, SPRING_SOLVER_TIMESTEP, threshold);
  }
  return null;
}

/**
 * Sample a spring's step response at `fps` for an inline curve preview. A non-positive or
 * non-finite `duration` samples until the spring settles (up to 10 s).
 */
export function sampleSpringCurve(
  config: SpringConfig,
  duration: number,
  fps = 60,
  options: SpringMotionOptions = {},
): SpringCurve {
  const from = options.from ?? 0;
  const to = options.to ?? 1;
  const rate = fps > 0 && Number.isFinite(fps) ? fps : 60;
  const settle = estimateSettleTime(config, {
    ...options,
    maxDuration: SPRING_MAX_PREVIEW_DURATION,
  });
  const span =
    duration > 0 && Number.isFinite(duration) ? duration : (settle ?? SPRING_MAX_PREVIEW_DURATION);
  const frames = Math.max(1, Math.ceil(span * rate - 1e-9));
  const state = createSpringState(from, to, options.velocity ?? 0);
  const times: number[] = [0];
  const values: number[] = [from];
  const distance = to - from;
  let overshoot = 0;
  for (let i = 1; i <= frames; i++) {
    stepSpring(state, config, 1 / rate);
    times.push(i / rate);
    values.push(state.value);
    if (distance !== 0) overshoot = Math.max(overshoot, (state.value - to) / distance);
  }
  return {
    times,
    values,
    settleTime: settle !== null && settle <= span + 1e-9 ? settle : null,
    overshoot,
  };
}

// ---------------------------------------------------------------------------
// Code generation for handoff
// ---------------------------------------------------------------------------

export type SwiftUISpringStyle = "durationBounce" | "responseDampingFraction" | "interpolating";

/**
 * SwiftUI animation expression, e.g. `.spring(duration: 0.5, bounce: 0.3)`.
 * `interpolating` emits exact mass/stiffness/damping.
 */
export function springToSwiftUI(
  config: SpringConfig,
  style: SwiftUISpringStyle = "durationBounce",
): string {
  if (style === "interpolating") {
    return `.interpolatingSpring(mass: ${formatNumber(config.mass, 3)}, stiffness: ${formatNumber(config.stiffness, 2)}, damping: ${formatNumber(config.damping, 2)})`;
  }
  if (style === "responseDampingFraction") {
    const { response, dampingFraction } = toResponseDampingFraction(config);
    return `.spring(response: ${formatNumber(response, 3)}, dampingFraction: ${formatNumber(dampingFraction, 3)})`;
  }
  const { duration, bounce } = toDurationBounce(config);
  return `.spring(duration: ${formatNumber(duration, 3)}, bounce: ${formatNumber(bounce, 3)})`;
}

export interface CSSLinearSpring {
  /** `linear(...)` timing function. */
  easing: string;
  /** Transition duration in milliseconds (the settle time). */
  durationMs: number;
  /** `"612ms linear(...)"`, ready for `transition` or `animation`. */
  css: string;
}

/**
 * CSS `linear()` easing that reproduces the spring's 0 → 1 step response within `tolerance`,
 * plus the duration to pair it with. Springs that never settle (no stiffness) fall back to `linear`.
 */
export function springToCSSLinear(
  config: SpringConfig,
  options: { tolerance?: number; maxDuration?: number } = {},
): CSSLinearSpring {
  const tolerance = options.tolerance ?? 0.002;
  const maxDuration = options.maxDuration ?? SPRING_MAX_PREVIEW_DURATION;
  if (!(config.stiffness > 0)) return { easing: "linear", durationMs: 0, css: "0ms linear" };
  const settle = estimateSettleTime(config, { maxDuration }) ?? maxDuration;
  const sampleRate = 240;
  const frames = Math.max(2, Math.ceil(settle * sampleRate));
  const state = createSpringState(0, 1);
  const points: CurvePoint[] = [[0, 0]];
  for (let i = 1; i < frames; i++) {
    stepSpring(state, config, settle / frames);
    points.push([i / frames, state.value]);
  }
  points.push([1, 1]);
  const easing = toCssLinear(simplifyPolyline(points, tolerance));
  const durationMs = Math.round(settle * 1000);
  return { easing, durationMs, css: `${durationMs}ms ${easing}` };
}

export interface MotionSpringOptions {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
}

/** motion.dev (Framer Motion) transition options with exact physics. */
export function springToMotion(config: SpringConfig): {
  options: MotionSpringOptions;
  code: string;
} {
  const options: MotionSpringOptions = {
    type: "spring",
    stiffness: Number(formatNumber(config.stiffness, 2)),
    damping: Number(formatNumber(config.damping, 2)),
    mass: Number(formatNumber(config.mass, 3)),
  };
  const code = `{ type: "spring", stiffness: ${options.stiffness}, damping: ${options.damping}, mass: ${options.mass} }`;
  return { options, code };
}

export interface AndroidSpring {
  /** `SpringForce` stiffness (mass normalized to 1). */
  stiffness: number;
  dampingRatio: number;
  /** AndroidX `SpringForce` (Kotlin). */
  code: string;
  /** Jetpack Compose `spring()` animation spec. */
  compose: string;
}

/** AndroidX `SpringForce` and Compose `spring()` equivalents. */
export function springToAndroid(config: SpringConfig): AndroidSpring {
  const stiffness = Number(formatNumber(config.stiffness / config.mass, 2));
  const ratio = Number(formatNumber(dampingRatio(config), 3));
  return {
    stiffness,
    dampingRatio: ratio,
    code: `SpringForce().setStiffness(${stiffness}f).setDampingRatio(${ratio}f)`,
    compose: `spring(dampingRatio = ${ratio}f, stiffness = ${stiffness}f)`,
  };
}
