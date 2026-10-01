/**
 * Sends one cable's orbs (Orb in CableEdge.tsx): each leaves once its cable is there, the orb flying
 * into its node is a moment ahead and the cable's gap is open (orbSchedule.ts). Nothing here touches
 * the DOM: the cable plays the orb (`launch`) and shows its glow (`release`).
 *
 * A cable still arriving is waited for in two ways. One that fades in, or isn't mounted yet, is there
 * at a clock time (`readyAt` in appear.ts). A wire drawing on screen is there when its own animation
 * is over, which on a busy machine is later than any clock time read earlier: so `readyAt` is read
 * again wherever an orb would leave, and the waiting send follows the animation, not a timer.
 */

import type { OrbTone } from "./orb.ts";
import { createOrbQueue, staleOrb, type OrbBudget, type OrbLeg, type OrbRelay } from "./orbSchedule.ts";

export interface OrbCable {
  /** The cable's edge id, whose arrival on the canvas its orbs wait for. */
  id: string;
  /** The node at its output, and at its input. */
  from: string;
  to: string;
  pulse: boolean;
  reduced: boolean;
}

/** What a sender reads of the appear store (AppearStore fits). */
export interface OrbArrival {
  readyAt(kind: "cable", id: string): number;
  drawing(id: string): { readonly finished: Promise<unknown> } | undefined;
}

export interface OrbSenderOptions {
  /** The cable as it is now. */
  cable(): OrbCable;
  appear: OrbArrival;
  relay: OrbRelay;
  budget: OrbBudget;
  /** Whether the canvas is zoomed far out. */
  far(): boolean;
  /** Ms from an orb of this tone leaving until it reaches the input's dot. */
  arrival(tone: OrbTone): number;
  /** An orb leaves later: mount its elements now, so they're ready when it does. */
  prepare(): void;
  /** The orb leaves now. */
  launch(tone: OrbTone): void;
  /** No orb carries the change after all: the cable shows its value. */
  release(): void;
  /** Milliseconds clock. Default performance.now. */
  now?: () => number;
}

export interface OrbSender {
  /**
   * Send an orb once the cable is there, following the one into its node (or, with reduced motion,
   * flash). False when nobody would see it: the graph waits to show, or the cable draws in too long
   * after the change.
   */
  send(tone: OrbTone): boolean;
  /** Whether a send is waiting to leave. */
  waiting(): boolean;
  /** The shortest wait after the orb that just left, before the next may. */
  setGap(gap: number): void;
  start(): void;
  /** The cable unmounted: forget the waiting send, and launch nothing the relay still holds. */
  stop(): void;
}

export function createOrbSender(options: OrbSenderOptions): OrbSender {
  const { appear, relay, budget } = options;
  const now = options.now ?? (() => performance.now());
  const queue = createOrbQueue();
  /** When the change behind the send waiting in the queue happened. */
  let waitingSince = 0;
  let wait: ReturnType<typeof setTimeout> | undefined;
  /** The wire's draw animation the waiting send leaves after. */
  let following: object | null = null;
  let stopped = false;

  /** When the cable is all there, so no orb flies along wire still drawing in; Infinity while the graph waits to show. */
  const shownAt = () => appear.readyAt("cable", options.cable().id);

  /** Nobody would see the orb: the send waiting goes, and the cable shows its value. */
  const drop = () => {
    clearTimeout(wait);
    queue.clear();
    options.release();
  };

  /**
   * The waiting send is due. The graph may have started arriving again since it was offered (another
   * document), so it waits on for the cable to draw in, or is dropped while the graph waits to show.
   * A wire still drawing on screen is waited for by its own animation, not by the clock: frames run
   * late on a busy machine, and the orb leaves in the frame that shows the wire whole. `settled` is
   * the animation that just said it was over: were it still drawing by the store's reading, it's
   * asked again by the clock, since its promise would answer at once, for ever.
   */
  const due = (settled?: object) => {
    if (!queue.waiting()) return;
    // The cable first: one that's there answers with the clock, and read after `t` that could be a tick ahead of it.
    const shown = shownAt();
    const t = now();
    if (shown === Infinity || staleOrb(waitingSince, shown)) return drop();
    if (shown > t) {
      const drawing = appear.drawing(options.cable().id);
      if (!drawing || drawing === settled) wait = setTimeout(due, shown - t);
      else if (following !== drawing) {
        following = drawing;
        // Cut short (another document, the cable panned away) is over too.
        const over = () => {
          if (following !== drawing) return;
          following = null;
          due(drawing);
        };
        drawing.finished.then(over, over);
      }
      return;
    }
    const next = queue.take(t);
    if (next) options.launch(next);
  };

  /** Launch now or once `ready`, the cable and its gap allow; returns when it leaves and reaches the input. */
  const schedule = (tone: OrbTone, ready: number, event: number): OrbLeg | null => {
    if (stopped) return null;
    const cable = options.cable();
    // Read here, where the orb would leave: a relay launches after every send of its moment, and a
    // wire that was a few ms from drawn when this was sent is no nearer for the time that took.
    // And before the time, as in `due`, so an orb on a cable that's there never waits out a clock tick.
    const shown = shownAt();
    const t = now();
    if (shown === Infinity || staleOrb(event, shown)) {
      drop();
      return null;
    }
    const go = queue.offer(t, tone, { ready: Math.max(ready, shown), hold: !cable.pulse });
    if (!go) return null;
    // A send that waits, or joins the one waiting (even past its time, its wire a frame from drawn), leaves from `due`.
    const waits = queue.waiting();
    // A new flight (not a change joining the one waiting) needs room zoomed far out.
    const flies = go.timer || !waits;
    if (flies && !cable.reduced && !budget.take(t, go.at + options.arrival(tone), options.far())) {
      if (go.timer) queue.clear();
      options.release();
      return null;
    }
    if (waits) waitingSince = event;
    if (go.timer) {
      options.prepare();
      wait = setTimeout(due, go.at - t);
    } else if (!waits) options.launch(tone);
    return cable.reduced ? null : { leave: go.at, arrive: go.at + options.arrival(tone) };
  };

  return {
    send(tone) {
      const cable = options.cable();
      const t = now();
      const shown = shownAt();
      if (stopped || shown === Infinity || staleOrb(t, shown)) return false;
      if (cable.reduced) schedule(tone, t, t);
      else relay.send({ from: cable.from, to: cable.to, event: t, launch: (ready) => schedule(tone, ready, t) });
      return true;
    },
    waiting: queue.waiting,
    setGap: queue.setGap,
    start() {
      stopped = false;
    },
    stop() {
      stopped = true;
      following = null;
      clearTimeout(wait);
      queue.clear();
    },
  };
}
