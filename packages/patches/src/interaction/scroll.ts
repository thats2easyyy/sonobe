/** Scroll: drags, flicks, and the mouse wheel on a content layer become a scroll position. */

import { DECELERATION_FAST, DECELERATION_NORMAL, MomentumScroller } from "@sonobe/engine";
import type { LayerInfoSnapshot, MomentumScrollerOptions, PatchContext } from "@sonobe/engine";
import { clamp, definePatch, finiteOr, normalizeZero, warnOnce } from "../infra/index.ts";
import { TOUCH_SLOP, ancestorScale, finiteInput, finitePoint, finitePointInput, layerInput, parentRef, type Vec2 } from "./shared.ts";

type ScrollMode = "off" | "free" | "paging";
type TouchPhase = "none" | "pending" | "accepted" | "ignored";

/** A Paging axis snaps to its nearest page once the wheel has been still this long, in seconds. */
const WHEEL_SETTLE = 0.15;

/** Bounds and paging for one axis, from the previous frame's layout. */
export interface ScrollAxisGeometry {
  /** Effective mode: Paging falls back to Free when a page has no size. */
  mode: ScrollMode;
  /** Lowest and highest offset. */
  lo: number;
  hi: number;
  viewport: number;
  /** Distance between page offsets (Paging only). */
  step: number;
  count: number;
  /** Page Size or the viewport, for counting screens on Free and Off axes. */
  unit: number;
}

interface ScrollAxis {
  scroller: MomentumScroller;
  wheelPending: boolean;
  lastWheelTime: number;
}

interface ScrollState {
  axes: ScrollAxis[] | null;
  touch: TouchPhase;
  slopOrigin: Vec2;
  lock: number | null;
}

interface GeometryInputs {
  mode: ScrollMode;
  start: Vec2;
  contentSize: Vec2;
  pageSize: Vec2;
  pagePadding: Vec2;
  info: LayerInfoSnapshot | undefined;
  viewport: Vec2;
}

/** Offset bounds per ScrollAxisGeometry rules; `onZeroStep` runs when Paging can't page. */
export function scrollAxisGeometry(a: 0 | 1, g: GeometryInputs, onZeroStep?: () => void): ScrollAxisGeometry {
  const viewport = Math.max(0, g.viewport[a]);
  const size = Math.max(0, finiteOr(g.info?.size[a], 0));
  const anchor = finiteOr(g.info?.anchor[a], 0);
  const content = g.contentSize[a] > 0 ? g.contentSize[a] : size;
  const topLeft = g.start[a] - anchor * size;
  const unit = g.pageSize[a] > 0 ? g.pageSize[a] : viewport;
  if (g.mode === "off") return { mode: "off", lo: 0, hi: 0, viewport, step: 0, count: 1, unit };
  if (g.mode === "paging") {
    const page = unit;
    const padding = g.pagePadding[a];
    const step = page + padding;
    if (step > 0) {
      const inset = (viewport - page) / 2;
      const count = Math.max(1, Math.round((content + padding) / step));
      const hi = inset - topLeft;
      return { mode: "paging", lo: hi - (count - 1) * step, hi, viewport, step, count, unit };
    }
    onZeroStep?.();
  }
  return { mode: "free", lo: Math.min(0, viewport - (topLeft + content)), hi: 0, viewport, step: 0, count: 1, unit };
}

/** The page an offset shows: counted within the pages on a Paging axis, in whole screens otherwise. */
export function scrollPageIndex(g: ScrollAxisGeometry, offset: number): number {
  if (g.mode === "paging") return normalizeZero(clamp(Math.round((g.hi - offset) / g.step), 0, g.count - 1));
  return g.unit > 0 ? normalizeZero(Math.max(0, Math.round(-offset / g.unit))) : 0;
}

function readMode(value: unknown): ScrollMode {
  return value === "free" || value === "paging" ? value : "off";
}

function nonNegative(v: Vec2): Vec2 {
  return [Math.max(0, v[0]), Math.max(0, v[1])];
}

function scrollerOptions(g: ScrollAxisGeometry, fast: boolean, rubberBand: boolean): Partial<MomentumScrollerOptions> {
  // Offsets fall as pages advance, so page n is `hi − n·step`: MomentumScroller's page index is −n.
  return {
    min: g.lo,
    max: g.hi,
    deceleration: fast ? DECELERATION_FAST : DECELERATION_NORMAL,
    momentum: true,
    stickToBoundaries: !rubberBand,
    viewportSize: g.viewport,
    pageSize: g.mode === "paging" ? g.step : 0,
    pageOffset: g.hi,
    maxPagesPerFling: 1,
  };
}

function emitMuted(ctx: PatchContext<ScrollState>, start: Vec2): void {
  ctx.output("position", start);
  ctx.output("x", start[0]);
  ctx.output("y", start[1]);
  ctx.output("pageX", 0);
  ctx.output("pageY", 0);
  ctx.output("dragging", false);
  ctx.output("moving", false);
}

export const scroll = definePatch<ScrollState>("scroll", {
  state: () => ({ axes: null, touch: "none", slopOrigin: [0, 0], lock: null }),
  evaluate(ctx) {
    const state = ctx.state;
    const start = finitePointInput(ctx, "startPosition");
    if (ctx.muted) {
      emitMuted(ctx, start);
      return;
    }
    const services = ctx.services;
    const ref = layerInput(ctx);
    const info = ref ? services.layerInfo(ref) : undefined;
    const parent = parentRef(services, ref);
    const parentInfo = parent ? services.layerInfo(parent) : undefined;
    const screen = services.device().screenSize;
    const viewport: Vec2 = parentInfo ? [finiteOr(parentInfo.size[0], 0), finiteOr(parentInfo.size[1], 0)] : [finiteOr(screen[0], 0), finiteOr(screen[1], 0)];
    const base = {
      start,
      contentSize: nonNegative(finitePointInput(ctx, "contentSize")),
      pageSize: nonNegative(finitePointInput(ctx, "pageSize")),
      pagePadding: nonNegative(finitePointInput(ctx, "pagePadding")),
      info,
      viewport,
    };
    const geometry = ([0, 1] as const).map((a) =>
      scrollAxisGeometry(a, { ...base, mode: readMode(ctx.input(a === 0 ? "scrollX" : "scrollY")) }, () =>
        warnOnce(ctx, `pageStep:${a}`, `Scroll can't page ${a === 0 ? "horizontally" : "vertically"}: the page has no size, so that direction scrolls freely.`),
      ),
    );
    const fast = ctx.input<string>("decelerationRate") === "fast";
    const rubberBand = ctx.input<boolean>("rubberBand") === true;
    if (!state.axes) {
      state.axes = geometry.map((g) => ({ scroller: new MomentumScroller(scrollerOptions(g, fast, rubberBand), 0), wheelPending: false, lastWheelTime: 0 }));
    } else {
      for (let a = 0; a < 2; a++) state.axes[a]!.scroller.setOptions(scrollerOptions(geometry[a]!, fast, rubberBand));
    }
    const axes = state.axes;
    const scroller = (a: number) => axes[a]!.scroller;
    const isOn = (a: number) => geometry[a]!.mode !== "off";
    const activeAxes = () => [0, 1].filter((a) => isOn(a) && (state.lock === null || state.lock === a));
    const stopTracking = (except?: number) => {
      for (let a = 0; a < 2; a++) if (a !== except && scroller(a).phase === "tracking") scroller(a).stop();
    };
    const p = services.pointer(ref);
    const enabled = ctx.input<boolean>("enabled") === true;
    const scale = ancestorScale(services, ref);

    // 1. Jumps work even while disabled, and cancel an active touch.
    const jump = (a: 0 | 1, pulseKey: string, positionKey: string, styleKey: string) => {
      if (!ctx.pulsed(pulseKey)) return;
      if (state.touch === "pending" || state.touch === "accepted") {
        state.touch = "ignored";
        state.lock = null;
      }
      stopTracking(a);
      scroller(a).jumpTo(finiteInput(ctx, positionKey) - start[a], ctx.input<string>(styleKey) !== "instant");
      axes[a]!.wheelPending = false;
    };
    jump(0, "jumpToX", "jumpPositionX", "jumpStyleX");
    jump(1, "jumpToY", "jumpPositionY", "jumpStyleY");

    // 2. Touch.
    if (!enabled) {
      if (state.touch === "accepted") for (const a of activeAxes()) if (scroller(a).phase === "tracking") scroller(a).release(0);
      stopTracking();
      if (state.touch !== "none") state.touch = p.down ? "ignored" : "none";
      state.lock = null;
      for (let a = 0; a < 2; a++) if (scroller(a).phase === "decelerating") scroller(a).stop();
    } else {
      if (p.began) {
        state.touch = "pending";
        state.slopOrigin = [p.position[0], p.position[1]];
        state.lock = null;
        // Catch any motion and hold the content where it is while the touch decides.
        for (let a = 0; a < 2; a++) {
          if (!isOn(a)) continue;
          scroller(a).beginDrag();
          axes[a]!.wheelPending = false;
        }
      }
      if (state.touch === "pending") {
        const dx = p.position[0] - p.startPosition[0];
        const dy = p.position[1] - p.startPosition[1];
        if (Math.hypot(dx, dy) > TOUCH_SLOP) {
          const dominant = Math.abs(dx) > Math.abs(dy) ? 0 : 1;
          const locking = ctx.input<boolean>("directionLocking") === true;
          if (!isOn(0) && !isOn(1)) state.touch = "ignored";
          else if (locking && isOn(0) && isOn(1)) {
            state.lock = dominant;
            state.touch = "accepted";
          } else if (locking && !isOn(dominant)) state.touch = "ignored";
          else state.touch = "accepted";
          if (state.touch === "accepted") {
            state.slopOrigin = [p.position[0], p.position[1]]; // no 10 pt jump
            const active = activeAxes();
            for (let a = 0; a < 2; a++) if (!active.includes(a) && scroller(a).phase === "tracking") scroller(a).stop();
          } else {
            stopTracking();
          }
        }
      }
      if (state.touch === "accepted" && p.down) {
        for (const a of activeAxes()) scroller(a).dragTo(finiteOr(p.position[a]! - state.slopOrigin[a]!, 0) / scale[a]!);
      }
      if (p.ended || (!p.down && state.touch !== "none")) {
        if (state.touch === "accepted") {
          for (const a of activeAxes()) scroller(a).release(p.ended ? finiteOr(p.velocity[a], 0) / scale[a]! : 0);
        }
        stopTracking(); // a tap or an ignored touch leaves the content resting
        state.touch = "none";
        state.lock = null;
      }
    }

    // 3. Wheel, while the pointer is over the visible window.
    if (enabled && state.touch !== "accepted" && services.pointer(parent).hovering) {
      const delta = finitePoint(services.wheel().delta) ?? [0, 0];
      for (let a = 0; a < 2; a++) {
        if (!isOn(a) || delta[a] === 0) continue;
        const g = geometry[a]!;
        scroller(a).value = clamp(scroller(a).value - delta[a]!, g.lo, g.hi);
        scroller(a).stop();
        axes[a]!.wheelPending = g.mode === "paging";
        axes[a]!.lastWheelTime = ctx.time;
      }
    }
    for (let a = 0; a < 2; a++) {
      const axis = axes[a]!;
      const g = geometry[a]!;
      if (!axis.wheelPending) continue;
      if (g.mode !== "paging") axis.wheelPending = false;
      else if (ctx.time - axis.lastWheelTime >= WHEEL_SETTLE - 1e-9) {
        axis.wheelPending = false;
        axis.scroller.jumpTo(g.hi - scrollPageIndex(g, axis.scroller.value) * g.step, true);
      }
    }

    // 4. Physics.
    let animating = false;
    let waiting = false;
    for (const axis of axes) {
      axis.scroller.step(ctx.dt);
      if (axis.scroller.isAnimating) animating = true;
      if (axis.wheelPending || axis.scroller.phase === "tracking") waiting = true;
    }
    if (animating || waiting) ctx.requestNextFrame();

    const x = start[0] + scroller(0).value;
    const y = start[1] + scroller(1).value;
    const dragging = state.touch === "accepted";
    ctx.output("position", [x, y]);
    ctx.output("x", x);
    ctx.output("y", y);
    ctx.output("pageX", scrollPageIndex(geometry[0]!, scroller(0).value));
    ctx.output("pageY", scrollPageIndex(geometry[1]!, scroller(1).value));
    ctx.output("dragging", dragging);
    ctx.output("moving", dragging || animating);
  },
  mutedBehavior: "evaluate",
});
