/**
 * Momentum: POP decay (a fraction of velocity kept per millisecond), rubber banding past
 * bounds, and a MomentumScroller state machine for Scroll, Drag, Pop Switch, and the
 * Momentum Scrolling Engine patch. See docs/research/gap-fill.md §4.2.4 and R8.
 */

import { clamp } from "../math/vec.ts";
import {
  createSpringState,
  fromBouncinessSpeed,
  fromOrigamiTensionFriction,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "./spring.ts";

/** Velocity kept per millisecond at the normal (POP default) rate. */
export const DECELERATION_NORMAL = 0.998;
/** Velocity kept per millisecond at the fast rate. */
export const DECELERATION_FAST = 0.99;
/** POP decay property threshold. */
export const DECAY_REST_THRESHOLD = 0.001;
/** POP stops a decay once speed falls below threshold × 5. */
export const DECAY_MINIMAL_VELOCITY_FACTOR = 5;
/** Origami's Momentum Scrolling End Boundary default. */
export const DEFAULT_END_BOUNDARY = 99999;
/** iOS-style drag resistance past a bound. */
export const DEFAULT_RUBBER_BAND_RESISTANCE = 0.55;

/** Velocity after decaying for `t` seconds: `v · d^(1000·t)`. */
export function decayVelocity(velocity: number, deceleration: number, t: number): number {
  if (!(t > 0)) return velocity;
  if (deceleration >= 1) return velocity;
  if (deceleration <= 0) return 0;
  return velocity * deceleration ** (1000 * t);
}

/** Position after decaying for `t` seconds (closed form of the per-millisecond POP decay). */
export function decayPosition(
  position: number,
  velocity: number,
  deceleration: number,
  t: number,
): number {
  if (!(t > 0)) return position;
  if (deceleration >= 1) return position + velocity * t;
  if (deceleration <= 0) return position;
  const kv = deceleration ** (1000 * t);
  return position + ((velocity / 1000) * deceleration * (1 - kv)) / (1 - deceleration);
}

/** Where a decay eventually comes to rest. Infinite when there's no deceleration. */
export function decayFinalPosition(
  position: number,
  velocity: number,
  deceleration: number,
): number {
  if (deceleration >= 1)
    return velocity === 0 ? position : Math.sign(velocity) * Number.POSITIVE_INFINITY;
  if (deceleration <= 0) return position;
  return position + ((velocity / 1000) * deceleration) / (1 - deceleration);
}

/** POP decay duration: seconds until speed drops below `threshold × 5`. */
export function decayDuration(
  velocity: number,
  deceleration: number,
  threshold = DECAY_REST_THRESHOLD,
): number {
  const minSpeed = threshold * DECAY_MINIMAL_VELOCITY_FACTOR;
  const speed = Math.abs(velocity);
  if (speed <= minSpeed || deceleration <= 0) return 0;
  if (deceleration >= 1) return Number.POSITIVE_INFINITY;
  return Math.log(minSpeed / speed) / (Math.log(deceleration) * 1000);
}

/**
 * Seconds until a decay starting at `position` crosses `target`, or null if it never gets
 * there (moving away, or it stops short).
 */
export function decayTimeToReach(
  position: number,
  velocity: number,
  deceleration: number,
  target: number,
): number | null {
  const distance = target - position;
  if (distance === 0) return 0;
  if (velocity === 0 || Math.sign(distance) !== Math.sign(velocity)) return null;
  if (deceleration >= 1) return distance / velocity;
  if (deceleration <= 0) return null;
  const q = (distance * (1 - deceleration) * 1000) / (velocity * deceleration);
  if (q >= 1) return null;
  return Math.log(1 - q) / (1000 * Math.log(deceleration));
}

/**
 * Resisted overscroll distance for a raw `offset` past a bound:
 * `(1 − 1 / (|x|·c/d + 1)) · d`, approaching `d` (the viewport size) as the offset grows.
 */
export function rubberBand(
  offset: number,
  dimension: number,
  resistance = DEFAULT_RUBBER_BAND_RESISTANCE,
): number {
  if (offset === 0 || resistance <= 0) return 0;
  if (dimension <= 0) return offset * resistance;
  const x = Math.abs(offset);
  return Math.sign(offset) * (1 - 1 / ((x * resistance) / dimension + 1)) * dimension;
}

/** Raw offset that {@link rubberBand} maps to `value`. */
export function inverseRubberBand(
  value: number,
  dimension: number,
  resistance = DEFAULT_RUBBER_BAND_RESISTANCE,
): number {
  if (value === 0 || resistance <= 0) return 0;
  if (dimension <= 0) return value / resistance;
  const f = Math.min(Math.abs(value), dimension * 0.999999);
  return (Math.sign(value) * (f * dimension)) / (resistance * (dimension - f));
}

/** Constrain a raw value to [min, max] with rubber-band resistance beyond the bounds. */
export function rubberBandClamp(
  value: number,
  min: number,
  max: number,
  dimension: number,
  resistance = DEFAULT_RUBBER_BAND_RESISTANCE,
): number {
  if (value < min) return min + rubberBand(value - min, dimension, resistance);
  if (value > max) return max + rubberBand(value - max, dimension, resistance);
  return value;
}

/** Inverse of {@link rubberBandClamp}. */
export function inverseRubberBandClamp(
  value: number,
  min: number,
  max: number,
  dimension: number,
  resistance = DEFAULT_RUBBER_BAND_RESISTANCE,
): number {
  if (value < min) return min + inverseRubberBand(value - min, dimension, resistance);
  if (value > max) return max + inverseRubberBand(value - max, dimension, resistance);
  return value;
}

/**
 * - `idle`: not moving (settled inside the bounds).
 * - `tracking`: following a finger or a sampled value.
 * - `decelerating`: coasting after release.
 * - `rubberBanding`: springing back to the nearest bound after overscroll.
 * - `snapping`: springing to a page or a jump target.
 */
export type MomentumPhase = "idle" | "tracking" | "decelerating" | "rubberBanding" | "snapping";

export interface MomentumScrollerOptions {
  /** Start boundary (lowest value). */
  min: number;
  /** End boundary (highest value). */
  max: number;
  /** Fraction of velocity kept per millisecond while coasting. */
  deceleration: number;
  /** Coast after release. When off, release stops (overscroll still springs back). */
  momentum: boolean;
  /** Hard stop at the bounds: no overscroll while dragging or coasting. */
  stickToBoundaries: boolean;
  /** Origami tension of the spring that pulls an overscrolled value back. */
  rubberBandTension: number;
  /** Origami friction of that spring. */
  rubberBandFriction: number;
  /** Drag resistance past a bound: 0 rigid, 1 free, iOS ≈ 0.55. */
  rubberBandResistance: number;
  /** Viewport size along this axis; scales how far a drag can overscroll. */
  viewportSize: number;
  /** Snap to multiples of this size after release; 0 turns paging off. */
  pageSize: number;
  /** Value of page 0. */
  pageOffset: number;
  /** Most pages one fling can advance. */
  maxPagesPerFling: number;
  /** Spring for paging and animated jumps. */
  snapSpring: SpringConfig;
  /** Coasting stops below this speed (units per second). */
  restSpeed: number;
}

export const DEFAULT_MOMENTUM_OPTIONS: Readonly<MomentumScrollerOptions> = {
  min: 0,
  max: DEFAULT_END_BOUNDARY,
  deceleration: DECELERATION_NORMAL,
  momentum: true,
  stickToBoundaries: false,
  rubberBandTension: 40,
  rubberBandFriction: 10,
  rubberBandResistance: DEFAULT_RUBBER_BAND_RESISTANCE,
  viewportSize: 400,
  pageSize: 0,
  pageOffset: 0,
  maxPagesPerFling: 1,
  snapSpring: fromBouncinessSpeed(0, 12),
  restSpeed: 0.25,
};

const VELOCITY_SMOOTHING = 0.03;
const MAX_DT = 0.064;

/**
 * One-axis momentum primitive: track a drag, release with velocity, coast with POP decay,
 * rubber-band past the bounds, and optionally snap to pages. Deterministic given the same
 * calls and `dt` sequence.
 */
export class MomentumScroller {
  options: MomentumScrollerOptions;
  value: number;
  /** Units per second. */
  velocity = 0;
  phase: MomentumPhase = "idle";

  private rubberSpring: SpringConfig;
  private spring: SpringState = createSpringState();
  private rawStart = 0;
  private translation = 0;
  private startPage = 0;
  private lastTrackedValue = 0;
  private trackedVelocity = 0;
  private trackedThisFrame = false;

  constructor(options: Partial<MomentumScrollerOptions> = {}, value = 0) {
    this.options = { ...DEFAULT_MOMENTUM_OPTIONS, ...options };
    this.rubberSpring = fromOrigamiTensionFriction(
      this.options.rubberBandTension,
      this.options.rubberBandFriction,
    );
    this.value = clamp(value, this.options.min, Math.max(this.options.min, this.options.max));
    this.lastTrackedValue = this.value;
  }

  /** Update options (bounds, paging, feel). Takes effect on the next step. */
  setOptions(options: Partial<MomentumScrollerOptions>): void {
    this.options = { ...this.options, ...options };
    this.rubberSpring = fromOrigamiTensionFriction(
      this.options.rubberBandTension,
      this.options.rubberBandFriction,
    );
  }

  /** Current page index (0 when paging is off). */
  get page(): number {
    const { pageSize, pageOffset } = this.options;
    return pageSize > 0 ? Math.round((this.value - pageOffset) / pageSize) : 0;
  }

  /** True while coasting, springing back, or snapping. */
  get isAnimating(): boolean {
    return (
      this.phase === "decelerating" || this.phase === "rubberBanding" || this.phase === "snapping"
    );
  }

  private get maxBound(): number {
    return Math.max(this.options.min, this.options.max);
  }

  /** Start following a drag. Catches any animation in flight. */
  beginDrag(): void {
    const { min, viewportSize, rubberBandResistance } = this.options;
    this.rawStart = inverseRubberBandClamp(
      this.value,
      min,
      this.maxBound,
      viewportSize,
      rubberBandResistance,
    );
    this.translation = 0;
    this.startPage = this.page;
    this.velocity = 0;
    this.trackedVelocity = 0;
    this.lastTrackedValue = this.value;
    this.phase = "tracking";
  }

  /** Drag to `translation` units from where the drag began, with resistance past the bounds. */
  dragTo(translation: number): void {
    if (this.phase !== "tracking") this.beginDrag();
    this.translation = translation;
    const raw = this.rawStart + translation;
    const { min, stickToBoundaries, viewportSize, rubberBandResistance } = this.options;
    this.value = stickToBoundaries
      ? clamp(raw, min, this.maxBound)
      : rubberBandClamp(raw, min, this.maxBound, viewportSize, rubberBandResistance);
    this.trackedThisFrame = true;
  }

  /** Drag by `delta` more units. */
  dragBy(delta: number): void {
    if (this.phase !== "tracking") this.beginDrag();
    this.dragTo(this.translation + delta);
  }

  /** Follow an externally computed value directly (Momentum Scrolling Engine "Sample Value"). */
  track(value: number): void {
    if (this.phase !== "tracking") this.beginDrag();
    this.value = value;
    this.trackedThisFrame = true;
  }

  /**
   * End tracking. `velocity` (units per second) defaults to the velocity estimated from
   * tracked values. Chooses paging, rubber banding, coasting, or stopping.
   */
  release(velocity?: number): void {
    const v = velocity ?? this.trackedVelocity;
    const { min, momentum, stickToBoundaries, pageSize, pageOffset, maxPagesPerFling, restSpeed } =
      this.options;
    const max = this.maxBound;
    if (stickToBoundaries) this.value = clamp(this.value, min, max);

    if (pageSize > 0) {
      const projected = this.value + (momentum ? decayFinalPosition(0, v, DECELERATION_FAST) : 0);
      let page = Math.round((projected - pageOffset) / pageSize);
      const limit = Math.max(0, Math.floor(maxPagesPerFling));
      page = clamp(page, this.startPage - limit, this.startPage + limit);
      this.startSpring("snapping", clamp(pageOffset + page * pageSize, min, max), v);
      return;
    }
    if (this.value < min || this.value > max) {
      this.startSpring("rubberBanding", this.value < min ? min : max, v);
      return;
    }
    if (momentum && Math.abs(v) > restSpeed) {
      this.velocity = v;
      this.phase = "decelerating";
      return;
    }
    this.velocity = 0;
    this.phase = "idle";
  }

  /** Move to `value` (clamped to the bounds), instantly or with the snap spring. */
  jumpTo(value: number, animated = false): void {
    const target = clamp(value, this.options.min, this.maxBound);
    if (animated) {
      this.startSpring("snapping", target, this.velocity);
    } else {
      this.value = target;
      this.velocity = 0;
      this.phase = "idle";
    }
  }

  /** Stop where it is. An overscrolled value still springs back on the next step. */
  stop(): void {
    this.velocity = 0;
    this.phase = "idle";
  }

  /** Advance by `dt` seconds (capped at 64 ms) and return the value. */
  step(dt: number): number {
    const h = dt > 0 ? Math.min(dt, MAX_DT) : 0;
    switch (this.phase) {
      case "tracking":
        this.updateTrackedVelocity(h);
        break;
      case "decelerating":
        this.stepDecay(h);
        break;
      case "rubberBanding":
      case "snapping":
        this.stepSpringPhase(h);
        break;
      case "idle":
        this.settleOutOfBounds(h);
        break;
    }
    return this.value;
  }

  private updateTrackedVelocity(h: number): void {
    if (h <= 0) return;
    if (this.trackedThisFrame || this.value !== this.lastTrackedValue) {
      const sample = (this.value - this.lastTrackedValue) / h;
      const alpha = 1 - Math.exp(-h / VELOCITY_SMOOTHING);
      this.trackedVelocity += (sample - this.trackedVelocity) * alpha;
    } else {
      this.trackedVelocity *= Math.exp(-h / VELOCITY_SMOOTHING);
    }
    this.lastTrackedValue = this.value;
    this.trackedThisFrame = false;
    this.velocity = this.trackedVelocity;
  }

  private startSpring(phase: "rubberBanding" | "snapping", target: number, velocity: number): void {
    this.spring = createSpringState(this.value, target, velocity);
    this.velocity = velocity;
    this.phase = phase;
  }

  private stepSpringPhase(h: number): void {
    const config = this.phase === "snapping" ? this.options.snapSpring : this.rubberSpring;
    const atRest = stepSpring(this.spring, config, h);
    this.value = this.spring.value;
    this.velocity = this.spring.velocity;
    if (atRest) {
      this.velocity = 0;
      this.phase = "idle";
    }
  }

  private stepDecay(h: number): void {
    const { min, deceleration, stickToBoundaries, restSpeed } = this.options;
    const max = this.maxBound;
    if (this.value < min || this.value > max) {
      this.startSpring("rubberBanding", this.value < min ? min : max, this.velocity);
      this.stepSpringPhase(h);
      return;
    }
    const bound = this.velocity > 0 ? max : min;
    const hit = decayTimeToReach(this.value, this.velocity, deceleration, bound);
    if (hit !== null && hit <= h) {
      const v = decayVelocity(this.velocity, deceleration, hit);
      this.value = bound;
      if (stickToBoundaries) {
        this.velocity = 0;
        this.phase = "idle";
        return;
      }
      this.startSpring("rubberBanding", bound, v);
      this.stepSpringPhase(h - hit);
      return;
    }
    this.value = decayPosition(this.value, this.velocity, deceleration, h);
    this.velocity = decayVelocity(this.velocity, deceleration, h);
    if (Math.abs(this.velocity) < restSpeed) {
      this.velocity = 0;
      this.phase = "idle";
    }
  }

  private settleOutOfBounds(h: number): void {
    const { min, stickToBoundaries } = this.options;
    const max = this.maxBound;
    if (this.value >= min && this.value <= max) return;
    if (stickToBoundaries) {
      this.value = clamp(this.value, min, max);
      this.velocity = 0;
      return;
    }
    this.startSpring("rubberBanding", this.value < min ? min : max, 0);
    this.stepSpringPhase(h);
  }
}
