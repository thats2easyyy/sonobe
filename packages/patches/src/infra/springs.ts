/**
 * Spring helpers over the engine physics: Pop Animation's input clamps, the Fluid Spring and
 * Spring Converter clamps, the shared `popCompatible` rule that maps any spring to Pop Bounciness
 * and Speed (CONVENTIONS.md §18.5.3), Spring Preset values, and per-index target tracking.
 */

import {
  DEFAULT_BOUNCINESS,
  SPRING_PRESETS,
  createVectorSpringState,
  fromBouncinessSpeed,
  fromResponseDampingFraction,
  inverseBouncyConversion,
  origamiValueFromFriction,
  origamiValueFromTension,
  setVectorSpringTarget,
} from "@sonobe/engine";
import type { BouncinessSpeed, SpringConfig, VectorSpringState } from "@sonobe/engine";
import { clamp, finiteOr, sameComponents } from "./values.ts";

/** Softest spring Pop Animation can make: Origami tension 0.5 (Speed 0). */
export const POP_MIN_STIFFNESS = 87.21;
/** Least damped spring Pop Animation can make: Origami friction 0.01 (Bounciness 42.5). */
export const POP_MIN_DAMPING = 1.03;
/** Shortest Response the spring patches accept, in seconds. */
export const MIN_SPRING_RESPONSE = 0.01;

const relErr = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

/**
 * Pop Animation Bounciness and Speed for a physical spring (mass 1). Uses the exact inverse when it
 * round-trips; otherwise the closest Pop spring: stiffness raised to 87.21 keeping the damping ratio,
 * and damping raised to at least 1.03. Spring Preset and Spring Converter share this rule.
 */
export function popCompatible(stiffness: number, damping: number, dampingFraction: number): BouncinessSpeed {
  const exact = inverseBouncyConversion(origamiValueFromTension(stiffness), origamiValueFromFriction(damping));
  const back = fromBouncinessSpeed(exact.bounciness, exact.speed);
  if (exact.speed >= 0 && relErr(back.stiffness, stiffness) <= 1e-6 && relErr(back.damping, damping) <= 1e-6) return exact;
  const k2 = Math.max(stiffness, POP_MIN_STIFFNESS);
  let c2 = k2 === stiffness ? damping : 2 * dampingFraction * Math.sqrt(k2);
  c2 = Math.max(c2, POP_MIN_DAMPING);
  return inverseBouncyConversion(origamiValueFromTension(k2), origamiValueFromFriction(c2));
}

/** Pop Animation's spring: Speed below 0 or non-finite acts as 0, non-finite Bounciness as 5; k and c stay ≥ 0. */
export function popSpringConfig(bounciness: number, speed: number): SpringConfig {
  const b = Number.isFinite(bounciness) ? bounciness : DEFAULT_BOUNCINESS;
  const s = Number.isFinite(speed) && speed > 0 ? speed : 0;
  return fromBouncinessSpeed(b, s);
}

/** Bouncy Converter: physical tension (k) and friction (c), mass 1, for Pop's Bounciness and Speed. */
export function bouncyConverterValues(bounciness: number, speed: number): { tension: number; friction: number } {
  const config = popSpringConfig(bounciness, speed);
  return { tension: config.stiffness, friction: config.damping };
}

/** Response and damping fraction after the spring patches' clamps: Response ≥ 0.01 s, Damping Fraction 0–2 (non-finite → 1). */
export function clampResponseDamping(response: number, dampingFraction: number): { response: number; dampingFraction: number } {
  return {
    response: Math.max(finiteOr(response, MIN_SPRING_RESPONSE), MIN_SPRING_RESPONSE),
    dampingFraction: clamp(finiteOr(dampingFraction, 1), 0, 2),
  };
}

/** `k = (2π / response)²`, `c = 4π · dampingFraction / response`, mass 1, after {@link clampResponseDamping}. */
export function fluidSpringConfig(response: number, dampingFraction: number): SpringConfig {
  const r = clampResponseDamping(response, dampingFraction);
  return fromResponseDampingFraction(r.response, r.dampingFraction, 1);
}

export interface SpringConverterValues {
  mass: number;
  tension: number;
  friction: number;
  bounciness: number;
  speed: number;
}

/** Spring Converter outputs for Response and Damping Fraction. */
export function springConverterValues(response: number, dampingFraction: number): SpringConverterValues {
  const r = clampResponseDamping(response, dampingFraction);
  const config = fromResponseDampingFraction(r.response, r.dampingFraction, 1);
  const pop = popCompatible(config.stiffness, config.damping, r.dampingFraction);
  return { mass: 1, tension: config.stiffness, friction: config.damping, bounciness: pop.bounciness, speed: pop.speed };
}

export interface SpringPresetValues extends SpringConverterValues {
  response: number;
  dampingFraction: number;
}

/**
 * Spring Preset outputs for a preset key (unknown keys act as Smooth). "custom" uses `duration`
 * (≤ 0.01 → 0.01, non-finite → 0.5) and `bounce` (clamped to ±0.999999).
 */
export function springPresetValues(preset: string, duration = 0.5, bounce = 0): SpringPresetValues {
  let d: number;
  let b: number;
  if (preset === "custom") {
    d = Math.max(MIN_SPRING_RESPONSE, finiteOr(duration, 0.5));
    b = clamp(finiteOr(bounce, 0), -0.999999, 0.999999);
  } else {
    const found = SPRING_PRESETS.find((p) => p.key === preset) ?? SPRING_PRESETS[0]!;
    d = found.duration;
    b = found.bounce;
  }
  const zeta = b >= 0 ? 1 - b : 1 / (1 + b);
  const config = fromResponseDampingFraction(d, zeta, 1);
  const pop = popCompatible(config.stiffness, config.damping, zeta);
  return {
    mass: 1,
    tension: config.stiffness,
    friction: config.damping,
    bounciness: pop.bounciness,
    speed: pop.speed,
    response: d,
    dampingFraction: zeta,
  };
}

/**
 * Per-index animation spring: created at rest on the first target, retargeted with velocity kept
 * when the target changes, and restarted at rest when the component count changes.
 */
export function trackSpringTarget(state: VectorSpringState | null | undefined, target: readonly number[]): VectorSpringState {
  if (!state || state.value.length !== target.length) return createVectorSpringState(target);
  if (!sameComponents(target, state.target)) setVectorSpringTarget(state, target);
  return state;
}
