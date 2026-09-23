/**
 * Design with Claude's build over the preview: from the moment the request starts, pixel and glyph
 * rain fall under a dark veil and the laser sweeps down and up; loader boxes trace in where the page's
 * elements will be as Claude writes them (buildPlan.ts); and once the page is complete and every box
 * is in place, the laser sweeps up one last time and the page shows beneath it, then a glow closes it.
 * The page's frame stays hidden below the veil until the final sweep uncovers it (a clip-path set
 * here, each frame). One 2D canvas drawn by requestAnimationFrame, no React render per frame. Reduced
 * motion: no rain or sweeps; the loader boxes appear, then crossfade to the page.
 */

import { useLayoutEffect, useRef, type RefObject } from "react";
import { useLatest } from "../../ui/lib/hooks.ts";
import type { Rect } from "../canvas/geometry.ts";
import { scanLaserAt } from "../import/HologramScanner.tsx";
import { drawFrame, drawGlyphRain, drawGrid, drawLaser, drawRain, drawRevealEdge, drawTips, drawVeil, fitCanvas, prefersReducedMotion, readHoloColors, rgba, textBars, traceCross, traceOutline, traceOval, type HoloColors } from "../import/hologramDraw.ts";
import { BUILD, buildReadyAt, finalSweepAt, planFinalSweep, type BuildState, type FinalSweep } from "./buildPlan.ts";

/** Room around the frame for the laser's ends and flares. */
const PAD_X = 14;
const PAD_Y = 10;

export interface DesignBuildProps {
  /** The frame's size on screen, in CSS pixels. */
  width: number;
  height: number;
  /** The page's size in points (its boxes' space). */
  pageWidth: number;
  pageHeight: number;
  build: BuildState;
  /** When the page is complete and measured (performance.now() ms), else null: once that's passed and every box is in, the final sweep runs. */
  completeAt: number | null;
  /** The page's frame, uncovered by the final sweep. */
  frame: RefObject<HTMLIFrameElement | null>;
  /** The final sweep and its glow are done. */
  onDone(): void;
}

function drawBoxes(ctx: CanvasRenderingContext2D, build: BuildState, frame: Rect, scale: number, now: number, c: HoloColors, reduced: boolean): void {
  const outlines = new Path2D();
  const bars = new Path2D();
  const fills = new Path2D();
  const fresh = new Path2D();
  const tips: [number, number][] = [];
  const toScreen = (r: Rect): Rect => ({ x: frame.x + r.x * scale, y: frame.y + r.y * scale, width: r.width * scale, height: r.height * scale });
  for (const box of build.boxes.values()) {
    const p = reduced ? 1 : Math.min(1, (now - box.at) / BUILD.traceMs);
    if (p <= 0) continue;
    const r = toScreen(box.rect);
    if (box.shape === "text") {
      textBars(bars, r, box.lines, p);
      continue;
    }
    // The loader fill: a faint block, brighter for a moment as it lands.
    const fill = box.shape === "oval" ? () => fills.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2) : () => (fills.roundRect ? fills.roundRect(r.x, r.y, r.width, r.height, Math.min(box.radius * scale, r.width / 2, r.height / 2)) : fills.rect(r.x, r.y, r.width, r.height));
    if (p >= 1) fill();
    if (!reduced && now - box.at < BUILD.traceMs * 2.2) fresh.rect(r.x, r.y, r.width, r.height);
    tips.push(...(box.shape === "oval" ? traceOval(outlines, r, p) : traceOutline(outlines, r, box.radius * scale, p)));
    if (box.shape === "image") traceCross(outlines, r, p, box.radius * scale);
  }
  // A slow shimmer across the loader fills, like a page's placeholders waiting for content.
  const shimmer = reduced ? 0.07 : 0.06 + 0.035 * Math.sin(now / 420);
  ctx.fillStyle = rgba(c.line, shimmer);
  ctx.fill(fills);
  ctx.fillStyle = rgba(c.line, 0.1);
  ctx.fill(fresh);
  ctx.fillStyle = rgba(c.line, 0.5);
  ctx.fill(bars);
  ctx.strokeStyle = rgba(c.line, c.wireAlpha);
  ctx.lineWidth = 1;
  ctx.stroke(outlines);
  if (tips.length) drawTips(ctx, tips, c);
}

export function DesignBuild({ width, height, pageWidth, pageHeight, build, completeAt, frame, onDone }: DesignBuildProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useLatest({ width, height, pageWidth, pageHeight, build, completeAt, frame, onDone });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // Nothing to draw with: the page shows as it is.
    if (!canvas || !ctx) {
      latest.current.onDone();
      return;
    }
    const colors = readHoloColors(canvas);
    const reduced = prefersReducedMotion();
    const start = performance.now();
    let final: FinalSweep | null = null;
    let done = false;
    let clip = "";
    let raf = 0;
    const setClip = (value: string) => {
      const el = latest.current.frame.current;
      if (!el || el.style.clipPath === value) return;
      el.style.clipPath = value;
      clip = value;
    };

    const draw = (now: number) => {
      const L = latest.current;
      const w = Math.max(1, Math.round(L.width));
      const h = Math.max(1, Math.round(L.height));
      const dpr = fitCanvas(canvas, w + PAD_X * 2, h + PAD_Y * 2);
      canvas.style.width = `${w + PAD_X * 2}px`;
      canvas.style.height = `${h + PAD_Y * 2}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w + PAD_X * 2, h + PAD_Y * 2);
      ctx.globalAlpha = 1;
      const rect: Rect = { x: PAD_X, y: PAD_Y, width: w, height: h };
      const scale = L.pageWidth > 0 ? w / L.pageWidth : 1;
      const t = now - start;
      const loop = scanLaserAt(t);
      if (!final && L.completeAt !== null && now >= L.completeAt && now >= buildReadyAt(L.build)) final = planFinalSweep(now, loop.y, L.pageHeight, reduced);
      const sweep = final ? finalSweepAt(final, now) : { y: loop.y, direction: loop.direction, reveal: 1, glow: 0, laser: true };
      const fade = final?.reduced ? Math.max(0, 1 - (now - final.start) / BUILD.fadeMs) : 1;

      // The page shows below the reveal line; the build covers the rest.
      if (final?.reduced) setClip("");
      else setClip(sweep.reveal >= 1 ? "inset(100% 0 0 0)" : sweep.reveal <= 0 ? "" : `inset(${(sweep.reveal * 100).toFixed(3)}% 0 0 0)`);
      const veiled = rect.height * sweep.reveal;
      ctx.globalAlpha = fade;
      if (veiled > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, veiled);
        ctx.clip();
        drawVeil(ctx, rect, colors);
        drawGrid(ctx, rect, colors);
        if (!reduced) {
          const y = rect.y + rect.height * sweep.y;
          drawRain(ctx, rect, t / 1000, colors, { dim: sweep.direction > 0 ? { top: -Infinity, bottom: y, alpha: 0.5 } : { top: y, bottom: Infinity, alpha: 0.5 }, alpha: 0.85 });
          drawGlyphRain(ctx, rect, t / 1000, colors, { alpha: 0.8 });
        }
        drawBoxes(ctx, L.build, rect, scale, now, colors, reduced);
        ctx.restore();
      }
      if (final && !final.reduced && sweep.reveal > 0 && sweep.reveal < 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.clip();
        drawRevealEdge(ctx, rect, rect.y + veiled, colors);
        ctx.restore();
      }
      if (!reduced && sweep.laser) drawLaser(ctx, rect, Math.min(rect.y + rect.height - 0.75, Math.max(rect.y + 0.75, rect.y + rect.height * sweep.y)), sweep.direction, colors);
      drawFrame(ctx, rect, colors, { glow: sweep.glow, brackets: sweep.reveal > 0 || sweep.glow > 0 ? 1 : 0, outline: final && sweep.reveal <= 0 ? 1 - Math.min(1, (now - final.upEnd) / BUILD.glowMs) : 1 });
      ctx.globalAlpha = 1;

      if (final && now >= final.end && !done) {
        done = true;
        setClip("");
        ctx.clearRect(0, 0, w + PAD_X * 2, h + PAD_Y * 2);
        L.onDone();
      }
    };

    const tick = (now: number) => {
      draw(now);
      if (!done) raf = requestAnimationFrame(tick);
    };
    draw(performance.now());
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Never leave the page's frame covered.
      const el = latest.current.frame.current;
      if (el && clip) el.style.clipPath = "";
    };
  }, [latest]);

  return <canvas ref={canvasRef} className="sb-design-build" aria-hidden style={{ width: Math.round(width) + PAD_X * 2, height: Math.round(height) + PAD_Y * 2, margin: `${-PAD_Y}px ${-PAD_X}px` }} />;
}
