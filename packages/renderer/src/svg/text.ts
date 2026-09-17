/**
 * Text layout for static SVG: line breaking, line height and truncation. By default widths follow
 * the engine's approximate text metrics, which is what headless layout (MCP simulations) measured
 * the text boxes with, so wrapped lines fit the boxes they were laid out in. DOM-free.
 */

import { approximateGlyphWidth, DEFAULT_LINE_HEIGHT_FACTOR } from "@sonobe/engine";
import { applyTextTransform, graphemes, wrapParagraph } from "../textMeasurer.ts";

export interface SvgTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  /** Points; 0 uses the natural line height. */
  lineHeight: number;
  italic?: boolean;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
}

/** Width of one line of text in points. */
export type TextWidth = (text: string, style: SvgTextStyle) => number;

const EPS = 1e-6;

function glyphFn(style: SvgTextStyle): (ch: string) => number {
  const fontSize = style.fontSize > 0 ? style.fontSize : 17;
  const weight = Math.min(900, Math.max(100, Number.isFinite(style.fontWeight) ? style.fontWeight : 400));
  const scale = 1 + (weight - 400) * 0.00012;
  const spacing = Number.isFinite(style.letterSpacing) ? style.letterSpacing : 0;
  return (ch) => approximateGlyphWidth(ch, fontSize) * scale + spacing;
}

/** Width with the engine's approximate metrics. */
export const approximateTextWidth: TextWidth = (text, style) => {
  const glyph = glyphFn(style);
  let w = 0;
  for (const ch of text) w += glyph(ch);
  return w;
};

/** Line height in points: explicit when above 0, else the engine's natural factor. */
export function textLineHeight(style: SvgTextStyle): number {
  if (style.lineHeight > 0) return style.lineHeight;
  return (style.fontSize > 0 ? style.fontSize : 17) * DEFAULT_LINE_HEIGHT_FACTOR;
}

/** The engine approximate measurer's greedy word wrap, returning the lines. */
function approximateWrap(paragraph: string, style: SvgTextStyle, maxWidth: number | null): string[] {
  if (maxWidth === null) return [paragraph];
  const glyph = glyphFn(style);
  const spaceWidth = glyph(" ");
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;
  let hasContent = false;
  const push = () => {
    lines.push(line);
    line = "";
    lineWidth = 0;
    hasContent = false;
  };
  for (const word of paragraph.split(" ")) {
    let wordWidth = 0;
    for (const ch of word) wordWidth += glyph(ch);
    if (!hasContent) {
      if (wordWidth <= maxWidth + EPS) {
        hasContent = word.length > 0;
        line = hasContent ? word : "";
        lineWidth = hasContent ? wordWidth : 0;
        continue;
      }
    } else if (lineWidth + spaceWidth + wordWidth <= maxWidth + EPS) {
      line += ` ${word}`;
      lineWidth += spaceWidth + wordWidth;
      continue;
    } else {
      push();
      if (wordWidth <= maxWidth + EPS) {
        hasContent = word.length > 0;
        line = word;
        lineWidth = wordWidth;
        continue;
      }
    }
    for (const ch of word) {
      const w = glyph(ch);
      if (hasContent && lineWidth + w > maxWidth + EPS) push();
      line += ch;
      lineWidth += w;
      hasContent = true;
    }
  }
  if (hasContent || lines.length === 0) push();
  return lines;
}

/** Visual lines for text in a box `maxWidth` wide (null: no wrapping). Explicit newlines always break. */
export function wrapText(text: string, style: SvgTextStyle, maxWidth: number | null, width?: TextWidth): string[] {
  const lines: string[] = [];
  for (const paragraph of applyTextTransform(text, style.textTransform).split(/\r\n|\r|\n/)) {
    if (width) lines.push(...wrapParagraph(paragraph, maxWidth, (s) => width(s, style)).lines);
    else lines.push(...approximateWrap(paragraph, style, maxWidth));
  }
  return lines.map((l) => l.replace(/[ \t]+$/, ""));
}

/** Cut lines to `maxLines` (0: unlimited) with an end or middle ellipsis, or a plain clip. */
export function truncateLines(lines: readonly string[], maxLines: number, truncation: string, maxWidth: number | null, style: SvgTextStyle, width: TextWidth = approximateTextWidth): string[] {
  if (maxLines <= 0 || lines.length <= maxLines) return [...lines];
  const kept = lines.slice(0, maxLines);
  if (truncation === "clip") return kept;
  const fits = (s: string) => maxWidth === null || width(s, style) <= maxWidth + EPS;
  if (truncation === "middle") {
    const rest = graphemes(lines.slice(maxLines - 1).join(" "));
    let keep = rest.length;
    let candidate = rest.join("");
    while (keep > 0 && !fits(candidate)) {
      keep--;
      const head = rest.slice(0, Math.ceil(keep / 2)).join("").replace(/\s+$/, "");
      const tail = rest.slice(rest.length - Math.floor(keep / 2)).join("").replace(/^\s+/, "");
      candidate = `${head}…${tail}`;
    }
    kept[maxLines - 1] = keep > 0 ? candidate : "…";
    return kept;
  }
  const last = graphemes(kept[maxLines - 1]!);
  let candidate = `${last.join("").replace(/\s+$/, "")}…`;
  while (last.length && !fits(candidate)) {
    last.pop();
    candidate = `${last.join("").replace(/\s+$/, "")}…`;
  }
  kept[maxLines - 1] = candidate;
  return kept;
}
