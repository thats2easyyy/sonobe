/**
 * DomTextMeasurer: the engine's TextMeasurer for browsers. Widths come from canvas
 * `measureText` (same shaper as DOM text), wrapping mirrors the renderer's CSS
 * (`white-space: pre-wrap; overflow-wrap: break-word`), and natural line height is
 * resolved per font so the renderer can write the exact same line height in px.
 */

import type { TextMeasurer } from "@sonobe/engine";

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  /** Line height in points; 0 uses the font's natural line height. */
  lineHeight: number;
  italic?: boolean;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
}

export interface TextLayout {
  /** Visual lines (explicit newlines and wraps), trailing spaces kept. */
  lines: string[];
  /** Width of each line excluding trailing (hanging) spaces. */
  lineWidths: number[];
  /** Widest line, rounded up to a whole point so the DOM box never re-wraps it. */
  width: number;
  height: number;
  lineHeight: number;
}

export interface DomTextMeasurerOptions {
  /** Override width measurement (tests, custom shaping). `font` is a CSS font shorthand. */
  measureWidth?: (text: string, font: string, fontSize: number) => number;
  /** Override natural line height lookup. */
  measureLineHeight?: (font: string, fontSize: number) => number;
  /** Document used for the fallback canvas and font-load invalidation. */
  document?: Document;
  /** Max cached width entries before the cache resets. Default 20000. */
  cacheSize?: number;
}

const FALLBACK_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif",
  "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong",
]);

/** CSS font-family stack for a family name, with system fallbacks. Stacks pass through. */
export function fontStack(family: string): string {
  const fam = family.trim();
  if (fam === "") return FALLBACK_STACK;
  if (fam.includes(",")) return fam;
  const name = GENERIC_FAMILIES.has(fam.toLowerCase()) ? fam : `"${fam.replace(/["\\]/g, "")}"`;
  return `${name}, ${FALLBACK_STACK}`;
}

export function clampWeight(weight: number): number {
  return Math.max(1, Math.min(1000, Math.round(Number.isFinite(weight) ? weight : 400)));
}

/** CSS font shorthand used by both canvas measurement and (via longhands) DOM text. */
export function cssFont(style: TextStyle): string {
  const size = Math.max(0, style.fontSize);
  return `${style.italic ? "italic " : ""}${clampWeight(style.fontWeight)} ${size}px ${fontStack(style.fontFamily)}`;
}

export function applyTextTransform(text: string, transform: TextStyle["textTransform"]): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "capitalize":
      return text.replace(/(^|[\s\-(["'“‘])(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
    default:
      return text;
  }
}

const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

export function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

const isSpace = (g: string) => g === " " || g === "\t";
const CJK = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u{20000}-\u{2FA1F}]/u;
const NO_BREAK_BEFORE = /^[、。，．：；！？）」』】〉》”’.,;:!?)\]}%]$/;
const NO_BREAK_AFTER = /^[「『【〈《“‘(\[{]$/;
const WORDLIKE = /[\p{L}\p{N}]/u;

/** Splits a paragraph into unbreakable chunks; a line may break after any chunk. */
export function breakChunks(paragraph: string): string[] {
  const gs = graphemes(paragraph);
  const chunks: string[] = [];
  let cur = "";
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i]!;
    const next = gs[i + 1];
    const last = cur[cur.length - 1];
    if (CJK.test(g) && last !== undefined && !isSpace(last) && !NO_BREAK_BEFORE.test(g) && !NO_BREAK_AFTER.test(last)) {
      chunks.push(cur);
      cur = "";
    }
    cur += g;
    if (next === undefined) break;
    if (isSpace(g) && !isSpace(next)) {
      chunks.push(cur);
      cur = "";
    } else if (g === "-" && cur.length > 1 && WORDLIKE.test(next)) {
      chunks.push(cur);
      cur = "";
    } else if (CJK.test(g) && !isSpace(next) && !NO_BREAK_BEFORE.test(next) && !NO_BREAK_AFTER.test(g)) {
      chunks.push(cur);
      cur = "";
    }
  }
  if (cur !== "") chunks.push(cur);
  return chunks;
}

const trimHanging = (s: string) => s.replace(/[ \t]+$/, "");
const EPSILON = 0.005;

/** Greedy line breaking over chunks (hanging trailing spaces, break-word for long words). */
export function wrapParagraph(paragraph: string, maxWidth: number | null, width: (s: string) => number): { lines: string[]; widths: number[] } {
  if (maxWidth === null) return { lines: [paragraph], widths: [width(trimHanging(paragraph))] };
  const limit = Math.max(0, maxWidth) + EPSILON;
  const lines: string[] = [];
  const widths: number[] = [];
  let line = "";
  let acc = 0; // full width of `line` including trailing spaces
  let lineW = 0; // width of `line` without trailing spaces
  const push = () => {
    lines.push(line);
    widths.push(lineW);
    line = "";
    acc = 0;
    lineW = 0;
  };
  for (const chunk of breakChunks(paragraph)) {
    const tw = width(trimHanging(chunk));
    if (line !== "" && acc + tw <= limit) {
      line += chunk;
      lineW = acc + tw;
      acc += width(chunk);
      continue;
    }
    if (line !== "") push();
    if (tw <= limit) {
      line = chunk;
      lineW = tw;
      acc = width(chunk);
      continue;
    }
    for (const g of graphemes(chunk)) {
      if (line !== "" && !isSpace(g) && width(trimHanging(line + g)) > limit) push();
      line += g;
      lineW = width(trimHanging(line));
      acc = width(line);
    }
  }
  if (line !== "" || lines.length === 0) push();
  return { lines, widths };
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class DomTextMeasurer implements TextMeasurer {
  private readonly options: DomTextMeasurerOptions;
  private readonly widthCache = new Map<string, number>();
  private readonly lineHeightCache = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private ctx: Canvas2D | null | undefined;
  private currentFont = "";
  private readonly fonts: FontFaceSet | null;
  private readonly onFontsLoaded = () => {
    this.clearCache();
    for (const cb of this.listeners) cb();
  };

  constructor(options: DomTextMeasurerOptions = {}) {
    this.options = options;
    const doc = options.document ?? (typeof document !== "undefined" ? document : undefined);
    this.fonts = (doc as (Document & { fonts?: FontFaceSet }) | undefined)?.fonts ?? null;
    this.fonts?.addEventListener?.("loadingdone", this.onFontsLoaded);
  }

  /** Engine TextMeasurer entry point. Extra style fields (italic, textTransform) are honoured when present. */
  measure(text: string, style: TextStyle, maxWidth: number | null): { width: number; height: number } {
    const l = this.layout(text, style, maxWidth);
    return { width: l.width, height: l.height };
  }

  layout(text: string, style: TextStyle, maxWidth: number | null): TextLayout {
    const font = cssFont(style);
    const ls = Number.isFinite(style.letterSpacing) ? style.letterSpacing : 0;
    const lineHeight = this.lineHeightFor(style);
    const w = (s: string) => this.width(s, font, style.fontSize, ls);
    const lines: string[] = [];
    const lineWidths: number[] = [];
    for (const paragraph of applyTextTransform(text, style.textTransform).split(/\r\n|\n|\r/)) {
      const r = wrapParagraph(paragraph, maxWidth, w);
      lines.push(...r.lines);
      lineWidths.push(...r.widths);
    }
    const widest = lineWidths.reduce((m, v) => Math.max(m, v), 0);
    return { lines, lineWidths, width: Math.ceil(widest - EPSILON), height: lines.length * lineHeight, lineHeight };
  }

  /** Line height in points: explicit when > 0, otherwise the font's natural ascent + descent. */
  lineHeightFor(style: TextStyle): number {
    if (style.lineHeight > 0) return style.lineHeight;
    const font = cssFont(style);
    let lh = this.lineHeightCache.get(font);
    if (lh === undefined) {
      lh = this.naturalLineHeight(font, style.fontSize);
      this.lineHeightCache.set(font, lh);
    }
    return lh;
  }

  /** Width of a single line of text (no wrapping), including letter spacing. */
  textWidth(text: string, style: TextStyle): number {
    return this.width(applyTextTransform(text, style.textTransform), cssFont(style), style.fontSize, style.letterSpacing || 0);
  }

  /** Shortens text with a middle ellipsis until it fits on one line of `maxWidth`. */
  truncateMiddle(text: string, style: TextStyle, maxWidth: number): string {
    const t = applyTextTransform(text, style.textTransform);
    const font = cssFont(style);
    const ls = style.letterSpacing || 0;
    const w = (s: string) => this.width(s, font, style.fontSize, ls);
    if (w(t) <= maxWidth + EPSILON) return t;
    const gs = graphemes(t);
    let lo = 0;
    let hi = gs.length;
    let best = "…";
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const head = gs.slice(0, Math.ceil(mid / 2)).join("").replace(/\s+$/, "");
      const tail = gs.slice(gs.length - Math.floor(mid / 2)).join("").replace(/^\s+/, "");
      const candidate = `${head}…${tail}`;
      if (w(candidate) <= maxWidth + EPSILON) {
        best = candidate;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /**
   * Text for `maxLines` with middle truncation: the first lines as wrapped, then the rest
   * of the text squeezed onto the last line with a middle ellipsis. Newlines are explicit.
   */
  truncateMiddleLines(text: string, style: TextStyle, maxWidth: number, maxLines: number): string {
    const transformed = applyTextTransform(text, style.textTransform);
    const layout = this.layout(transformed, { ...style, textTransform: "none" }, maxWidth);
    if (maxLines <= 0 || layout.lines.length <= maxLines) return transformed;
    // Lines are consecutive substrings of the text; find where the last visible line starts.
    let offset = 0;
    for (let i = 0; i < maxLines - 1; i++) {
      offset += layout.lines[i]!.length;
      if (transformed.startsWith("\r\n", offset)) offset += 2;
      else if (transformed[offset] === "\n" || transformed[offset] === "\r") offset += 1;
    }
    const kept = layout.lines.slice(0, maxLines - 1).map(trimHanging);
    const rest = transformed.slice(offset).replace(/\r\n|\n|\r/g, " ").trim();
    kept.push(this.truncateMiddle(rest, { ...style, textTransform: "none" }, maxWidth));
    return kept.join("\n");
  }

  /** Subscribe to cache invalidation (web fonts finished loading). Returns an unsubscribe function. */
  onInvalidate(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  clearCache(): void {
    this.widthCache.clear();
    this.lineHeightCache.clear();
  }

  dispose(): void {
    this.fonts?.removeEventListener?.("loadingdone", this.onFontsLoaded);
    this.listeners.clear();
    this.clearCache();
  }

  private width(text: string, font: string, fontSize: number, letterSpacing: number): number {
    if (text === "") return 0;
    const key = `${font}\u0001${text}`;
    let raw = this.widthCache.get(key);
    if (raw === undefined) {
      raw = this.rawWidth(text, font, fontSize);
      if (this.widthCache.size >= (this.options.cacheSize ?? 20000)) this.widthCache.clear();
      this.widthCache.set(key, raw);
    }
    return letterSpacing ? raw + letterSpacing * graphemes(text).length : raw;
  }

  private rawWidth(text: string, font: string, fontSize: number): number {
    if (this.options.measureWidth) return this.options.measureWidth(text, font, fontSize);
    const ctx = this.context();
    if (ctx) {
      if (this.currentFont !== font) {
        ctx.font = font;
        this.currentFont = font;
      }
      return ctx.measureText(text).width;
    }
    return approximateWidth(text, fontSize);
  }

  private naturalLineHeight(font: string, fontSize: number): number {
    if (this.options.measureLineHeight) return this.options.measureLineHeight(font, fontSize);
    const ctx = this.context();
    if (ctx) {
      if (this.currentFont !== font) {
        ctx.font = font;
        this.currentFont = font;
      }
      const m = ctx.measureText("Hg");
      const sum = (m.fontBoundingBoxAscent ?? NaN) + (m.fontBoundingBoxDescent ?? NaN);
      if (Number.isFinite(sum) && sum > 0) return Math.round(sum * 100) / 100;
    }
    return Math.round(fontSize * 1.2 * 100) / 100;
  }

  private context(): Canvas2D | null {
    if (this.ctx !== undefined) return this.ctx;
    this.ctx = null;
    try {
      if (typeof OffscreenCanvas === "function") this.ctx = new OffscreenCanvas(1, 1).getContext("2d");
      if (!this.ctx) {
        const doc = this.options.document ?? (typeof document !== "undefined" ? document : undefined);
        this.ctx = doc?.createElement("canvas").getContext("2d") ?? null;
      }
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }
}

/** Metric approximation used when no canvas is available (headless DOM shims). */
export function approximateWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const g of graphemes(text)) {
    if (isSpace(g)) em += 0.28;
    else if (CJK.test(g)) em += 1;
    else if (/[il.,:;'|!]/.test(g)) em += 0.28;
    else if (/[A-Z]/.test(g)) em += 0.66;
    else if (/[mwMW]/.test(g)) em += 0.82;
    else em += 0.55;
  }
  return em * fontSize;
}
