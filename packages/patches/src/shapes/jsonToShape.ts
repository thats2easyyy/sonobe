/** JSON to Shape: a path from moveTo, lineTo, curveTo, and closePath commands (Origami's format plus additions). */

import type { ShapeValue } from "@sonobe/core";
import { definePatch, equalValues, isPlainObject, sameComponents } from "../infra/index.ts";
import { formatPath, readPoint } from "./path.ts";
import type { Segment } from "./path.ts";
import { readPair } from "./read.ts";

/** Commands past this are dropped with an error. */
export const MAX_JSON_COMMANDS = 100_000;

export interface JsonShapeResult {
  shape: ShapeValue;
  error: boolean;
  errorMessage: string;
}

interface JsonToShapeState {
  cache: { json: unknown; space: number[]; result: JsonShapeResult } | null;
}

/** Build the outputs for a JSON value (or JSON text) and a Coordinate Space multiplier. */
export function buildJsonShape(json: unknown, space: readonly [number, number]): JsonShapeResult {
  const done = (segments: readonly Segment[], message: string | null): JsonShapeResult => ({
    shape: { path: formatPath(segments) },
    error: message !== null,
    errorMessage: message ?? "",
  });
  let data = json;
  if (data === null || data === undefined) return done([], null);
  if (typeof data === "string") {
    if (data.trim() === "") return done([], null);
    try {
      data = JSON.parse(data) as unknown;
    } catch (e) {
      return done([], `The JSON couldn't be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const commands = Array.isArray(data) ? data : isPlainObject(data) ? data.path : undefined;
  if (!Array.isArray(commands)) return done([], 'Expected an object with a "path" list of commands.');
  const [sx, sy] = space;
  const pt = (v: unknown): [number, number] | null => {
    const p = readPoint(v);
    if (!p) return null;
    const x = p[0] * sx;
    const y = p[1] * sy;
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  };
  const segments: Segment[] = [];
  let current: [number, number] | null = null;
  for (let i = 0; i < commands.length; i++) {
    if (i === MAX_JSON_COMMANDS) return done(segments, "Only the first 100,000 commands are drawn.");
    const item: unknown = commands[i];
    const c: Record<string, unknown> = isPlainObject(item) ? item : {};
    const type = typeof c.type === "string" ? c.type : "";
    const where = `Command ${i + 1}${type ? ` (${type})` : ""}: `;
    const kind = type.toLowerCase();
    if (kind !== "moveto" && current === null) {
      const known = kind === "lineto" || kind === "curveto" || kind === "closepath";
      return done(segments, where + (known ? "start the path with moveTo first." : "unknown type. Use moveTo, lineTo, curveTo, or closePath."));
    }
    if (kind === "moveto" || kind === "lineto") {
      const p = pt(c.point);
      if (!p) return done(segments, `${where}needs a "point" with numeric x and y.`);
      segments.push([kind === "moveto" ? "M" : "L", p[0], p[1]]);
      current = p;
    } else if (kind === "curveto") {
      // Origami's layout: the end is "curveTo", and the controls are "curveFrom" and "point".
      const origami = "curveTo" in c;
      const end = pt(origami ? c.curveTo : c.point);
      const c1 = pt(origami ? c.curveFrom : c.control1);
      const c2 = pt(origami ? c.point : c.control2);
      if (!end || !c1 || !c2) {
        return done(segments, where + (origami ? 'needs "curveFrom", "point", and "curveTo" points.' : 'needs "control1", "control2", and "point" points.'));
      }
      segments.push(["C", c1[0], c1[1], c2[0], c2[1], end[0], end[1]]);
      current = end;
    } else if (kind === "closepath") {
      segments.push(["Z"]);
    } else {
      return done(segments, `${where}unknown type. Use moveTo, lineTo, curveTo, or closePath.`);
    }
  }
  return done(segments, null);
}

export const jsonToShape = definePatch<JsonToShapeState>("jsonToShape", {
  state: () => ({ cache: null }),
  evaluate(ctx) {
    const json = ctx.input<unknown>("json");
    const space = readPair(ctx, "coordinateSpace");
    let cache = ctx.state.cache;
    // Rebuild only when an input changes; the cache never changes outputs.
    if (!cache || !sameComponents(cache.space, space) || !(cache.json === json || equalValues(cache.json, json))) {
      cache = { json, space, result: buildJsonShape(json, space) };
      ctx.state.cache = cache;
    }
    ctx.output("shape", cache.result.shape);
    ctx.output("error", cache.result.error);
    ctx.output("errorMessage", cache.result.errorMessage);
  },
});
