/**
 * The import hologram on the canvas: over a screen that was just imported, the design hides under a
 * dark veil while pixel rain falls; a laser sweeps down and each layer's wireframe traces in as the
 * laser passes it, div by div; then the laser sweeps back up and the real design materializes beneath
 * it, and a soft bloom around the frame hands the screen back to its selection. One 2D canvas drawn by
 * requestAnimationFrame (no React render per frame), following the viewport live. It publishes its
 * plan as the show (hologram.ts), which the Viewer plays along with. It never takes a click: a
 * click, a key, an undo or another document ends it early (watchHolograms).
 */

import type { Id } from "@sonobe/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { EditorSession } from "../../state/session.ts";
import { useLatest } from "../../ui/lib/hooks.ts";
import type { Rect } from "../canvas/geometry.ts";
import type { CanvasIndex } from "../canvas/sceneIndex.ts";
import type { Viewport } from "../canvas/viewport.ts";
import { HOLOGRAM_STALE_MS, hologramStore, watchHolograms } from "./hologram.ts";
import { depthColors, drawBuildFrame, fitCanvas, prefersReducedMotion, readHoloColors } from "./hologramDraw.ts";
import { chromeHeldUntil, collectHoloLayers, HOLO, holoFrameAt, planHologram, type HoloPlan } from "./hologramPlan.ts";
import "./hologram.css";

export interface HologramBuildProps {
  session: EditorSession;
  /** The component the canvas draws. */
  componentId: Id;
  index: CanvasIndex;
  viewport: Viewport;
  /** The canvas body's size in CSS pixels. */
  width: number;
  height: number;
}

interface Run {
  nonce: number;
  componentId: Id;
  screenId: Id;
  plan: HoloPlan;
  /** performance.now() at the timeline's zero (the show's start). */
  start: number;
}

/** The screen a hologram on this component's canvas covers now (its selection chrome waits). */
export function useCoveredScreen(session: EditorSession, componentId: Id): Id | null {
  return useStore(hologramStore(session), (s) => (s.covering?.componentId === componentId ? s.covering.screenId : null));
}

export function HologramBuild({ session, componentId, index, viewport, width, height }: HologramBuildProps) {
  const store = hologramStore(session);
  const request = useStore(store, (s) => s.request);
  const [run, setRun] = useState<Run | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useLatest({ viewport, width, height, index });
  /** Draws the current frame now (a pan or a resize redraws before the browser paints). */
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => watchHolograms(session), [session]);
  // Requests for this component wait for this canvas (the Viewer plays along instead of alone).
  useEffect(() => store.getState().addCanvas(componentId), [store, componentId]);

  // Take a request for this component once the canvas draws its screen, and publish the show.
  useLayoutEffect(() => {
    if (!request || request.componentId !== componentId) return;
    if (performance.now() - request.at > HOLOGRAM_STALE_MS) return store.getState().take(request.nonce);
    if (width <= 0 || height <= 0) return;
    const collected = collectHoloLayers(index, request.screenId);
    if (!collected) return;
    const plan = planHologram(collected.screen, collected.layers, { reduced: prefersReducedMotion(), radii: collected.radii });
    const start = performance.now();
    store.getState().play({ nonce: request.nonce, componentId, screenId: request.screenId, start, plan, lead: "canvas" });
    setRun({ nonce: request.nonce, componentId, screenId: request.screenId, plan, start });
  }, [request, componentId, index, width, height, store]);

  // Another component: the screen isn't drawn any more.
  const active = run && run.componentId === componentId ? run : null;
  useEffect(() => {
    if (!run || run.componentId === componentId) return;
    store.getState().stop(run.nonce);
    setRun(null);
  }, [run, componentId, store]);
  // Unmounted mid-build (the canvas closed): the show ends with it.
  const runRef = useLatest(run);
  useEffect(() => () => void (runRef.current && store.getState().stop(runRef.current.nonce)), [runRef, store]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!active || !canvas || !ctx) return;
    const { plan, screenId, start } = active;
    const colors = readHoloColors(canvas);
    const depths = depthColors(colors);
    const seed = active.nonce * 7919;
    const heldUntil = chromeHeldUntil(plan);
    let raf = 0;
    let phase = "";
    /** The part of the canvas body the canvas covers now ("x,y,w,h"). */
    let placed = "";
    let finished = false;
    const target = { componentId: active.componentId, screenId };
    /** Hide the screen's selection chrome while the hologram builds it; it returns once the closing bloom peaks, or at once on an early end. */
    let covering = false;
    const setCovering = (on: boolean) => {
      if (on === covering) return;
      covering = on;
      const current = store.getState().covering;
      if (on) store.getState().cover(target);
      else if (current?.componentId === target.componentId && current.screenId === target.screenId) store.getState().cover(null);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      redraw.current = null;
      setCovering(false);
      setRun((r) => (r?.nonce === active.nonce ? null : r));
    };

    const draw = (now: number): boolean => {
      const { viewport: vp, width: w, height: h, index: idx } = latest.current;
      const show = store.getState().show;
      // Stopped (undone, another document), or a newer import took over.
      if (show?.nonce !== active.nonce) {
        finish();
        return false;
      }
      const t = now - start;
      const frame = holoFrameAt(plan, t);
      const fade = show.endedAt === null ? 1 : 1 - (now - show.endedAt) / HOLO.endFadeMs;
      if (frame.phase === "done" || fade <= 0) {
        finish();
        store.getState().stop(active.nonce);
        return false;
      }
      setCovering(show.endedAt === null && t < heldUntil);
      // Follow the screen if it moved (Claude may keep editing while it plays).
      const current = idx.bounds(screenId) ?? plan.screen;
      const dx = current.x - plan.screen.x;
      const dy = current.y - plan.screen.y;
      const ox = Math.round(vp.x);
      const oy = Math.round(vp.y);
      const toScreen = (r: Rect): Rect => ({ x: ox + (r.x + dx) * vp.zoom, y: oy + (r.y + dy) * vp.zoom, width: r.width * vp.zoom, height: r.height * vp.zoom });
      const screen = toScreen(plan.screen);
      // The canvas covers only the screen's visible part, plus what the laser, flares and glow reach past it.
      const region = visibleRegion(screen, w, h, 48);
      const key = `${region.x},${region.y},${region.width},${region.height}`;
      if (key !== placed) {
        placed = key;
        canvas.style.transform = `translate(${region.x}px, ${region.y}px)`;
        canvas.style.width = `${region.width}px`;
        canvas.style.height = `${region.height}px`;
      }
      const dpr = fitCanvas(canvas, region.width, region.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.opacity = String(Math.max(0, frame.alpha * fade));
      if (frame.phase !== phase) {
        phase = frame.phase;
        canvas.dataset.phase = phase;
      }
      if (region.width <= 0 || region.height <= 0) return true;
      // Draw in canvas-body coordinates.
      ctx.setTransform(dpr, 0, 0, dpr, -region.x * dpr, -region.y * dpr);
      drawBuildFrame(ctx, { plan, frame, t, screen, toScreen, colors, depths, seed });
      return true;
    };

    // One clock for every draw (a frame's timestamp can trail performance.now(), which redraws and
    // the Viewer read), so a phase never flickers back at its edge.
    const loop = () => {
      if (draw(performance.now())) raf = requestAnimationFrame(loop);
    };
    redraw.current = () => {
      if (!finished) draw(performance.now());
    };
    // The first frame goes up before the browser paints, so the design never shows before its veil.
    if (draw(performance.now())) raf = requestAnimationFrame(loop);
    // An early end brings the selection chrome back at once, over the fading hologram; a stop removes it now.
    const unsubscribe = store.subscribe((s, previous) => {
      if (s.show !== previous.show && !finished) draw(performance.now());
    });
    return () => {
      cancelAnimationFrame(raf);
      redraw.current = null;
      setCovering(false);
      unsubscribe();
    };
  }, [active, latest, store]);

  // Pan, zoom and panel resizes redraw in the same frame as the design moves.
  useLayoutEffect(() => redraw.current?.(), [viewport, width, height, index]);

  if (!active) return null;
  return <canvas key={active.nonce} ref={canvasRef} className="sb-holo" aria-hidden data-phase="power" />;
}

/** The part of a `width` × `height` body a screen rect covers, grown by `margin`, on whole pixels. */
export function visibleRegion(screen: Rect, width: number, height: number, margin: number): Rect {
  const x = Math.max(0, Math.floor(screen.x - margin));
  const y = Math.max(0, Math.floor(screen.y - margin));
  const right = Math.min(Math.ceil(width), Math.ceil(screen.x + screen.width + margin));
  const bottom = Math.min(Math.ceil(height), Math.ceil(screen.y + screen.height + margin));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}
