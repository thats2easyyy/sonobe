/**
 * The import hologram on the canvas: over a screen that was just imported, the design hides under a
 * dark veil while pixel rain falls; a laser sweeps down and each layer's wireframe traces in as the
 * laser passes it, div by div; then the laser sweeps back up and the real design materializes beneath
 * it, and a soft bloom around the frame hands the screen back to its selection. One 2D canvas drawn by
 * requestAnimationFrame (no React render per frame), following the viewport live. It publishes its
 * timeline as the show (hologram.ts), which the Viewer plays along with. It never takes a click: a
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
import { drawFrame, drawGrid, drawLaser, drawRain, drawRevealEdge, drawTips, drawVeil, fitCanvas, mixColor, prefersReducedMotion, readHoloColors, rgba, textBars, traceCross, traceOutline, traceOval, type HoloColors } from "./hologramDraw.ts";
import { chromeHeldUntil, collectHoloLayers, GLOW_PEAK, HOLO, holoFrameAt, planHologram, traceProgress, type HoloFrame, type HoloPiece, type HoloPlan, type Radii } from "./hologramPlan.ts";
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

/** How long a traced outline stays brighter than the rest. */
const FRESH_MS = 420;
/** How brightly the rain falls where the laser has already scanned. */
const SCANNED_RAIN = 0.42;
/** Wireframe colors by depth: cyan drifting toward the secondary blue. */
const DEPTH_BUCKETS = 4;

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
    const plan = planHologram(collected.screen, collected.layers, { reduced: prefersReducedMotion() });
    const start = performance.now();
    store.getState().play({ nonce: request.nonce, componentId, screenId: request.screenId, start, timeline: plan.timeline, reduced: plan.reduced, lead: "canvas" });
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
    const depthColors = Array.from({ length: DEPTH_BUCKETS }, (_, i) => mixColor(colors.line, colors.tint, (i / (DEPTH_BUCKETS - 1)) * 0.75));
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
      drawBuildFrame(ctx, { plan, frame, t, screen, toScreen, colors, depthColors, seed });
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

interface BuildFrame {
  plan: HoloPlan;
  frame: HoloFrame;
  t: number;
  /** The screen in canvas CSS pixels. */
  screen: Rect;
  toScreen: (r: Rect) => Rect;
  colors: HoloColors;
  depthColors: readonly (readonly [number, number, number])[];
  seed: number;
}

/** One frame of the build: veil, grid and rain; wireframes; the reveal edge; the laser; the frame. */
function drawBuildFrame(ctx: CanvasRenderingContext2D, { plan, frame, t, screen, toScreen, colors, depthColors, seed }: BuildFrame): void {
  const laserY = frame.laser === null ? null : screen.y + screen.height * frame.laser;
  ctx.save();
  ctx.beginPath();
  ctx.rect(screen.x, screen.y, screen.width, screen.height);
  ctx.clip();

  if (frame.veil > 0) {
    const bottom = screen.y + screen.height * frame.veil;
    ctx.save();
    ctx.beginPath();
    ctx.rect(screen.x, screen.y, screen.width, bottom - screen.y);
    ctx.clip();
    drawVeil(ctx, screen, colors);
    drawGrid(ctx, screen, colors);
    // The rain calms where the laser has scanned, so the wireframe reads.
    const scanned = frame.phase === "power" ? -Infinity : frame.phase === "down" && laserY !== null ? laserY : Infinity;
    if (!plan.reduced) drawRain(ctx, screen, t / 1000, colors, { seed, bottom, alpha: frame.phase === "power" ? Math.min(1, t / HOLO.powerMs) : 1, dim: { top: -Infinity, bottom: scanned, alpha: SCANNED_RAIN } });
    ctx.restore();
  }

  if (frame.phase === "down" && laserY !== null) {
    // The laser prints the wireframe: outlines race along their top edges, but their sides only
    // reach as far as the laser has scanned.
    ctx.save();
    ctx.beginPath();
    ctx.rect(screen.x, screen.y, screen.width, laserY + laserLead(screen) - screen.y);
    ctx.clip();
    drawWires(ctx, plan, t, toScreen, colors, depthColors);
    ctx.restore();
  } else if (frame.phase !== "glow") {
    drawWires(ctx, plan, t, toScreen, colors, depthColors);
  }

  if (frame.phase === "up" && laserY !== null) {
    // Wireframes fade out behind the laser as the design materializes.
    const fade = Math.min(96, Math.max(24, screen.height * 0.22));
    ctx.globalCompositeOperation = "destination-out";
    const erase = ctx.createLinearGradient(0, laserY, 0, laserY + fade);
    erase.addColorStop(0, "rgba(0,0,0,0)");
    erase.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = erase;
    ctx.fillRect(screen.x, laserY, screen.width, fade);
    ctx.fillStyle = "#000";
    ctx.fillRect(screen.x, laserY + fade, screen.width, Math.max(0, screen.y + screen.height - laserY - fade));
    ctx.globalCompositeOperation = "source-over";
    drawRevealEdge(ctx, screen, laserY, colors);
  }
  ctx.restore();

  if (laserY !== null) drawLaser(ctx, screen, Math.min(screen.y + screen.height - 0.75, Math.max(screen.y + 0.75, laserY)), frame.direction, colors, { intensity: frame.phase === "hold" ? 0.85 : 1 });
  // Closing, the outline and its viewfinder corners hand over to the bloom as its hairline flashes out,
  // so there's one line at a time; the selection outline comes back inside it at the peak.
  const { upEnd, end } = plan.timeline;
  const release = frame.phase === "glow" ? Math.min(1, (t - upEnd) / Math.max(1, end - upEnd)) : 0;
  const handover = Math.min(1, release / (GLOW_PEAK / 2));
  const outline = 1 - handover * handover * (3 - 2 * handover);
  drawFrame(ctx, screen, colors, { trace: frame.frame, glow: frame.glow, hairline: frame.hairline, outline, brackets: outline });
}

/** How far below the laser the wireframe may reach while it sweeps down (CSS px). */
export function laserLead(screen: Rect): number {
  return Math.min(10, Math.max(3, screen.height * 0.012));
}

function wirePath(ctx: CanvasPath, piece: HoloPiece, r: Rect, p: number, zoom: number): [number, number][] {
  if (piece.shape === "oval") return traceOval(ctx, r, p);
  const [tl, tr, br, bl] = piece.radii;
  const radii: Radii = [tl * zoom, tr * zoom, br * zoom, bl * zoom];
  const tips = traceOutline(ctx, r, radii, p);
  if (piece.shape === "image") traceCross(ctx, r, p, radii);
  return tips;
}

/** Crisp 1px lines: outlines sit on half pixels. */
const crispRect = (r: Rect): Rect => ({ x: Math.round(r.x) + 0.5, y: Math.round(r.y) + 0.5, width: Math.max(1, Math.round(r.width) - 1), height: Math.max(1, Math.round(r.height) - 1) });

function drawWires(ctx: CanvasRenderingContext2D, plan: HoloPlan, t: number, toScreen: (r: Rect) => Rect, c: HoloColors, depthColors: BuildFrame["depthColors"]): void {
  const zoom = plan.screen.width > 0 ? toScreen(plan.screen).width / plan.screen.width : 1;
  const settledLines = depthColors.map(() => new Path2D());
  const settledBars = depthColors.map(() => new Path2D());
  const fresh: { piece: HoloPiece; r: Rect; p: number; glow: number; bucket: number }[] = [];
  let any = false;
  for (const piece of plan.pieces) {
    const p = traceProgress(piece, t, plan.reduced);
    if (p <= 0) continue;
    const r = toScreen(piece.rect);
    if (r.width < 0.75 || r.height < 0.75) continue;
    const bucket = Math.min(DEPTH_BUCKETS - 1, piece.depth - 1);
    const glow = plan.reduced ? 0 : 1 - Math.min(1, Math.max(0, (t - piece.at - HOLO.traceMs) / FRESH_MS));
    if (p < 1 || glow > 0) {
      fresh.push({ piece, r, p, glow, bucket });
      continue;
    }
    any = true;
    if (piece.shape === "text") textBars(settledBars[bucket]!, r, piece.lines, 1);
    else wirePath(settledLines[bucket]!, piece, crispRect(r), 1, zoom);
  }
  if (any) {
    ctx.lineWidth = 1;
    depthColors.forEach((color, i) => {
      ctx.strokeStyle = rgba(color, c.wireAlpha);
      ctx.stroke(settledLines[i]!);
      ctx.fillStyle = rgba(color, c.wireAlpha * 0.62);
      ctx.fill(settledBars[i]!);
    });
  }
  // Outlines tracing now, and the ones just traced, glow brighter.
  const tips: [number, number][] = [];
  for (const { piece, r, p, glow, bucket } of fresh) {
    const color = mixColor(depthColors[bucket]!, c.core, 0.35 * glow);
    const energy = p < 1 ? 1 : glow;
    ctx.beginPath();
    if (piece.shape === "text") {
      textBars(ctx, r, piece.lines, p);
      ctx.fillStyle = rgba(color, c.wireAlpha * 0.62 + (1 - c.wireAlpha * 0.62) * energy);
      ctx.fill();
      continue;
    }
    tips.push(...wirePath(ctx, piece, crispRect(r), p, zoom));
    ctx.strokeStyle = rgba(color, 0.28 * energy);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = rgba(color, c.wireAlpha + (1 - c.wireAlpha) * energy);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  drawTips(ctx, tips, c, 1.2);
}
