/** Pop Switch: a two-state switch driven by a swipe, a pinch, or pulses, springing to Start or End. */

import { DECELERATION_FAST, createSpringState, decayFinalPosition, rubberBandClamp, stepSpring } from "@sonobe/engine";
import type { PointerInfo, SpringState } from "@sonobe/engine";
import { definePatch, finiteOr, popSpringConfig } from "../infra/index.ts";
import { ancestorScale, finiteInput, finitePoint, layerInput, type Vec2 } from "./shared.ts";

interface PopSwitchState {
  on: boolean;
  spring: SpringState;
  dragging: boolean;
  grab: number;
  ignoreUntilRelease: boolean;
  initialized: boolean;
  /** Pressed pointers on the layer last frame (a pinch begins when the second finger arrives). */
  fingers: number;
  /** The two pointer ids driving the pinch, in press order. */
  pinchIds: [number, number] | null;
  grabDistance: number;
  /** Unwrapped finger angle in degrees at the grab. */
  grabAngle: number;
  /** Unwrapped finger angle in degrees now, and the last raw atan2 angle it was unwrapped from. */
  angle: number;
  rawAngle: number;
  grabCentroid: Vec2;
  /** The pinch value last frame, for the velocity average; null right after a grab (no sample yet). */
  lastValue: number | null;
  trackedVelocity: number;
}

/** Drag resistance past Start or End. */
const RUBBER_BAND_RESISTANCE = 0.55;
/** Time constant of the pinch velocity average, in seconds. */
const PINCH_VELOCITY_SMOOTHING = 0.03;

const PINCH_GESTURES: ReadonlySet<string> = new Set(["pinchScale", "pinchRotate", "pinchX", "pinchY"]);

interface Pair {
  ids: [number, number];
  distance: number;
  /** Degrees, from the first finger toward the second. */
  angle: number;
  centroid: Vec2;
}

/** The first two pressed fingers with finite positions, or null with fewer than two. */
function fingerPair(pointers: readonly PointerInfo[]): Pair | null {
  const usable: { id: number; position: Vec2 }[] = [];
  for (const p of pointers) {
    const position = finitePoint(p.position);
    if (position) usable.push({ id: p.id, position });
    if (usable.length === 2) break;
  }
  if (usable.length < 2) return null;
  const [a, b] = usable as [{ id: number; position: Vec2 }, { id: number; position: Vec2 }];
  const dx = b.position[0] - a.position[0];
  const dy = b.position[1] - a.position[1];
  return {
    ids: [a.id, b.id],
    distance: Math.hypot(dx, dy),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    centroid: [(a.position[0] + b.position[0]) / 2, (a.position[1] + b.position[1]) / 2],
  };
}

function grabPair(state: PopSwitchState, pair: Pair): void {
  state.grab = state.spring.value;
  state.pinchIds = [pair.ids[0], pair.ids[1]];
  state.grabDistance = pair.distance;
  state.grabAngle = pair.angle;
  state.angle = pair.angle;
  state.rawAngle = pair.angle;
  state.grabCentroid = [pair.centroid[0], pair.centroid[1]];
  state.lastValue = null;
}

/** The gesture value for the current pair (see the catalog's Gestures rules). */
function pinchValue(state: PopSwitchState, gesture: string, pair: Pair): number {
  let delta = pair.angle - state.rawAngle;
  if (delta > 180) delta -= 360;
  else if (delta <= -180) delta += 360;
  state.angle += delta;
  state.rawAngle = pair.angle;
  switch (gesture) {
    case "pinchScale":
      return (state.grab * pair.distance) / Math.max(state.grabDistance, 1);
    case "pinchRotate":
      return state.grab + (state.angle - state.grabAngle);
    case "pinchX":
      return state.grab + (pair.centroid[0] - state.grabCentroid[0]);
    default:
      return state.grab + (pair.centroid[1] - state.grabCentroid[1]);
  }
}

export const popSwitch = definePatch<PopSwitchState>("popSwitch", {
  state: () => ({
    on: false,
    spring: createSpringState(0),
    dragging: false,
    grab: 0,
    ignoreUntilRelease: false,
    initialized: false,
    fingers: 0,
    pinchIds: null,
    grabDistance: 0,
    grabAngle: 0,
    angle: 0,
    rawAngle: 0,
    grabCentroid: [0, 0],
    lastValue: null,
    trackedVelocity: 0,
  }),
  evaluate(ctx) {
    const state = ctx.state;
    const start = finiteInput(ctx, "start");
    const end = finiteInput(ctx, "end");
    if (ctx.muted) {
      ctx.output("output", start);
      ctx.output("progress", 0);
      ctx.output("on", false);
      ctx.output("dragging", false);
      return;
    }
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const span = Math.max(hi - lo, 1);
    const config = popSpringConfig(finiteInput(ctx, "bounciness"), Math.max(finiteInput(ctx, "speed"), 0));
    if (!state.initialized) {
      state.spring = createSpringState(start);
      state.initialized = true;
    }
    const spring = state.spring;
    const ref = layerInput(ctx);
    const p = ctx.services.pointer(ref);
    const gesture = ctx.input<string>("gesture");
    const axis: 0 | 1 | null = gesture === "swipeX" ? 0 : gesture === "swipeY" ? 1 : null;
    const pinching = PINCH_GESTURES.has(gesture);
    const fingers = pinching ? ctx.services.pointers(ref) : [];

    const cancelDrag = () => {
      if (!state.dragging) return;
      state.dragging = false; // the spring keeps the tracked velocity
      state.ignoreUntilRelease = p.down;
    };
    const release = () => {
      const projected = spring.value + decayFinalPosition(0, spring.velocity, DECELERATION_FAST);
      const toEnd = Math.abs(projected - end);
      const toStart = Math.abs(projected - start);
      if (toEnd < toStart) state.on = true;
      else if (toStart < toEnd) state.on = false;
      state.dragging = false;
      state.pinchIds = null;
    };

    // 1. Pulses. Precedence: turnOff > turnOn > flip.
    if (ctx.pulsed("turnOff")) {
      if (state.on) {
        state.on = false;
        cancelDrag();
      }
    } else if (ctx.pulsed("turnOn")) {
      if (!state.on) {
        state.on = true;
        cancelDrag();
      }
    } else if (ctx.pulsed("flip")) {
      state.on = !state.on;
      cancelDrag();
    }

    // 2. Gesture.
    const enabled = ctx.input<boolean>("enabled") === true;
    if (enabled && axis !== null && !state.ignoreUntilRelease) {
      if (!state.dragging && p.began) {
        state.dragging = true;
        state.grab = spring.value;
        spring.velocity = 0;
      }
      if (state.dragging && (p.down || p.ended)) {
        const scale = ancestorScale(ctx.services, ref)[axis];
        const raw = state.grab + finiteOr(p.translation[axis], 0) / scale;
        spring.value = rubberBandClamp(raw, lo, hi, span, RUBBER_BAND_RESISTANCE);
        spring.velocity = finiteOr(p.velocity[axis], 0) / scale;
      }
      if (state.dragging && !p.down) release();
    } else if (enabled && pinching && !state.ignoreUntilRelease) {
      const pair = fingerPair(fingers);
      if (!state.dragging && pair && state.fingers < 2) {
        state.dragging = true;
        spring.velocity = 0;
        state.trackedVelocity = 0;
        grabPair(state, pair);
      } else if (state.dragging && pair && (state.pinchIds === null || pair.ids[0] !== state.pinchIds[0] || pair.ids[1] !== state.pinchIds[1])) {
        grabPair(state, pair); // a finger of the pair lifted while another is down: the new pair grabs from here
      }
      if (state.dragging && pair) {
        const raw = pinchValue(state, gesture, pair);
        if (state.lastValue !== null && ctx.dt > 0) {
          const alpha = 1 - Math.exp(-ctx.dt / PINCH_VELOCITY_SMOOTHING);
          state.trackedVelocity += ((raw - state.lastValue) / ctx.dt - state.trackedVelocity) * alpha;
        }
        state.lastValue = raw;
        spring.value = rubberBandClamp(raw, lo, hi, span, RUBBER_BAND_RESISTANCE);
        spring.velocity = Number.isFinite(state.trackedVelocity) ? state.trackedVelocity : 0;
      } else if (state.dragging) {
        release(); // down to one finger
      }
    } else if (state.dragging) {
      release(); // disabled, or the gesture changed mid-drag: release as if the fingers lifted
    }
    state.fingers = pinching ? fingers.length : p.pointerCount;
    if (!p.down) state.ignoreUntilRelease = false;

    // 3. Animate toward the committed state.
    spring.target = state.on ? end : start;
    if (state.dragging) ctx.requestNextFrame();
    else if (!stepSpring(spring, config, ctx.dt)) ctx.requestNextFrame();

    const progress = end !== start ? (spring.value - start) / (end - start) : spring.value >= start ? 1 : 0;
    ctx.output("output", spring.value);
    ctx.output("progress", Number.isFinite(progress) ? progress : 0);
    ctx.output("on", state.on);
    ctx.output("dragging", state.dragging);
  },
  mutedBehavior: "evaluate",
});
