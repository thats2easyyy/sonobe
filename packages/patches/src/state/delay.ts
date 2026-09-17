/**
 * Delay: replays input changes Duration seconds later from a time-stamped queue. When Increasing delays
 * rises and passes falls straight through (cancelling waiting rises); When Decreasing does the opposite.
 * Types without an order behave like Always.
 */

import type { Value, ValueType } from "@sonobe/core";
import { definePatch, toNumber, warnOnce } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { pulseOnFirstFrame, readDuration, sameValue, variantOf } from "./shared.ts";

export interface QueuedChange {
  due: number;
  value: Value;
}

export interface DelayState {
  seeded: boolean;
  variant: ValueType | undefined;
  /** The latest input value. */
  prev: Value;
  out: Value;
  /** Pending changes in order; entries before `head` have released. */
  queue: QueuedChange[];
  head: number;
}

/** Most pending changes kept per index; past it the oldest releases at once. */
export const DELAY_QUEUE_LIMIT = 10_000;

const SPEC = getSpec("delay")!;
const STYLES: ReadonlySet<string> = new Set(["always", "whenIncreasing", "whenDecreasing"]);

/** +1 for a rise, −1 for a fall, 0 for types without an order. */
function direction(from: Value, to: Value, variant: ValueType): number {
  if (variant === "number" || variant === "index") {
    const a = toNumber(from);
    const b = toNumber(to);
    return b > a ? 1 : b < a ? -1 : 0;
  }
  if (variant === "boolean") return from === to ? 0 : to === true ? 1 : -1;
  return 0;
}

function pending(s: DelayState): number {
  return s.queue.length - s.head;
}

/** Remove and return the oldest pending change, compacting the array now and then. */
function release(s: DelayState): Value {
  const item = s.queue[s.head]!;
  s.head += 1;
  if (s.head === s.queue.length) {
    s.queue.length = 0;
    s.head = 0;
  } else if (s.head >= 1024 && s.head * 2 >= s.queue.length) {
    s.queue.splice(0, s.head);
    s.head = 0;
  }
  return item.value;
}

function clearQueue(s: DelayState): void {
  s.queue.length = 0;
  s.head = 0;
}

export const delayPatch = definePatch<DelayState>("delay", {
  state: () => ({ seeded: false, variant: undefined, prev: undefined, out: undefined, queue: [], head: 0 }),
  evaluate(ctx) {
    const s = ctx.state;
    const variant = variantOf(ctx, SPEC);
    let v = ctx.input<Value>("value");
    if ((variant === "number" || variant === "index") && !(typeof v === "number" && Number.isFinite(v))) {
      warnOnce(ctx, "value:nonFinite", `Delay "${ctx.id}": value isn't a finite number, so it counts as 0.`);
      v = 0;
    }
    const d = readDuration(ctx, "duration", "Delay");
    const styleInput = ctx.input("style");
    const style = typeof styleInput === "string" && STYLES.has(styleInput) ? styleInput : "always";

    if (!s.seeded || s.variant !== variant) {
      s.seeded = true;
      s.variant = variant;
      clearQueue(s);
      // An upstream pulse on the first frame is an event, not a starting state.
      const start = pulseOnFirstFrame(ctx, "value", variant) ? false : v;
      s.prev = start;
      s.out = start;
    }

    if (!sameValue(v, s.prev, variant, "exact")) {
      const dir = direction(s.prev, v, variant);
      const wait = d > 0 && (style === "always" || dir === 0 || (style === "whenIncreasing" && dir > 0) || (style === "whenDecreasing" && dir < 0));
      if (wait) {
        if (pending(s) >= DELAY_QUEUE_LIMIT) {
          s.out = release(s);
          warnOnce(ctx, "queue:limit", `Delay "${ctx.id}" is holding ${DELAY_QUEUE_LIMIT} changes, so the oldest ones pass through early.`);
        }
        s.queue.push({ due: ctx.time + d, value: v });
      } else {
        clearQueue(s);
        s.out = v;
      }
      s.prev = v;
    }

    while (pending(s) > 0 && ctx.time >= s.queue[s.head]!.due - 1e-6) s.out = release(s);
    if (pending(s) > 0) ctx.requestNextFrame();
    ctx.output("output", s.out);
  },
});
