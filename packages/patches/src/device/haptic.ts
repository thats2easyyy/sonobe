/**
 * Haptic: plays a feedback type on a pulse through native haptics where the host has them, else as
 * a Vibration API pattern (Custom Pattern converts Core Haptics AHAP JSON), else logs.
 */

import type { HapticServices } from "@sonobe/engine";
import { definePatch, isPlainObject, toText, warnOnce } from "../infra/index.ts";


/** Vibration patterns in milliseconds (on, off, on, …) per type; null where a phone has no equivalent. */
export const VIBRATION_PLANS: Readonly<Record<string, readonly number[] | null>> = {
  vibrate: [400],
  selection: [8],
  impactLight: [12],
  impactMedium: [20],
  impactHeavy: [35],
  notificationSuccess: [15, 80, 25],
  notificationWarning: [25, 100, 25],
  notificationError: [20, 60, 20, 60, 30],
  alignment: null,
  levelChange: null,
  customPattern: null,
};

const MAX_PATTERN_MS = 10_000;
const TRANSIENT_MS = 12;

/** A Core Haptics pattern as a vibration plan, or the problem that stops it from converting. */
export function ahapToVibration(pattern: unknown): { plan: number[] | null; problem?: string } {
  if (!isPlainObject(pattern) || !Array.isArray(pattern.Pattern)) {
    return { plan: null, problem: "Haptic: Pattern isn't a Core Haptics pattern (an object with a Pattern list), so Custom Pattern plays nothing." };
  }
  const spans: [number, number][] = [];
  for (const entry of pattern.Pattern) {
    const event = isPlainObject(entry) ? entry.Event : undefined;
    if (!isPlainObject(event)) continue;
    const time = typeof event.Time === "number" && Number.isFinite(event.Time) ? Math.max(0, event.Time) : 0;
    let end: number;
    if (event.EventType === "HapticTransient") end = time + TRANSIENT_MS / 1000;
    else if (event.EventType === "HapticContinuous") {
      const duration = typeof event.EventDuration === "number" && Number.isFinite(event.EventDuration) ? Math.max(0, event.EventDuration) : 0;
      end = time + duration;
    } else continue;
    const startMs = Math.round(time * 1000);
    const endMs = Math.min(Math.round(end * 1000), MAX_PATTERN_MS);
    if (startMs >= MAX_PATTERN_MS || endMs <= startMs) continue;
    spans.push([startMs, endMs]);
  }
  if (spans.length === 0) return { plan: null, problem: "Haptic: Pattern has no haptic events to play, so Custom Pattern plays nothing." };
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  const plan: number[] = [];
  if (merged[0]![0] > 0) plan.push(0, merged[0]![0]);
  merged.forEach(([start, end], i) => {
    plan.push(end - start);
    const next = merged[i + 1];
    if (next) plan.push(next[0] - end);
  });
  return { plan };
}

interface HapticState {
  /** Pattern value the cached plan was made from (by identity). */
  pattern: unknown;
  plan: number[] | null;
  problem: string | undefined;
  cached: boolean;
  played: boolean;
}

function supports(native: HapticServices, type: string): boolean {
  try {
    return native.supports(type) === true;
  } catch {
    return false;
  }
}

export const hapticPatch = definePatch<HapticState>("haptic", {
  state: () => ({ pattern: undefined, plan: null, problem: undefined, cached: false, played: false }),
  evaluate(ctx) {
    const s = ctx.state;
    const platform = ctx.services.platform;
    let type = toText(ctx.input("type"));
    if (!Object.hasOwn(VIBRATION_PLANS, type)) {
      warnOnce(ctx, "unknownType", `Haptic: "${type}" isn't a feedback type, so it plays Impact Light.`);
      type = "impactLight";
    }
    const pattern = ctx.input("pattern");
    let plan: readonly number[] | null;
    if (type === "customPattern") {
      if (!s.cached || s.pattern !== pattern) {
        const converted = ahapToVibration(pattern);
        Object.assign(s, { pattern, plan: converted.plan, problem: converted.problem, cached: true });
      }
      if (s.problem) warnOnce(ctx, `pattern:${s.problem}`, s.problem);
      plan = s.plan;
    } else {
      plan = VIBRATION_PLANS[type] ?? null;
    }
    const native = platform.haptic;
    const nativeSupports = native ? supports(native, type) : false;
    ctx.output("available", native ? nativeSupports : plan !== null && typeof platform.vibrate === "function");
    if (!ctx.pulsed("play")) return;
    if (native && nativeSupports) native.play(type, type === "customPattern" ? pattern : undefined);
    else if (plan && typeof platform.vibrate === "function") {
      platform.vibrate([...plan]);
      s.played = true;
    } else ctx.services.log("log", `Haptic: ${type} (no haptics on this device)`);
  },
  dispose(state, services) {
    if (state?.played) services.platform.vibrate?.(0);
  },
});
