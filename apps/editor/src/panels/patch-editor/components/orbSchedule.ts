/**
 * When a cable's orb may leave (Orb in CableEdge.tsx).
 *
 * A cable keeps a gap between its orbs (orbGap in orb.ts), so a pulse that fires every frame sends
 * a steady stream rather than a flood. A pulse inside the gap is dropped, but a boolean's change is
 * held until the gap opens (a newer change replaces it), so a quick tap still shows its turn-off.
 *
 * And an orb leaving a node that an orb has just set off into follows it RELAY_STAGGER_MS behind,
 * so a chain reads as cause and effect, a ripple running down it, without falling behind the
 * values: the node, the viewer and the port dots change at once, and the orbs are an accent that
 * keeps up with them.
 */

import type { OrbTone } from "./orb.ts";

/** When an offered orb leaves: `at` (ms, on the offer's clock), and whether the caller must set a timer for it. */
export interface OrbLaunch {
  at: number;
  /** False when it leaves now (`at` is the offer's `now`) or joins a send already waiting. */
  timer: boolean;
}

export interface OrbQueue {
  /**
   * A send at `now` that may not leave before `ready`. `hold` keeps a send the gap would drop until
   * the gap opens. Null when it's dropped.
   */
  offer(now: number, tone: OrbTone, options?: { ready?: number; hold?: boolean }): OrbLaunch | null;
  /** The waiting send is due: its tone, now counted as sent. */
  take(now: number): OrbTone | null;
  /** The shortest wait after the orb that just left, before the next may. */
  setGap(gap: number): void;
  /** Whether a send is waiting. */
  waiting(): boolean;
  /** Forget a waiting send. */
  clear(): void;
}

export function createOrbQueue(): OrbQueue {
  let last = -Infinity;
  let gap = 0;
  let held: { tone: OrbTone; at: number } | null = null;
  return {
    offer(now, tone, { ready = now, hold = false } = {}) {
      if (held) {
        held.tone = tone;
        return { at: held.at, timer: false };
      }
      const at = Math.max(ready, last + gap);
      if (at <= now) {
        last = now;
        return { at: now, timer: false };
      }
      // A pulse the gap would drop, with nothing upstream to wait for.
      if (!hold && ready <= now) return null;
      held = { tone, at };
      return { at, timer: true };
    },
    take(now) {
      const tone = held?.tone ?? null;
      held = null;
      if (tone) last = now;
      return tone;
    },
    setGap(next) {
      gap = next;
    },
    waiting: () => held !== null,
    clear() {
      held = null;
    },
  };
}

/** When a launched orb leaves and when it reaches its input (ms). */
export interface OrbLeg {
  leave: number;
  arrive: number;
}

/** An orb about to leave node `from` for node `to`. */
export interface RelaySend {
  from: string;
  to: string;
  /** When the change that sends it happened. */
  event: number;
  /** Leave no earlier than `ready`; returns when it leaves and reaches `to`, or null when no orb goes. */
  launch(ready: number): OrbLeg | null;
}

export interface OrbRelay {
  send(send: RelaySend): void;
}

/**
 * A change this soon after an orb set off into its node counts as caused by it. Live values arrive
 * at 20 Hz (PatchEditor's value subscription), up to 50 ms after the pulse that caused them.
 */
export const CAUSE_MS = 90;
/** How far behind the orb into a node the orbs out of it leave: about a third of the way along. */
export const RELAY_STAGGER_MS = 80;
/** The longest an orb waits on the orbs before it, so a long chain keeps up with its values. */
export const RELAY_MAX_MS = 250;

/**
 * Collects the sends of one moment (up to `defer`, a microtask by default), then launches them
 * upstream first: an orb leaving a node follows the orb into that node, in the same batch or set
 * off within CAUSE_MS before it, RELAY_STAGGER_MS behind (never after it lands), and waits no more
 * than RELAY_MAX_MS unless the orb it follows leaves later still.
 */
export function createOrbRelay(defer: (flush: () => void) => void = queueMicrotask): OrbRelay {
  /** The latest orb into each node, and when the change that sent it happened. */
  const into = new Map<string, OrbLeg & { event: number }>();
  let batch: RelaySend[] = [];

  const flush = () => {
    const sends = batch;
    batch = [];
    const oldest = Math.min(...sends.map((s) => s.event));
    for (const [node, leg] of into) if (leg.event < oldest - CAUSE_MS) into.delete(node);
    const feeding = new Map<string, RelaySend[]>();
    for (const s of sends) feeding.set(s.to, [...(feeding.get(s.to) ?? []), s]);
    const done = new Set<RelaySend>();
    const visiting = new Set<RelaySend>();
    const resolve = (s: RelaySend) => {
      if (done.has(s) || visiting.has(s)) return;
      visiting.add(s);
      for (const upstream of feeding.get(s.from) ?? []) resolve(upstream);
      const cause = into.get(s.from);
      const caused = cause && Math.abs(s.event - cause.event) <= CAUSE_MS ? cause : null;
      // Past the cap it goes, but never ahead of the orb it follows (one held back while its cable draws in).
      const ready = caused ? Math.max(s.event, Math.min(caused.leave + RELAY_STAGGER_MS, caused.arrive, Math.max(s.event + RELAY_MAX_MS, caused.leave))) : s.event;
      const leg = s.launch(ready);
      done.add(s);
      if (!leg) return;
      const known = into.get(s.to);
      if (!known || Math.abs(known.event - s.event) > CAUSE_MS || leg.leave > known.leave) into.set(s.to, { event: s.event, ...leg });
    };
    for (const s of sends) resolve(s);
  };

  return {
    send(s) {
      if (batch.length === 0) defer(flush);
      batch.push(s);
    },
  };
}

/**
 * Whether an orb is too late to send: its cable drew in (or finishes drawing at `shown`) more than
 * RELAY_MAX_MS after the change at `event`, so its node, the viewer and the port dots moved on long
 * ago. A pulse's orb is dropped then, and a boolean's cable takes its new glow at once.
 */
export function staleOrb(event: number, shown: number): boolean {
  return shown - event > RELAY_MAX_MS;
}

/**
 * How many orbs fly at once zoomed far out, where a head is a pixel or two across. Past it a send is
 * skipped (a boolean's glow changes at once there anyway), so hundreds of cables firing together
 * don't spend the frame drawing dots nobody can tell apart.
 */
export const FAR_ORB_CAP = 48;

export interface OrbBudget {
  /** Whether an orb may fly at `now`: always closer in; zoomed far out (`far`) while fewer than FAR_ORB_CAP do, counting it until `until`. */
  take(now: number, until: number, far: boolean): boolean;
}

export function createOrbBudget(cap = FAR_ORB_CAP): OrbBudget {
  let flying: number[] = [];
  return {
    take(now, until, far) {
      if (!far) return true;
      flying = flying.filter((t) => t > now);
      if (flying.length >= cap) return false;
      flying.push(until);
      return true;
    },
  };
}

/**
 * Work that can wait a frame or two, done `budget` ms a frame (and at least one job each frame), so
 * a pulse into dozens of idle cables doesn't build all of their trails in the frame it fires.
 */
export interface FrameQueue {
  add(job: () => void): void;
}

export const FRAME_BUDGET_MS = 4;

export function createFrameQueue(requestFrame: (run: () => void) => void, now: () => number, budget = FRAME_BUDGET_MS): FrameQueue {
  const jobs: (() => void)[] = [];
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestFrame(run);
  };
  const run = () => {
    scheduled = false;
    const start = now();
    do jobs.shift()!();
    while (jobs.length > 0 && now() - start < budget);
    if (jobs.length > 0) schedule();
  };
  return {
    add(job) {
      jobs.push(job);
      schedule();
    },
  };
}

const relays = new WeakMap<object, OrbRelay>();
const budgets = new WeakMap<object, OrbBudget>();

/** The relay of one patch editor, keyed by its live store, which all of its cables' orbs share. */
export function orbRelayFor(owner: object): OrbRelay {
  let relay = relays.get(owner);
  if (!relay) relays.set(owner, (relay = createOrbRelay()));
  return relay;
}

/** The far-zoom orb budget of one patch editor, keyed like orbRelayFor. */
export function orbBudgetFor(owner: object): OrbBudget {
  let budget = budgets.get(owner);
  if (!budget) budgets.set(owner, (budget = createOrbBudget()));
  return budget;
}
