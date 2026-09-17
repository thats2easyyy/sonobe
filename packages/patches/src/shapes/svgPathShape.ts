/** SVG Path Shape: SVG path data (or pasted `<svg>` markup) fitted into a size without stretching. */

import type { ShapeValue } from "@sonobe/core";
import type { RuntimePatchDefinition } from "@sonobe/engine";
import { definePatch, sameComponents, toText } from "../infra/index.ts";
import { formatPath, parsePath, readSvgMarkup, transformSegments } from "./path.ts";
import type { Segment } from "./path.ts";
import { readPair, readVector } from "./read.ts";

/** Longest path text read. */
export const MAX_PATH_TEXT = 1_000_000;

export interface SvgShapeResult {
  shape: ShapeValue;
  error: boolean;
  errorMessage: string;
}

interface SvgPathState {
  cache: { text: string; viewBox: number[]; size: number[]; result: SvgShapeResult } | null;
}

/** Build the outputs for path text, a viewBox `[x, y, width, height]`, and a non-negative size. */
export function buildSvgShape(pathData: string, viewBoxInput: readonly number[], size: readonly [number, number]): SvgShapeResult {
  const done = (segments: readonly Segment[], problems: readonly string[]): SvgShapeResult => ({
    shape: { path: formatPath(segments) },
    error: problems.length > 0,
    errorMessage: problems.join(" "),
  });
  if (pathData.length > MAX_PATH_TEXT) return done([], ["Path data is longer than 1,000,000 characters."]);
  let text = pathData;
  let viewBox = viewBoxInput;
  const problems: string[] = [];
  if (text.trimStart().startsWith("<")) {
    const svg = readSvgMarkup(text);
    text = svg.paths.join(" ");
    if (!(viewBox[2]! > 0 && viewBox[3]! > 0) && svg.viewBox) viewBox = svg.viewBox;
    problems.push(...svg.problems);
  }
  const parsed = text.trim() === "" ? { segments: [], syntaxError: null } : parsePath(text);
  if (parsed.syntaxError) problems.unshift(parsed.syntaxError);
  const [vx, vy, vw, vh] = viewBox as [number, number, number, number];
  const [w, h] = size;
  if (vw > 0 && vh > 0) {
    if (w === 0 || h === 0) return done([], problems);
    const s = Math.min(w / vw, h / vh);
    const tx = (w - vw * s) / 2 - vx * s;
    const ty = (h - vh * s) / 2 - vy * s;
    return done(transformSegments(parsed.segments, s, tx, ty), problems);
  }
  return done(parsed.segments, problems);
}

const definition = definePatch<SvgPathState>("svgPathShape", {
  state: () => ({ cache: null }),
  evaluate(ctx) {
    const text = toText(ctx.input<unknown>("pathData"));
    const viewBox = readVector(ctx, "viewBox", 4);
    const [sw, sh] = readPair(ctx, "size");
    const size: [number, number] = [Math.max(0, sw), Math.max(0, sh)];
    let cache = ctx.state.cache;
    // Reparse only when an input changes; the cache never changes outputs.
    if (!cache || cache.text !== text || !sameComponents(cache.viewBox, viewBox) || !sameComponents(cache.size, size)) {
      cache = { text, viewBox, size, result: buildSvgShape(text, viewBox, size) };
      ctx.state.cache = cache;
    }
    ctx.output("shape", cache.result.shape);
    ctx.output("error", cache.result.error);
    ctx.output("errorMessage", cache.result.errorMessage);
  },
});

/** Muted: Shape null, Error false, Error Message "" (the default bypass would copy Path Data into Error Message). */
export const svgPathShape: RuntimePatchDefinition<SvgPathState> = { ...definition, mutedBehavior: "zero" };
