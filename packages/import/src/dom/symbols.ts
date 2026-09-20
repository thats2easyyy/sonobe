/**
 * SF Symbol placeholders in the page: `<svg data-sf-symbol="heart.fill"></svg>`, sized, weighted and
 * colored by CSS like SwiftUI's .font(.system(size:weight:)) and .foregroundStyle. Runs inside the page,
 * bundled into SYMBOL_COLLECT_SOURCE and SYMBOL_APPLY_SOURCE (symbolSource.ts), before the DOM walker:
 * collectSymbols lists what to draw, the host draws it on the Mac, and applySymbols puts the drawings in
 * at the symbol's own size (unless the page sized the placeholder). Placeholders nothing drew become 1em
 * squares the walker shows as gray placeholders.
 *
 * - data-sf-palette="#0A84FF,#34C759": the palette rendering mode's colors (one per layer).
 * - data-sf-scale="small" | "medium" | "large": SwiftUI's imageScale.
 * - data-name or aria-label names the layer; without one the layer takes the symbol's name.
 */

import type { SymbolPaint, SymbolSlot, SymbolWeight } from "../symbols.ts";
import { createColorResolver, waitForPage, type WalkOptions } from "./walk.ts";

const SVG = "http://www.w3.org/2000/svg";

const WEIGHTS: SymbolWeight[] = ["ultralight", "thin", "light", "regular", "medium", "semibold", "bold", "heavy", "black"];

/** Placeholders to draw, once the page has settled the way the walker waits for it. Each gets a data-sf-slot. */
export async function collectSymbols(options: WalkOptions = {}): Promise<SymbolSlot[]> {
  await waitForPage(options);
  const scope = options.selector ? document.querySelector(options.selector) : document.documentElement;
  if (!scope) return [];
  const toColor = createColorResolver();
  const pending = "[data-sf-symbol]:not([data-sf-drawn])";
  const elements = [...(scope.matches(pending) ? [scope] : []), ...scope.querySelectorAll(pending)];
  const out: SymbolSlot[] = [];
  for (const el of elements) {
    const cs = getComputedStyle(el);
    if (cs.display === "none") continue;
    const size = Math.round((parseFloat(cs.fontSize) || 17) * 100) / 100;
    const weight = WEIGHTS[Math.min(8, Math.max(0, Math.round((Number(cs.fontWeight) || 400) / 100) - 1))]!;
    const scaleAttr = el.getAttribute("data-sf-scale")?.trim().toLowerCase();
    const scale = scaleAttr === "small" || scaleAttr === "large" ? scaleAttr : "medium";
    const own = toColor(cs.color) ?? "#00000000";
    const palette = (el.getAttribute("data-sf-palette") ?? "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, 3).map((c) => toColor(c) ?? own);
    const slot = out.length;
    el.setAttribute("data-sf-slot", String(slot));
    out.push({ slot, request: { name: el.getAttribute("data-sf-symbol")!.trim(), size, weight, scale, colors: palette.length ? palette : [own] } });
  }
  return out;
}

/** An <svg> for the placeholder: itself, or a copy of its attributes when it's another element (<i data-sf-symbol>). */
function svgFor(el: Element): SVGSVGElement {
  if (el.namespaceURI === SVG && el.localName === "svg") return el as SVGSVGElement;
  const svg = document.createElementNS(SVG, "svg");
  for (const attr of [...el.attributes]) svg.setAttribute(attr.name, attr.value);
  el.replaceWith(svg);
  return svg;
}

/** Ids made unique per slot, so two symbols' masks can't collide in the page. */
function adopt(markup: string, slot: number): { viewBox: string | null; nodes: Node[] } | null {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  if (parsed.localName !== "svg" || parsed.namespaceURI !== SVG) return null;
  const ids = new Map<string, string>();
  for (const el of parsed.querySelectorAll("[id]")) {
    const id = `sf${slot}-${el.id}`;
    ids.set(el.id, id);
    el.id = id;
  }
  if (ids.size) {
    for (const el of parsed.querySelectorAll("*")) {
      for (const attr of [...el.attributes]) {
        const value = attr.value.replace(/url\(#([^)]+)\)/g, (whole, id: string) => (ids.has(id) ? `url(#${ids.get(id)})` : whole)).replace(/^#(.+)$/, (whole, id: string) => (ids.has(id) ? `#${ids.get(id)}` : whole));
        if (value !== attr.value) el.setAttribute(attr.name, value);
      }
    }
  }
  return { viewBox: parsed.getAttribute("viewBox"), nodes: [...parsed.childNodes].map((n) => document.importNode(n, true)) };
}

/**
 * A bitmap drawing replaces its placeholder with an <img>, so it imports as a PNG asset: renderers
 * such as resvg don't draw a bitmap nested inside an SVG image.
 */
function imgFor(el: Element, paint: SymbolPaint): HTMLImageElement {
  const img = document.createElement("img");
  for (const attr of [...el.attributes]) if (attr.name !== "data-sf-slot") img.setAttribute(attr.name, attr.value);
  img.alt ||= el.getAttribute("data-sf-symbol") ?? "";
  if (!img.hasAttribute("width")) img.width = paint.width;
  if (!img.hasAttribute("height")) img.height = paint.height;
  img.src = `data:image/png;base64,${paint.png}`;
  img.setAttribute("data-sf-drawn", "");
  el.replaceWith(img);
  return img;
}

/** Put each drawing in its placeholder. Ones without a drawing become 1em squares marked data-sf-placeholder. */
export function applySymbols(paints: SymbolPaint[]): number {
  let drawn = 0;
  for (const paint of paints) {
    const found = document.querySelector(`[data-sf-slot="${paint.slot}"]`);
    if (!found) continue;
    if (paint.png && !paint.svg) {
      imgFor(found, paint);
      drawn++;
      continue;
    }
    const svg = svgFor(found);
    svg.removeAttribute("data-sf-slot");
    const w = String(paint.width);
    const h = String(paint.height);
    // A size the page gave the placeholder wins, like a CSS size does; the drawing scales to fit it.
    if (!svg.hasAttribute("width")) svg.setAttribute("width", w);
    if (!svg.hasAttribute("height")) svg.setAttribute("height", h);
    const adopted = paint.svg ? adopt(paint.svg, paint.slot) : null;
    if (adopted) {
      svg.setAttribute("viewBox", adopted.viewBox ?? `0 0 ${w} ${h}`);
      svg.replaceChildren(...adopted.nodes);
    } else {
      svg.replaceChildren();
      svg.setAttribute("data-sf-placeholder", "");
      continue;
    }
    svg.removeAttribute("data-sf-placeholder");
    svg.setAttribute("data-sf-drawn", "");
    drawn++;
  }
  return drawn;
}
