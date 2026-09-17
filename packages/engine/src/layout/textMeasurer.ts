/**
 * Approximate headless text metrics. Deterministic and dependency-free, so layout works in
 * Node (tests, CLI, MCP simulation). The DOM renderer injects a canvas-backed measurer instead.
 */

import type { TextMeasurer } from "../types.ts";

/** Natural line height as a multiple of font size when `lineHeight` is 0. */
export const DEFAULT_LINE_HEIGHT_FACTOR = 1.2;

const NARROW = new Set("il.,:;'|!`ıìíîïĺļľłj");
const SEMI_NARROW = new Set('fjrtI()[]{}"-/\\*1 ');
const WIDE = new Set("mwMW@%æœÆŒ");

/** Approximate advance width of one character, in points, for a proportional UI font. */
export function approximateGlyphWidth(char: string, fontSize: number): number {
  const code = char.codePointAt(0) ?? 0;
  let em: number;
  if (char === " ") em = 0.27;
  else if (char === "\t") em = 1.08;
  else if (NARROW.has(char)) em = 0.26;
  else if (WIDE.has(char)) em = 0.84;
  else if (SEMI_NARROW.has(char)) em = 0.36;
  else if (code >= 0x30 && code <= 0x39) em = 0.58;
  else if (code >= 0x41 && code <= 0x5a) em = 0.66;
  else if (code >= 0x61 && code <= 0x7a) em = 0.52;
  else if (code < 0x80) em = 0.5;
  else if (isFullWidth(code)) em = 1.0;
  else if (code >= 0x1f000) em = 1.1;
  else em = 0.55;
  return em * fontSize;
}

function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

export interface ApproximateTextMeasurerOptions {
  /** Multiplies every glyph width (tune for wider or narrower fonts). Default 1. */
  widthScale?: number;
  /** Natural line height factor. Default 1.2. */
  lineHeightFactor?: number;
}

/**
 * Create an approximate measurer: per-glyph widths by character class, font weight widening,
 * letter spacing, greedy word wrapping at `maxWidth` (long words break by character), and
 * explicit newlines. Height is lines × line height (at least one line).
 */
export function createApproximateTextMeasurer(
  options: ApproximateTextMeasurerOptions = {},
): TextMeasurer {
  const widthScale = options.widthScale ?? 1;
  const lineHeightFactor = options.lineHeightFactor ?? DEFAULT_LINE_HEIGHT_FACTOR;
  return {
    measure(text, style, maxWidth) {
      const fontSize = style.fontSize > 0 ? style.fontSize : 17;
      const weight = Math.min(
        900,
        Math.max(100, Number.isFinite(style.fontWeight) ? style.fontWeight : 400),
      );
      const scale = widthScale * (1 + (weight - 400) * 0.00012);
      const spacing = Number.isFinite(style.letterSpacing) ? style.letterSpacing : 0;
      const lineHeight = style.lineHeight > 0 ? style.lineHeight : fontSize * lineHeightFactor;
      const glyph = (ch: string) => approximateGlyphWidth(ch, fontSize) * scale + spacing;
      const wrap = maxWidth !== null && Number.isFinite(maxWidth) ? Math.max(0, maxWidth) : null;

      let lines = 0;
      let widest = 0;
      for (const paragraph of String(text).split(/\r\n|\r|\n/)) {
        const result = layoutParagraph(paragraph, glyph, wrap);
        lines += result.lines;
        widest = Math.max(widest, result.width);
      }
      return { width: widest, height: Math.max(1, lines) * lineHeight };
    },
  };
}

function layoutParagraph(
  paragraph: string,
  glyph: (ch: string) => number,
  maxWidth: number | null,
): { lines: number; width: number } {
  const spaceWidth = glyph(" ");
  if (maxWidth === null) {
    let width = 0;
    for (const ch of paragraph) width += glyph(ch);
    return { lines: 1, width: trimTrailingSpaces(paragraph, width, spaceWidth) };
  }
  let lines = 0;
  let widest = 0;
  let lineWidth = 0;
  let lineHasContent = false;
  const pushLine = () => {
    widest = Math.max(widest, lineWidth);
    lines++;
    lineWidth = 0;
    lineHasContent = false;
  };
  const EPS = 1e-6;
  for (const word of paragraph.split(" ")) {
    let wordWidth = 0;
    for (const ch of word) wordWidth += glyph(ch);
    if (!lineHasContent) {
      if (wordWidth <= maxWidth + EPS) {
        lineWidth = wordWidth;
        lineHasContent = word.length > 0;
        if (!lineHasContent) lineWidth = 0;
        continue;
      }
    } else if (lineWidth + spaceWidth + wordWidth <= maxWidth + EPS) {
      lineWidth += spaceWidth + wordWidth;
      continue;
    } else {
      pushLine();
      if (wordWidth <= maxWidth + EPS) {
        lineWidth = wordWidth;
        lineHasContent = word.length > 0;
        continue;
      }
    }
    // The word is wider than a line: break it by character.
    for (const ch of word) {
      const w = glyph(ch);
      if (lineHasContent && lineWidth + w > maxWidth + EPS) pushLine();
      lineWidth += w;
      lineHasContent = true;
    }
  }
  if (lineHasContent || lines === 0) pushLine();
  return { lines, width: widest };
}

function trimTrailingSpaces(text: string, width: number, spaceWidth: number): number {
  let w = width;
  for (let i = text.length - 1; i >= 0 && text[i] === " "; i--) w -= spaceWidth;
  return Math.max(0, w);
}

/** Shared default approximate measurer. */
export const approximateTextMeasurer: TextMeasurer = createApproximateTextMeasurer();
