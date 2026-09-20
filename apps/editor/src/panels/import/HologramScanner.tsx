/**
 * The Import Design dialog's scanner while a page is captured: a frame with the import's proportions,
 * pixel rain over a faint grid, and a laser sweeping slowly down and back up. Drawn with the canvas
 * build's code on one 2D canvas; reduced motion shows the still frame.
 */

import { useLayoutEffect, useRef } from "react";
import type { Rect } from "../canvas/geometry.ts";
import { drawFrame, drawGrid, drawLaser, drawRain, drawVeil, fitCanvas, prefersReducedMotion, readHoloColors } from "./hologramDraw.ts";
import { sweepCurve } from "./hologramPlan.ts";
import "./hologram.css";

/** One sweep, top to bottom (then bottom to top). */
export const SCAN_SWEEP_MS = 2750;
/** Room around the frame for the laser's ends and flares. */
const PAD_X = 14;
const PAD_Y = 10;

export interface HologramScannerProps {
  /** The frame's size in CSS pixels. */
  width: number;
  height: number;
}

/** Where the laser is `t` ms into the scan (0 top → 1 bottom), and which way it's going. */
export function scanLaserAt(t: number): { y: number; direction: 1 | -1 } {
  const u = (Math.max(0, t) % (SCAN_SWEEP_MS * 2)) / SCAN_SWEEP_MS;
  return u < 1 ? { y: sweepCurve(u), direction: 1 } : { y: 1 - sweepCurve(u - 1), direction: -1 };
}

export function HologramScanner({ width, height }: HologramScannerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const colors = readHoloColors(canvas);
    const frame: Rect = { x: PAD_X, y: PAD_Y, width: w, height: h };
    const reduced = prefersReducedMotion();
    const start = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const dpr = fitCanvas(canvas, w + PAD_X * 2, h + PAD_Y * 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w + PAD_X * 2, h + PAD_Y * 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(frame.x, frame.y, frame.width, frame.height);
      ctx.clip();
      drawVeil(ctx, frame, colors);
      drawGrid(ctx, frame, colors);
      const t = now - start;
      const laser = scanLaserAt(t);
      const y = frame.y + frame.height * laser.y;
      // The rain falls brighter where the laser is headed than where it has been.
      if (!reduced) drawRain(ctx, frame, t / 1000, colors, { dim: laser.direction > 0 ? { top: -Infinity, bottom: y, alpha: 0.5 } : { top: y, bottom: Infinity, alpha: 0.5 } });
      ctx.restore();
      if (!reduced) drawLaser(ctx, frame, Math.min(frame.y + frame.height - 0.75, Math.max(frame.y + 0.75, y)), laser.direction, colors);
      drawFrame(ctx, frame, colors);
    };
    draw(start);
    if (reduced) return;
    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [w, h]);

  return <canvas ref={canvasRef} className="sb-holo-scan" aria-hidden style={{ width: w + PAD_X * 2, height: h + PAD_Y * 2, margin: `${-PAD_Y}px ${-PAD_X}px` }} />;
}

/** The biggest frame with the import's proportions that fits `box` (CSS px), no taller than `max`. */
export function scannerFrame(aspect: readonly [number, number], box: { width: number; height: number }, max = 420): { width: number; height: number } {
  const ratio = aspect[0] > 0 && aspect[1] > 0 ? aspect[0] / aspect[1] : 1;
  let height = Math.max(0, Math.min(max, box.height));
  let width = height * ratio;
  if (width > box.width) {
    width = Math.max(0, box.width);
    height = width / ratio;
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}
