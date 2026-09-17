/**
 * Helpers shared by the animation patches: variant lookup, muted behavior, finite targets, the
 * gesture-handoff spring behind Spring Animation and Fluid Spring Animation, and CSS cubic Bézier
 * easing with straight-line extension outside 0–1.
 */

import { resolveTypeParam } from "@sonobe/core";
import type { PatchSpec, ValueType } from "@sonobe/core";
import { SPRING_MAX_DELTA_TIME, SPRING_SOLVER_TIMESTEP, createVectorSpringState, cubicBezier, setVectorSpringTarget, stepVectorSpring } from "@sonobe/engine";
import type { MutedBehavior, PatchContext, PatchDefinition, RuntimePatchDefinition, SpringConfig, VectorSpringState } from "@sonobe/engine";
import { clamp, components, sameComponents, warnOnce } from "../infra/index.ts";
import type { OnceContext } from "../infra/index.ts";
import { getSpec } from "../specs.ts";

/** The catalog spec for `type`; throws when the catalog doesn't have it. */
export function requireSpec(type: string): PatchSpec {
  const spec = getSpec(type);
  if (!spec) throw new Error(`animation: "${type}" isn't in the patch catalog.`);
  return spec;
}

/** The effective variant: the node's typeParam when the spec allows it, else the first variant. */
export function variantOf(ctx: Pick<PatchContext, "typeParam">, spec: PatchSpec): ValueType {
  return resolveTypeParam(spec, ctx.typeParam) ?? "number";
}

/** Declare how the runtime treats the patch while muted (engine extension, see engine README). */
export function withMutedBehavior<S>(definition: PatchDefinition<S>, mutedBehavior: MutedBehavior): RuntimePatchDefinition<S> {
  const runtimeDefinition: RuntimePatchDefinition<S> = definition;
  runtimeDefinition.mutedBehavior = mutedBehavior;
  return runtimeDefinition;
}

/**
 * Numeric components of `value` for `type`. A non-finite component keeps `previous[i]` (0 when
 * there's no finite previous component) and logs `message` once per restart.
 */
export function finiteComponents(ctx: OnceContext, value: unknown, type: ValueType, previous: readonly number[] | undefined, key: string, message: string): number[] {
  const values = components(value, type);
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i])) continue;
    const fallback = previous !== undefined && previous.length === values.length ? previous[i] : undefined;
    values[i] = fallback !== undefined && Number.isFinite(fallback) ? fallback : 0;
    warnOnce(ctx, key, message);
  }
  return values;
}

/** A number input when finite; otherwise `fallback`, logging `message` once per restart. */
export function finiteInput(ctx: OnceContext & Pick<PatchContext, "input">, key: string, fallback: number, message: string): number {
  const value = ctx.input<number>(key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  warnOnce(ctx, key, message);
  return fallback;
}

// ---------------------------------------------------------------------------
// Springs with gesture handoff
// ---------------------------------------------------------------------------

/** Most RK4 substeps a spring component may take in one frame before it snaps to its target. */
export const MAX_SPRING_SUBSTEPS = 10_000;

export interface GestureSpringState {
  spring: VectorSpringState | null;
  wasActive: boolean;
}

export function createGestureSpringState(): GestureSpringState {
  return { spring: null, wasActive: false };
}

/** Substeps the engine integrator needs for one frame of `config` (it shrinks steps below 1 ms for stiff springs). */
function substepsFor(config: SpringConfig, dt: number): number {
  const h = dt > 0 ? Math.min(dt, SPRING_MAX_DELTA_TIME) : 0;
  const invMass = 1 / config.mass;
  const lambda = Math.max(config.damping * invMass, Math.sqrt(config.stiffness * invMass));
  const step = lambda * SPRING_SOLVER_TIMESTEP > 1 ? 1 / lambda : SPRING_SOLVER_TIMESTEP;
  return h / step;
}

export interface GestureSpringOptions {
  /** Components to spring toward (already finite). */
  target: readonly number[];
  config: SpringConfig;
  /** Gesture Active: while true the value tracks the target with zero velocity. */
  active: boolean;
  /** Read on the active → inactive frame only: the fling velocity per component. */
  gestureVelocity: () => readonly number[];
  /** Logged once per restart when the spring is too stiff to integrate and snaps instead. */
  tooStiffMessage: string;
}

/**
 * One frame of a spring with gesture handoff. The spring starts at rest on its first target (and
 * restarts there when the component count changes); a new target keeps position and velocity; while
 * active the value follows the target; on the falling edge the gesture velocity becomes the velocity
 * before this frame integrates. Returns the spring's current components.
 */
export function stepGestureSpring(ctx: OnceContext & Pick<PatchContext, "dt" | "requestNextFrame">, state: GestureSpringState, options: GestureSpringOptions): readonly number[] {
  const { target, config, active } = options;
  if (state.spring === null || state.spring.value.length !== target.length) {
    state.spring = createVectorSpringState(target);
    state.wasActive = active;
  } else if (!sameComponents(target, state.spring.target)) {
    setVectorSpringTarget(state.spring, target);
  }
  const spring = state.spring;
  if (active) {
    for (let i = 0; i < target.length; i++) {
      spring.value[i] = target[i]!;
      spring.velocity[i] = 0;
    }
  } else {
    if (state.wasActive) {
      const velocity = options.gestureVelocity();
      for (let i = 0; i < spring.velocity.length; i++) spring.velocity[i] = velocity[i] ?? 0;
    }
    if (substepsFor(config, ctx.dt) > MAX_SPRING_SUBSTEPS) {
      warnOnce(ctx, "tooStiff", options.tooStiffMessage);
      for (let i = 0; i < spring.value.length; i++) {
        if (config.stiffness > 0) spring.value[i] = spring.target[i]!;
        else spring.target[i] = spring.value[i]!;
        spring.velocity[i] = 0;
      }
    } else if (!stepVectorSpring(spring, config, ctx.dt)) {
      ctx.requestNextFrame();
    }
  }
  state.wasActive = active;
  return spring.value;
}

// ---------------------------------------------------------------------------
// Cubic Bézier easing
// ---------------------------------------------------------------------------

const BEZIER_CONTROLS = [
  ["control1X", "Control 1 X", 0.42],
  ["control1Y", "Control 1 Y", 0],
  ["control2X", "Control 2 X", 0.58],
  ["control2Y", "Control 2 Y", 1],
] as const;

/** The four control inputs, non-finite values replaced by the CSS ease-in-out defaults (warning once) and X clamped to 0–1. */
export function readBezierControls(ctx: OnceContext & Pick<PatchContext, "input">, patchName: string): [number, number, number, number] {
  const [x1, y1, x2, y2] = BEZIER_CONTROLS.map(([key, name, fallback]) =>
    finiteInput(ctx, key, fallback, `${patchName}: ${name} isn't a finite number, so it uses ${fallback}.`),
  ) as [number, number, number, number];
  return [clamp(x1, 0, 1), y1, clamp(x2, 0, 1), y2];
}

/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` at progress `p` (x controls clamped to 0–1). Below 0 it continues
 * in a straight line toward the first control point off the y axis; above 1 toward the last control
 * point off x = 1. Non-finite progress gives 0.
 */
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number, p: number): number {
  const ax1 = clamp(x1, 0, 1);
  const ax2 = clamp(x2, 0, 1);
  if (!Number.isFinite(p)) return 0;
  if (p < 0) {
    const slope = ax1 > 0 ? y1 / ax1 : ax2 > 0 ? y2 / ax2 : 0;
    return slope * p;
  }
  if (p > 1) {
    const slope = ax2 < 1 ? (y2 - 1) / (ax2 - 1) : ax1 < 1 ? (y1 - 1) / (ax1 - 1) : 0;
    return 1 + slope * (p - 1);
  }
  return cubicBezier(ax1, y1, ax2, y2)(p);
}
