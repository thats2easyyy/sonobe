/**
 * Canvas rulers: artboard coordinates along the top and left edges at the current zoom and pan, with
 * the selection's extent highlighted. Drawn into canvases so panning stays cheap.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Rect } from "./geometry.ts";
import { formatRulerValue, RULER_SIZE, rulerRange, rulerScale, rulerTicks } from "./rulers.ts";
import type { Viewport } from "./viewport.ts";

export interface CanvasRulersProps {
  viewport: Viewport;
  /** Canvas body size in CSS pixels. */
  width: number;
  height: number;
  /** Selection bounds in artboard space. */
  selection: Rect | null;
}

interface RulerColors {
  text: string;
  tick: string;
  accent: string;
  background: string;
  font: string;
}

function readColors(el: HTMLElement): RulerColors {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return {
    text: style?.color || "#8a8a94",
    tick: style?.borderTopColor || "rgba(128,128,140,0.5)",
    accent: style?.outlineColor || "#3d7bff",
    background: style?.backgroundColor || "#1c1c20",
    font: `500 9.5px ${style?.fontFamily || "system-ui, sans-serif"}`,
  };
}

function drawRuler(canvas: HTMLCanvasElement, axis: "x" | "y", length: number, viewport: Viewport, selection: Rect | null) {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx || length <= 0) return;
  const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  const w = axis === "x" ? length : RULER_SIZE;
  const h = axis === "x" ? RULER_SIZE : length;
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const colors = readColors(canvas);
  const offset = axis === "x" ? viewport.x : viewport.y;
  // Ruler pixel 0 sits RULER_SIZE into the canvas body (after the corner).
  const toRuler = (p: number) => p - RULER_SIZE;

  const range = rulerRange(selection, viewport, axis);
  if (range) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = colors.accent;
    const a = toRuler(range.start);
    const b = toRuler(range.end);
    if (axis === "x") ctx.fillRect(a, 0, b - a, RULER_SIZE);
    else ctx.fillRect(0, a, RULER_SIZE, b - a);
    ctx.restore();
  }

  const scale = rulerScale(viewport.zoom);
  const ticks = rulerTicks(offset - RULER_SIZE, viewport.zoom, length, scale);
  ctx.strokeStyle = colors.tick;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const tick of ticks) {
    const p = Math.round(tick.position) + 0.5;
    if (p < -1 || p > length + 1) continue;
    const size = tick.major ? 7 : 3;
    if (axis === "x") {
      ctx.moveTo(p, RULER_SIZE - size);
      ctx.lineTo(p, RULER_SIZE);
    } else {
      ctx.moveTo(RULER_SIZE - size, p);
      ctx.lineTo(RULER_SIZE, p);
    }
  }
  ctx.stroke();

  const avoid = range ? [toRuler(range.start), toRuler(range.end)] : [];
  ctx.font = colors.font;
  ctx.fillStyle = colors.text;
  ctx.textBaseline = "middle";
  for (const tick of ticks) {
    if (!tick.major) continue;
    const p = tick.position;
    if (p < -40 || p > length + 40 || avoid.some((q) => Math.abs(q - p) < 34)) continue;
    drawLabel(ctx, axis, formatRulerValue(tick.value), p + 3);
  }

  if (range) {
    ctx.fillStyle = colors.accent;
    ctx.font = colors.font.replace(/^500/, "600");
    const labels: [number, number, boolean][] = [
      [toRuler(range.start), range.from, true],
      [toRuler(range.end), range.to, false],
    ];
    for (const [p, value, before] of labels) {
      if (Math.abs(range.end - range.start) < 1 && !before) continue;
      const text = formatRulerValue(value);
      const width = ctx.measureText(text).width;
      const at = before ? p - width - 3 : p + 3;
      ctx.save();
      ctx.fillStyle = colors.background;
      if (axis === "x") ctx.fillRect(at - 2, 2, width + 4, 12);
      else ctx.fillRect(2, before ? p - 3 - width - 2 : p + 1, 12, width + 4);
      ctx.restore();
      ctx.strokeStyle = colors.accent;
      ctx.beginPath();
      const q = Math.round(p) + 0.5;
      if (axis === "x") {
        ctx.moveTo(q, 0);
        ctx.lineTo(q, RULER_SIZE);
      } else {
        ctx.moveTo(0, q);
        ctx.lineTo(RULER_SIZE, q);
      }
      ctx.stroke();
      drawLabel(ctx, axis, text, at);
    }
  }
}

/** A label starting `at` pixels along the ruler; vertical labels read bottom to top. */
function drawLabel(ctx: CanvasRenderingContext2D, axis: "x" | "y", text: string, at: number) {
  if (axis === "x") {
    ctx.fillText(text, at, 8);
    return;
  }
  ctx.save();
  ctx.translate(8, at + ctx.measureText(text).width);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function CanvasRulers({ viewport, width, height, selection }: CanvasRulersProps) {
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const [themeVersion, setThemeVersion] = useState(0);

  // Redraw when the theme changes (colors come from CSS).
  useEffect(() => {
    const el = topRef.current;
    if (!el || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setThemeVersion((v) => v + 1));
    const targets = new Set<Element>([el.ownerDocument.documentElement]);
    const themed = el.closest("[data-theme]");
    if (themed) targets.add(themed);
    for (const target of targets) observer.observe(target, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const media = el.ownerDocument.defaultView?.matchMedia?.("(prefers-color-scheme: dark)");
    const onScheme = () => setThemeVersion((v) => v + 1);
    media?.addEventListener?.("change", onScheme);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", onScheme);
    };
  }, []);

  useLayoutEffect(() => {
    if (topRef.current) drawRuler(topRef.current, "x", Math.max(0, width - RULER_SIZE), viewport, selection);
    if (leftRef.current) drawRuler(leftRef.current, "y", Math.max(0, height - RULER_SIZE), viewport, selection);
  }, [viewport, width, height, selection, themeVersion]);

  return (
    <>
      <canvas ref={topRef} className="sb-cv__ruler" data-axis="x" aria-hidden style={{ left: RULER_SIZE, width: Math.max(0, width - RULER_SIZE), height: RULER_SIZE }} />
      <canvas ref={leftRef} className="sb-cv__ruler" data-axis="y" aria-hidden style={{ top: RULER_SIZE, width: RULER_SIZE, height: Math.max(0, height - RULER_SIZE) }} />
      <div className="sb-cv__ruler-corner" aria-hidden />
    </>
  );
}
