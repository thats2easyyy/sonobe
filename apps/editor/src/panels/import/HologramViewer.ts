/**
 * The Viewer's part in the import hologram. While the canvas builds an imported screen, the Viewer
 * would show the finished design and spoil the reveal, so its device screen plays the same build: the
 * veil with pixel rain, the laser sweeping down while the wireframe traces in div by div, and the
 * design materializing under its sweep back up, all from the show's plan and timeline (hologram.ts).
 * A screen smaller than the device gets the frame and the closing bloom too; one that fills it is
 * framed by the device. When no canvas draws the screen's component (the patches-only view, another
 * component) the Viewer plans it from the running prototype and plays it alone. One 2D canvas inside
 * the device screen, under its cutout, so it follows the viewer's scale and device frame; it never
 * takes a pointer, and the same click, key or undo ends it early.
 */

import { findLayer, type Id } from "@sonobe/core";
import type { EditorSession } from "../../state/session.ts";
import type { Rect } from "../canvas/geometry.ts";
import { buildCanvasIndex } from "../canvas/sceneIndex.ts";
import { componentInPrototype, layerSceneRect } from "../viewer/viewerModel.ts";
import { HOLOGRAM_STALE_MS, hologramStore, viewerHoloMode, watchHolograms, type HologramRequest, type HologramTarget } from "./hologram.ts";
import { depthColors, drawBuildFrame, mixColor, prefersReducedMotion, readHoloColors, rgba, type HoloColors, type RGB } from "./hologramDraw.ts";
import { chromeHeldUntil, collectHoloLayers, HOLO, holoFrameAt, planHologram, radiiOf, type HoloPlan } from "./hologramPlan.ts";
import "./hologram.css";

/** A show whose screen the prototype never draws within this long isn't the Viewer's to play. */
const FIND_MS = 600;

interface Playing extends HologramTarget {
  nonce: number;
  start: number;
  plan: HoloPlan;
  endedAt: number | null;
  /** Covering for a request no show plays yet (a canvas will take it, or the prototype hasn't drawn the screen), on a timeline from when it was asked for. */
  waiting: boolean;
  /** The Viewer plays it alone, so it stops the show when it's done. */
  leads: boolean;
  /** The show went away before it was done (undone, the canvas closed): fading out on its own. */
  orphan: boolean;
  /** The prototype has drawn the screen. */
  seen: boolean;
}

/**
 * A plan of the Viewer's own, from the running prototype: the screen's wireframe where the prototype
 * draws it (`drawn`), or only its veil, on a timeline for its height, until it does.
 */
export function prototypePlan(session: EditorSession, target: HologramTarget, reduced: boolean): { plan: HoloPlan; drawn: boolean } {
  const doc = session.document.getState().doc;
  const scene = session.runtime.scene();
  const root = doc.project.root;
  const collected = target.componentId === root ? collectHoloLayers(buildCanvasIndex(doc.components[root], scene), target.screenId) : null;
  if (collected) return { plan: planHologram(collected.screen, collected.layers, { reduced, radii: collected.radii }), drawn: true };
  // Inside a component instance, or not drawn yet: the veil over the screen, from the document.
  const layer = findLayer(doc.components[target.componentId]?.layers ?? [], target.screenId)?.layer;
  const drawn = layerSceneRect(scene, target.screenId);
  const size = layer?.props.size;
  const width = drawn?.width ?? (Array.isArray(size) && typeof size[0] === "number" ? size[0] : 0);
  const height = drawn?.height ?? (Array.isArray(size) && typeof size[1] === "number" ? size[1] : HOLO.referenceHeight);
  const screen = { x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) };
  return { plan: planHologram(screen, [], { reduced, radii: radiiOf(layer?.props ?? {}) }), drawn: drawn !== null };
}

/** Plan rects (in the points of the surface that planned them) where the prototype draws the screen now: `at`, in CSS px. */
export function followScreen(plan: Pick<HoloPlan, "screen">, at: Rect): (r: Rect) => Rect {
  const kx = plan.screen.width > 0 ? at.width / plan.screen.width : 1;
  const ky = plan.screen.height > 0 ? at.height / plan.screen.height : 1;
  return (r) => ({ x: at.x + (r.x - plan.screen.x) * kx, y: at.y + (r.y - plan.screen.y) * ky, width: r.width * kx, height: r.height * ky });
}

export interface ViewerHologramOptions {
  /** The screen the hologram covers now, or null: the viewer's selection outline of it waits, as the canvas's does. */
  onCover?(screenId: Id | null): void;
}

/**
 * Play the hologram on a viewer's device screen. `content` is the element the prototype renders
 * into (DeviceFrame.screen); the veil goes right after it, under the screen's cutout. Returns the
 * detach.
 */
export function attachViewerHologram(session: EditorSession, content: HTMLElement, options: ViewerHologramOptions = {}): () => void {
  const store = hologramStore(session);
  const release = watchHolograms(session);
  const doc = () => session.document.getState().doc;
  const shownHere = (componentId: Id) => componentInPrototype(doc(), componentId);
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let colors: HoloColors | null = null;
  let depths: readonly RGB[] = [];
  let playing: Playing | null = null;
  /** The last show this Viewer finished, so a show that lingers a frame isn't played again. */
  let finishedNonce: number | null = null;
  let raf = 0;
  let phase = "";
  let covered: Id | null = null;
  const cover = (screenId: Id | null) => {
    if (screenId === covered) return;
    covered = screenId;
    options.onCover?.(screenId);
  };

  const mount = () => {
    if (canvas || !content.parentElement) return;
    canvas = content.ownerDocument.createElement("canvas");
    canvas.className = "sb-vw-holo";
    canvas.setAttribute("aria-hidden", "true");
    content.after(canvas);
    ctx = canvas.getContext("2d");
    colors = readHoloColors(canvas);
    depths = depthColors(colors);
  };
  const unmount = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    cover(null);
    canvas?.remove();
    canvas = null;
    ctx = null;
    colors = null;
    phase = "";
  };
  const finish = () => {
    const done = playing;
    playing = null;
    unmount();
    if (!done) return;
    finishedNonce = done.nonce;
    if (done.leads) store.getState().stop(done.nonce);
  };

  const ownPlan = (target: HologramTarget) => prototypePlan(session, target, prefersReducedMotion());
  const lead = (request: HologramRequest, plan: HoloPlan) => {
    store.getState().play({ nonce: request.nonce, componentId: request.componentId, screenId: request.screenId, start: request.at, plan, lead: "viewer" });
  };
  const coverFor = (request: HologramRequest, plan: HoloPlan): Playing => ({ nonce: request.nonce, componentId: request.componentId, screenId: request.screenId, start: request.at, plan, endedAt: null, waiting: true, leads: false, orphan: false, seen: false });

  const sync = () => {
    const now = performance.now();
    const state = store.getState();
    const mode = viewerHoloMode(state, shownHere, now, playing?.waiting ? playing.nonce : null);
    if (mode.kind === "follow") {
      const show = mode.show;
      if (show.nonce === finishedNonce) return;
      const same = playing?.nonce === show.nonce && !playing.orphan;
      playing = { nonce: show.nonce, componentId: show.componentId, screenId: show.screenId, start: show.start, plan: show.plan, endedAt: show.endedAt, waiting: false, leads: show.lead === "viewer", orphan: false, seen: same ? playing!.seen : false };
    } else if (mode.kind === "lead") {
      // Alone: once the prototype draws the screen, plan its wireframe and play (play() publishes the
      // show, and this runs again to follow it). Until then, cover it.
      const own = ownPlan(mode.request);
      if (own.drawn) return lead(mode.request, own.plan);
      if (playing?.nonce !== mode.request.nonce) playing = coverFor(mode.request, own.plan);
    } else if (mode.kind === "wait") {
      if (playing?.nonce !== mode.request.nonce) playing = coverFor(mode.request, ownPlan(mode.request).plan);
    } else if (playing?.waiting && !state.request && !state.show) {
      // The canvas let the request go without playing it: carry on alone, on the timeline already showing.
      const request = { nonce: playing.nonce, componentId: playing.componentId, screenId: playing.screenId, at: playing.start };
      return lead(request, ownPlan(request).plan);
    } else if (playing && !playing.orphan) {
      // The show ended before this Viewer's frame did (undone, another document, the canvas closed): fade out.
      playing = { ...playing, orphan: true, waiting: false, leads: false, endedAt: playing.endedAt ?? now };
    }
    if (!playing) return;
    mount();
    draw(now);
    if (playing && !raf) raf = requestAnimationFrame(loop);
  };

  const draw = (now: number) => {
    const p = playing;
    if (!p || !canvas || !ctx || !colors) return;
    const t = now - p.start;
    const rect = layerSceneRect(session.runtime.scene(), p.screenId);
    if (rect) p.seen = true;
    // Never drawn, or gone before a show took it: nothing to cover.
    else if (t > FIND_MS && (!p.seen || p.waiting)) return finish();
    // A request the canvas hasn't taken in time, over a screen the prototype draws: sync plays it alone.
    if (p.waiting && t > HOLOGRAM_STALE_MS) return sync();
    const frame = holoFrameAt(p.plan, t);
    const fade = p.endedAt === null ? 1 : 1 - (now - p.endedAt) / HOLO.endFadeMs;
    if (frame.phase === "done" || fade <= 0) return finish();
    // The outline waits as long as the canvas's selection does: past the bloom's peak.
    cover(rect && p.endedAt === null && t < chromeHeldUntil(p.plan) ? p.screenId : null);
    const screen = content.parentElement;
    const screenWidth = screen?.clientWidth ?? 0;
    const screenHeight = screen?.clientHeight ?? 0;
    // The device frame is scaled with a transform: draw in screen pixels, where the rain and the laser
    // match the canvas's.
    const scale = screen && screenWidth > 0 ? screen.getBoundingClientRect().width / screenWidth : 1;
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    // The screen's edges fall inside device pixels, where the prototype's layers still paint that whole
    // pixel: the canvas reaches a device pixel or two past them (the screen's rounded clip trims it).
    const bleed = Math.ceil(1.5 / (scale * dpr));
    const bleedStyle = `${-bleed}px`;
    if (canvas.style.left !== bleedStyle) {
      canvas.style.left = canvas.style.top = bleedStyle;
      canvas.style.width = canvas.style.height = `calc(100% + ${bleed * 2}px)`;
    }
    const width = (screenWidth + bleed * 2) * scale;
    const height = (screenHeight + bleed * 2) * scale;
    const bw = Math.max(1, Math.round(width * dpr));
    const bh = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    if (frame.phase !== phase) {
      phase = frame.phase;
      canvas.dataset.phase = phase;
    }
    canvas.style.opacity = String(Math.max(0, frame.alpha * fade));
    if (!rect || width <= 0 || height <= 0) return;
    ctx.setTransform(bw / width, 0, 0, bh / height, (bw / width) * bleed * scale, (bh / height) * bleed * scale);
    // A screen edge on the device's edge reaches into the bleed; the rest of the screen stays on the device.
    const clampX = (x: number) => Math.min(screenWidth + bleed, Math.max(-bleed, x));
    const clampY = (y: number) => Math.min(screenHeight + bleed, Math.max(-bleed, y));
    const left = rect.x <= 0.5 ? -bleed : clampX(rect.x);
    const top = rect.y <= 0.5 ? -bleed : clampY(rect.y);
    const right = rect.x + rect.width >= screenWidth - 0.5 ? screenWidth + bleed : clampX(rect.x + rect.width);
    const bottom = rect.y + rect.height >= screenHeight - 0.5 ? screenHeight + bleed : clampY(rect.y + rect.height);
    // A screen the prototype draws beside the device, not on it: nothing here to cover.
    if (right - left <= 0 || bottom - top <= 0) {
      if (canvas.style.background) canvas.style.background = "";
      return;
    }
    const veil = { x: left * scale, y: top * scale, width: (right - left) * scale, height: (bottom - top) * scale };
    const fills = left < 0 && top < 0 && right > screenWidth && bottom > screenHeight;
    const square = p.plan.radii.every((r) => r <= 0);
    // Even so, the canvas's bitmap stops at the clip's edge pixel, where the layers' boxes don't: the
    // canvas's CSS background, painted as a box like them, carries the veil into that pixel.
    let background = "";
    if (frame.veil > 0 && square && left < 0 && right > screenWidth) {
      const from = top + bleed;
      const to = top + (bottom - top) * frame.veil + bleed;
      background = `linear-gradient(to bottom, transparent ${from}px, ${rgba(colors.veilTop, 1)} ${from}px, ${rgba(mixColor(colors.veilTop, colors.veilBottom, frame.veil), 1)} ${to}px, transparent ${to}px)`;
    }
    if (canvas.style.background !== background) canvas.style.background = background;
    const toScreen = followScreen(p.plan, { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale });
    // A screen that fills the device is framed by it: no outline or bloom on its edge.
    drawBuildFrame(ctx, { plan: p.plan, frame, t, screen: veil, toScreen, colors, depths, seed: p.nonce * 7919 + 1, edge: !fills });
  };

  // Every draw reads one clock: an animation frame's timestamp can fall behind performance.now(),
  // which the runtime's frames draw with, and the phase would flicker back at its edges.
  const loop = () => {
    raf = 0;
    guard(() => draw(performance.now()))();
    if (playing) raf = requestAnimationFrame(loop);
  };

  // The hologram only decorates: a drawing error ends it here, never in the change or frame that ran it
  // (a store update inside Claude's import, the runtime's frame loop).
  let failed = false;
  const guard = (fn: () => void) => () => {
    if (failed) return;
    try {
      fn();
    } catch {
      failed = true;
      const p = playing;
      playing = null;
      unmount();
      if (p) finishedNonce = p.nonce;
      try {
        if (p?.leads) store.getState().stop(p.nonce);
      } finally {
        failed = false;
      }
    }
  };
  const unsubscribeStore = store.subscribe(guard(sync));
  // Until the prototype draws the screen, each of its frames checks: the veil goes up in the frame the
  // screen first appears, and a Viewer playing alone plans the wireframe from it. Then the animation
  // frames draw alone.
  const unsubscribeFrame = session.runtime.subscribeFrame(
    guard(() => {
      const p = playing;
      if (!p || p.seen) return;
      if (p.waiting) sync();
      else draw(performance.now());
    }),
  );
  guard(sync)();
  return () => {
    unsubscribeStore();
    unsubscribeFrame();
    const p = playing;
    playing = null;
    unmount();
    if (p?.leads) store.getState().stop(p.nonce);
    release();
  };
}
