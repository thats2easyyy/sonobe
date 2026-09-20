/**
 * Plays orbs on one cable's mounted orb elements (Orb in CableEdge.tsx) with the Web Animations API.
 * Each slot's animations are built once per path and tone and replayed after that, so a pulse that
 * fires every frame doesn't parse keyframes every time it sends an orb.
 */

import { createThrottle, cableArc, LANDING_MS, orbGap, orbPlan, ORB_SLOTS, ORB_TRAILS, type CableArc, type OrbPlan, type OrbTone } from "./orb.ts";

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
  /** True when a send now is far enough behind the last one (see orbGap). */
  admit(now: number): boolean;
  /** Start an orb, or with `reduced` the whole-cable flash, on the elements under `root`; returns ms until it's done. */
  play(root: Element, tone: OrbTone, ends: OrbEnds, reduced: boolean): number;
  /** The elements unmounted: drop the animations built for them. */
  reset(): void;
}

interface Slot {
  el: Element;
  far: boolean;
  built: Map<OrbPlan, Animation[]>;
  playing: Animation[];
}

function build(el: Element, plan: OrbPlan, far: boolean): Animation[] {
  const list: Animation[] = [];
  const add = (selector: string, keyframes: Keyframe[], timing: KeyframeEffectOptions) => {
    const target = el.querySelector(selector);
    if (target) list.push(new Animation(new KeyframeEffect(target, keyframes, timing), document.timeline));
  };
  add(".sb-pe-orb__head", plan.head, { duration: plan.duration });
  // Zoomed far out the trails and the landing would be a pixel or two, so only the head travels.
  if (!far) {
    for (const name of ORB_TRAILS) add(`.sb-pe-orb__${name}`, plan.trails[name], { duration: plan.duration });
    const landing = { duration: LANDING_MS, delay: plan.landing, easing: LANDING_EASE };
    add(".sb-pe-orb__bloom", plan.bloom, landing);
    add(".sb-pe-orb__ring", plan.ring, landing);
  }
  return list;
}

export function createOrbFlight(): OrbFlight {
  const throttle = createThrottle();
  let gap = 0;
  let next = 0;
  let key = "";
  let arc: CableArc | null = null;
  let plans: Partial<Record<OrbTone, OrbPlan>> = {};
  let slots: (Slot | undefined)[] = [];

  return {
    admit: (now) => throttle(now, gap),
    play(root, tone, { sx, sy, tx, ty }, reduced) {
      if (reduced) {
        const flash = root.querySelector(".sb-pe-cable__flash");
        flash?.setAttribute("data-tone", tone);
        flash?.animate(FLASH_KEYFRAMES, FLASH_MS);
        gap = orbGap(FLASH_MS);
        return FLASH_MS;
      }
      const ends = `${sx} ${sy} ${tx} ${ty}`;
      if (key !== ends || !arc) {
        key = ends;
        arc = cableArc(sx, sy, tx, ty);
        plans = {};
        for (const slot of slots) slot?.built.clear();
      }
      const plan = (plans[tone] ??= orbPlan(arc, tone));
      gap = orbGap(plan.duration);
      const index = next++ % ORB_SLOTS;
      const el = root.querySelectorAll(".sb-pe-orb__slot")[index];
      if (!el) return 0;
      const far = root.closest('[data-lod="far"]') !== null;
      let slot = slots[index];
      for (const running of slot?.playing ?? []) running.cancel();
      if (!slot || slot.el !== el || slot.far !== far) slots[index] = slot = { el, far, built: new Map(), playing: [] };
      let list = slot.built.get(plan);
      if (!list) slot.built.set(plan, (list = build(el, plan, far)));
      for (const animation of list) animation.play();
      slot.playing = list;
      return plan.landing + LANDING_MS;
    },
    reset() {
      slots = [];
    },
  };
}
