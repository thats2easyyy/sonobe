/**
 * Plays orbs on one cable's mounted orb elements (Orb in CableEdge.tsx) with the Web Animations API.
 * Each slot's animations are built once per path and tone and replayed after that, so a pulse that
 * fires every frame doesn't parse keyframes every time it sends an orb. The first time, only the head
 * is built in the frame it leaves; its trails and landing follow a frame or two later, a few
 * milliseconds a frame (they're still transparent then), so a pulse into dozens of idle cables
 * doesn't stall the frame it fires in.
 */

import { cableArc, LANDING_MS, orbGap, orbPlan, ORB_INSET, ORB_SLOTS, ORB_TRAILS, sweepKeyframes, type CableArc, type OrbPlan, type OrbTone } from "./orb.ts";
import { createFrameQueue, type FrameQueue } from "./orbSchedule.ts";

const FLASH_MS = 320;
const FLASH_KEYFRAMES: Keyframe[] = [{ strokeOpacity: 0 }, { strokeOpacity: 1, offset: 0.3 }, { strokeOpacity: 0 }];
const LANDING_EASE = "cubic-bezier(0.2, 0.6, 0.35, 1)";

export interface OrbEnds {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export interface OrbFlight {
  /** Ms from an orb of this tone leaving until it reaches the input's dot. */
  arrival(tone: OrbTone, ends: OrbEnds): number;
  /**
   * Start an orb on a free slot under `root`, landing on the matching one under `landing`, or with
   * `reduced` the whole-cable flash. Returns ms until it's done and the shortest wait before the
   * next one, or null when every mounted slot is busy and fewer than ORB_SLOTS are mounted: mount
   * another and play again.
   */
  play(root: Element, landing: Element | null, tone: OrbTone, ends: OrbEnds, reduced: boolean): { done: number; gap: number } | null;
  /**
   * Carry a boolean's glow along the cable with the orb that just left: light `sweep` (a copy of the
   * cable's glow) behind the head for `on`, or darken it, and call `done` once the head is in. A
   * sweep still going when the next starts hands its front on to it.
   */
  sweep(sweep: Element | null, tone: OrbTone, ends: OrbEnds, on: boolean, done: () => void): void;
  /** Whether a sweep is going. */
  sweeping(): boolean;
  /** Stop the sweep without calling its `done`. */
  stopSweep(): void;
  /** The elements unmounted: drop the animations built for them. */
  reset(): void;
}

interface Slot {
  el: Element;
  land: Element | null;
  far: boolean;
  built: Map<OrbPlan, Animation[]>;
  playing: Animation[];
  /** When its landing has faded. */
  until: number;
}

let frames: FrameQueue | undefined;
const later = (job: () => void) => (frames ??= createFrameQueue((run) => requestAnimationFrame(run), () => performance.now())).add(job);

const animation = (target: Element | null | undefined, keyframes: Keyframe[], timing: KeyframeEffectOptions) => (target ? new Animation(new KeyframeEffect(target, keyframes, timing), document.timeline) : null);

/** The trails and the landing: everything but the head. */
function buildRest(slot: Slot, plan: OrbPlan): Animation[] {
  const list: (Animation | null)[] = [];
  // Zoomed far out the trails and the landing would be a pixel or two, so only the head travels.
  if (!slot.far) {
    const trails = plan.trails();
    for (const name of ORB_TRAILS) list.push(animation(slot.el.querySelector(`.sb-pe-orb__${name}`), trails[name], { duration: plan.duration }));
    const landing = { duration: LANDING_MS, delay: plan.landing, easing: LANDING_EASE };
    list.push(animation(slot.land?.querySelector(".sb-pe-orb__flare"), plan.flare, landing), animation(slot.land?.querySelector(".sb-pe-orb__ring"), plan.ring, landing));
  }
  return list.filter((a) => a !== null);
}

export function createOrbFlight(): OrbFlight {
  let key = "";
  let arc: CableArc | null = null;
  let plans: Partial<Record<OrbTone, OrbPlan>> = {};
  let slots: (Slot | undefined)[] = [];
  let sweep: { animation: Animation; plan: OrbPlan; el: Element } | null = null;

  const planFor = (tone: OrbTone, { sx, sy, tx, ty }: OrbEnds): OrbPlan => {
    const ends = `${sx} ${sy} ${tx} ${ty}`;
    if (key !== ends || !arc) {
      key = ends;
      arc = cableArc(sx, sy, tx, ty, ORB_INSET);
      plans = {};
      for (const slot of slots) slot?.built.clear();
    }
    return (plans[tone] ??= orbPlan(arc, tone));
  };

  const stopSweep = () => {
    sweep?.animation.cancel();
    sweep?.el.removeAttribute("data-sweep");
    sweep = null;
  };

  return {
    arrival: (tone, ends) => planFor(tone, ends).landing,
    play(root, landing, tone, ends, reduced) {
      if (reduced) {
        const flash = root.querySelector(".sb-pe-cable__flash");
        flash?.setAttribute("data-tone", tone);
        flash?.animate(FLASH_KEYFRAMES, FLASH_MS);
        return { done: FLASH_MS, gap: orbGap(FLASH_MS, FLASH_MS) };
      }
      const plan = planFor(tone, ends);
      const done = plan.landing + LANDING_MS;
      const gap = orbGap(plan.duration, done);
      const els = root.querySelectorAll(".sb-pe-orb__slot");
      const lands = landing?.querySelectorAll(".sb-pe-orb__land");
      const now = performance.now();
      // The first free slot; with none free, mount another, or take the one closest to done.
      let index = -1;
      for (let i = 0; i < els.length && index < 0; i++) if ((slots[i]?.until ?? 0) <= now) index = i;
      if (index < 0 && els.length < ORB_SLOTS) return null;
      if (index < 0) index = slots.reduce((best, slot, i) => ((slot?.until ?? 0) < (slots[best]?.until ?? 0) ? i : best), 0);
      const el = els[index]!;
      const land = lands?.[index] ?? null;
      const far = root.closest('[data-lod="far"]') !== null;
      let slot = slots[index];
      for (const running of slot?.playing ?? []) running.cancel();
      if (!slot || slot.el !== el || slot.land !== land || slot.far !== far) slots[index] = slot = { el, land, far, built: new Map(), playing: [], until: 0 };
      slot.until = now + done;
      // The dim head's gradient, per theme (patch-editor.css).
      el.setAttribute("data-tone", tone);
      land?.setAttribute("data-tone", tone);
      let list = slot.built.get(plan);
      if (list) {
        for (const a of list) a.play();
      } else {
        const head = animation(el.querySelector(".sb-pe-orb__head"), plan.head, { duration: plan.duration });
        slot.built.set(plan, (list = head ? [head] : []));
        head?.play();
        const owner = slot;
        const built = list;
        later(() => {
          if (!owner.el.isConnected || owner.built.get(plan) !== built) return;
          const rest = buildRest(owner, plan);
          built.push(...rest);
          // In step with the head, which may be a frame or two along by now.
          if (owner.playing !== built || !head || head.playState === "idle") return;
          for (const a of rest) {
            a.currentTime = head.currentTime;
            a.play();
          }
        });
      }
      slot.playing = list;
      return { done, gap };
    },
    sweep(el, tone, ends, on, done) {
      const plan = planFor(tone, ends);
      const running = sweep?.animation.playState === "running" ? sweep : null;
      const before = running ? { plan: running.plan, elapsed: Number(running.animation.currentTime ?? 0) } : undefined;
      stopSweep();
      if (!el) return done();
      // Held at its end, then let go along with the cable's hold (in `done`), so nothing flickers.
      const animation = el.animate(sweepKeyframes(plan, on, before), { duration: plan.duration, fill: "forwards" });
      el.setAttribute("data-sweep", "");
      sweep = { animation, plan, el };
      animation.onfinish = () => {
        if (sweep?.animation !== animation) return;
        stopSweep();
        done();
      };
    },
    sweeping: () => sweep !== null,
    stopSweep,
    reset() {
      stopSweep();
      slots = [];
    },
  };
}
