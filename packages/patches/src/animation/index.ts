import type { PatchDefinition } from "@sonobe/engine";
import { arcTransition } from "./arcTransition.ts";
import { bouncyConverter } from "./bouncyConverter.ts";
import { classicAnimation } from "./classicAnimation.ts";
import { cubicBezierAnimation } from "./cubicBezierAnimation.ts";
import { cubicBezierCurve } from "./cubicBezierCurve.ts";
import { curve } from "./curve.ts";
import { fluidSpringAnimation } from "./fluidSpringAnimation.ts";
import { keyframes } from "./keyframes.ts";
import { popAnimation } from "./popAnimation.ts";
import { progress } from "./progress.ts";
import { repeatingAnimation } from "./repeatingAnimation.ts";
import { reverseProgress } from "./reverseProgress.ts";
import { smoothValue } from "./smoothValue.ts";
import { springAnimation } from "./springAnimation.ts";
import { springConverter } from "./springConverter.ts";
import { springPreset } from "./springPreset.ts";
import { transition } from "./transition.ts";
import { velocity } from "./velocity.ts";

export {
  arcTransition,
  bouncyConverter,
  classicAnimation,
  cubicBezierAnimation,
  cubicBezierCurve,
  curve,
  fluidSpringAnimation,
  keyframes,
  popAnimation,
  progress,
  repeatingAnimation,
  reverseProgress,
  smoothValue,
  springAnimation,
  springConverter,
  springPreset,
  transition,
  velocity,
};

/** Every animation patch in catalog order. */
export const definitions: PatchDefinition[] = [
  popAnimation,
  springAnimation,
  classicAnimation,
  transition,
  progress,
  reverseProgress,
  repeatingAnimation,
  smoothValue,
  velocity,
  springPreset,
  fluidSpringAnimation,
  springConverter,
  bouncyConverter,
  curve,
  cubicBezierCurve,
  cubicBezierAnimation,
  arcTransition,
  keyframes,
];
