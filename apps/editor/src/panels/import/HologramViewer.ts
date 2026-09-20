/**
 * The Viewer's part in the import hologram. While the canvas builds an imported screen, the Viewer
 * would show the finished design and spoil the reveal, so its device screen plays along: a matching
 * veil with pixel rain over the screen, the laser sweeping it in step, and the veil dissolving with the
 * canvas build's up sweep, all from the show's timeline (hologram.ts). When no canvas draws the
 * screen's component (the patches-only view, another component) the Viewer plays it alone. One 2D
 * canvas inside the device screen, under its cutout, so it follows the viewer's scale and device frame;
 * it never takes a pointer, and the same click, key or undo ends it early.
 */

import { findLayer, type Id } from "@sonobe/core";
import type { EditorSession } from "../../state/session.ts";
import { componentInPrototype, layerSceneRect } from "../viewer/viewerModel.ts";
import { HOLOGRAM_STALE_MS, hologramStore, viewerHoloMode, watchHolograms, type HologramRequest } from "./hologram.ts";
import { drawGrid, drawLaser, drawRain, drawRevealEdge, drawVeil, mixColor, prefersReducedMotion, readHoloColors, rgba, type HoloColors } from "./hologramDraw.ts";
import { HOLO, holoFrameAt, planHologram, type HoloTimeline } from "./hologramPlan.ts";
import "./hologram.css";

/** A show whose screen the prototype never draws within this long isn't the Viewer's to play. */
const FIND_MS = 600;
/** How brightly the rain falls where the laser has already scanned (as on the canvas). */
const SCANNED_RAIN = 0.42;

interface Playing {
  nonce: number;
  componentId: Id;
  screenId: Id;
  start: number;
  timeline: HoloTimeline;
  reduced: boolean;
  endedAt: number | null;
  /** Covering for a request a canvas hasn't taken yet, on a timeline from when it was asked for. */
  waiting: boolean;
  /** The Viewer plays it alone, so it stops the show when it's done. */
  leads: boolean;
  /** The show went away before it was done (undone, the canvas closed): fading out on its own. */
  orphan: boolean;
  /** The prototype has drawn the screen. */
  seen: boolean;
}

/** The screen's height in points from the document, for a timeline of its own (the canvas has the real one). */
function screenHeight(session: EditorSession, request: HologramRequest): number {
  const rect = layerSceneRect(session.runtime.scene(), request.screenId);
  if (rect) return rect.height;
  const doc = session.document.getState().doc;
  const size = findLayer(doc.components[request.componentId]?.layers ?? [], request.screenId)?.layer.props.size;
  return Array.isArray(size) && typeof size[1] === "number" ? size[1] : HOLO.referenceHeight;
}

export interface ViewerHologramOptions {
  /** The screen the veil covers now, or null: the viewer's selection outline of it waits, as the canvas's does. */
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

  /** A timeline of the Viewer's own for a request: the canvas's, less the outlines' tail. */
  const ownTimeline = (request: HologramRequest) => {
    const reduced = prefersReducedMotion();
    return { reduced, timeline: planHologram({ x: 0, y: 0, width: 1, height: screenHeight(session, request) }, [], { reduced }).timeline };
  };
  const lead = (request: HologramRequest, from: Pick<Playing, "timeline" | "reduced"> | null) => {
    const { timeline, reduced } = from ?? ownTimeline(request);
    store.getState().play({ nonce: request.nonce, componentId: request.componentId, screenId: request.screenId, start: request.at, timeline, reduced, lead: "viewer" });
  };

  const sync = () => {
    const now = performance.now();
    const state = store.getState();
    const mode = viewerHoloMode(state, shownHere, now, playing?.waiting ? playing.nonce : null);
    if (mode.kind === "follow") {
      const show = mode.show;
      if (show.nonce === finishedNonce) return;
      const same = playing?.nonce === show.nonce && !playing.orphan;
      playing = { nonce: show.nonce, componentId: show.componentId, screenId: show.screenId, start: show.start, timeline: show.timeline, reduced: show.reduced, endedAt: show.endedAt, waiting: false, leads: show.lead === "viewer", orphan: false, seen: same ? playing!.seen : false };
    } else if (mode.kind === "wait") {
      const request = mode.request;
      if (playing?.nonce !== request.nonce) playing = { nonce: request.nonce, componentId: request.componentId, screenId: request.screenId, start: request.at, ...ownTimeline(request), endedAt: null, waiting: true, leads: false, orphan: false, seen: false };
    } else if (mode.kind === "lead") {
      // play() publishes the show, and this runs again to follow it.
      return lead(mode.request, playing?.nonce === mode.request.nonce ? playing : null);
    } else if (playing?.waiting && !state.request && !state.show) {
      // The canvas let the request go without playing it: carry on alone, on the timeline already showing.
      return lead({ nonce: playing.nonce, componentId: playing.componentId, screenId: playing.screenId, at: playing.start }, playing);
    } else if (playing && !playing.orphan) {
      // The show ended before this Viewer's frame did (undone, another document, the canvas closed): fade out.
      playing = { ...playing, orphan: true, leads: false, endedAt: playing.endedAt ?? now };
    }
    if (!playing) return;
    mount();
    draw(now);
    if (playing && !raf) raf = requestAnimationFrame(loop);
  };

  const draw = (now: number) => {
    const p = playing;
    if (!p || !canvas || !ctx || !colors) return;
    // A request the canvas hasn't taken in time: sync plays it alone.
    if (p.waiting && now - p.start > HOLOGRAM_STALE_MS) return sync();
    const t = now - p.start;
    const frame = holoFrameAt(p, t);
    const fade = p.endedAt === null ? 1 : 1 - (now - p.endedAt) / HOLO.endFadeMs;
    if (frame.phase === "done" || fade <= 0) return finish();
    const rect = layerSceneRect(session.runtime.scene(), p.screenId);
    if (rect) p.seen = true;
    else if (!p.seen && t > FIND_MS) return finish();
    cover(rect && p.endedAt === null && frame.veil > 0 ? p.screenId : null);
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
    // A screen that fills the device reaches into the bleed.
    const left = rect.x <= 0.5 ? -bleed : rect.x;
    const top = rect.y <= 0.5 ? -bleed : rect.y;
    const right = rect.x + rect.width >= screenWidth - 0.5 ? screenWidth + bleed : rect.x + rect.width;
    const bottom = rect.y + rect.height >= screenHeight - 0.5 ? screenHeight + bleed : rect.y + rect.height;
    const r = { x: left * scale, y: top * scale, width: (right - left) * scale, height: (bottom - top) * scale };
    // Even so, the canvas's bitmap stops at the clip's edge pixel, where the layers' boxes don't: the
    // canvas's CSS background, painted as a box like them, carries the veil into that pixel.
    let background = "";
    if (frame.veil > 0 && left < 0 && right > screenWidth) {
      const from = top + bleed;
      const to = top + (bottom - top) * frame.veil + bleed;
      background = `linear-gradient(to bottom, transparent ${from}px, ${rgba(colors.veilTop, 1)} ${from}px, ${rgba(mixColor(colors.veilTop, colors.veilBottom, frame.veil), 1)} ${to}px, transparent ${to}px)`;
    }
    if (canvas.style.background !== background) canvas.style.background = background;
    const laserY = frame.laser === null ? null : r.y + r.height * frame.laser;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.width, r.height);
    ctx.clip();
    if (frame.veil > 0) {
      const bottom = r.y + r.height * frame.veil;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.width, bottom - r.y);
      ctx.clip();
      drawVeil(ctx, r, colors);
      drawGrid(ctx, r, colors);
      const scanned = frame.phase === "power" ? -Infinity : frame.phase === "down" && laserY !== null ? laserY : Infinity;
      if (!p.reduced) drawRain(ctx, r, t / 1000, colors, { seed: p.nonce * 7919 + 1, bottom, alpha: frame.phase === "power" ? Math.min(1, t / HOLO.powerMs) : 1, dim: { top: -Infinity, bottom: scanned, alpha: SCANNED_RAIN } });
      ctx.restore();
    }
    if (frame.phase === "up" && laserY !== null) drawRevealEdge(ctx, r, laserY, colors);
    ctx.restore();
    if (laserY !== null) drawLaser(ctx, r, Math.min(r.y + r.height - 0.75, Math.max(r.y + 0.75, laserY)), frame.direction, colors, { intensity: frame.phase === "hold" ? 0.85 : 1 });
  };

  // Every draw reads one clock: an animation frame's timestamp can fall behind performance.now(),
  // which the runtime's frames draw with, and the phase would flicker back at its edges.
  const loop = () => {
    raf = 0;
    draw(performance.now());
    if (playing) raf = requestAnimationFrame(loop);
  };

  const unsubscribeStore = store.subscribe(sync);
  // The prototype draws the new screen in a runtime frame: the veil goes up in that same frame.
  const unsubscribeFrame = session.runtime.subscribeFrame(() => {
    if (playing) draw(performance.now());
  });
  sync();
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
