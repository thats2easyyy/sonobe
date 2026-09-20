/**
 * Node text measured in the editor's own fonts (a 2D canvas with the theme's --font-sans and
 * --font-mono), so size estimates match the DOM on any OS. Where there's no canvas (tests), the
 * shared SF Pro / SF Mono table stands in.
 */

import { NODE_FONTS, tableMeasurer, type NodeTextMeasurer } from "@sonobe/core/graph";

let measurer: NodeTextMeasurer | undefined;

const MAX_CACHED = 4000;

export function nodeTextMeasurer(): NodeTextMeasurer {
  if (measurer) return measurer;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  } catch {
    ctx = null;
  }
  if (!ctx || typeof ctx.measureText !== "function") return (measurer = tableMeasurer);
  const style = getComputedStyle(document.documentElement);
  const families = {
    sans: style.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif",
    mono: style.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
  };
  const widths = new Map<string, number>();
  const context = ctx;
  measurer = (text, font) => {
    const key = `${font}|${text}`;
    const known = widths.get(key);
    if (known !== undefined) return known;
    const f: { family: "sans" | "mono"; size: number; weight: number; italic?: boolean; letterSpacing?: number } = NODE_FONTS[font];
    context.font = `${f.italic ? "italic " : ""}${f.weight} ${f.size}px ${families[f.family]}`;
    context.letterSpacing = `${f.letterSpacing ?? 0}px`;
    const width = context.measureText(text).width;
    if (widths.size >= MAX_CACHED) widths.clear();
    widths.set(key, width);
    return width;
  };
  return measurer;
}
