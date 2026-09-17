/** Loop Dedupe: each distinct value once, first occurrence kept. */

import { isColor } from "@sonobe/core";
import { definePatch, isPlainObject, loopOf } from "../infra/index.ts";
import { indices, passThroughWhenMuted } from "./shared.ts";

const MAX_JSON_DEPTH = 64;

function numberKey(n: number): string | undefined {
  return Number.isNaN(n) ? undefined : String(n === 0 ? 0 : n);
}

function jsonKey(value: unknown, depth: number): string | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  switch (typeof value) {
    case "number": {
      const key = numberKey(value);
      return key === undefined ? undefined : `n${key}`;
    }
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const key = jsonKey(item, depth + 1);
      if (key === undefined) return undefined;
      parts.push(key);
    }
    return `[${parts.join(",")}]`;
  }
  if (isPlainObject(value)) {
    const parts: string[] = [];
    for (const k of Object.keys(value).sort()) {
      const key = jsonKey(value[k], depth + 1);
      if (key === undefined) return undefined;
      parts.push(`${JSON.stringify(k)}:${key}`);
    }
    return `{${parts.join(",")}}`;
  }
  return undefined;
}

/**
 * A canonical key such that two items have equal keys exactly when Option Equals' `same` holds for
 * `variant`; undefined when the item can't equal anything (NaN components).
 */
export function dedupeKey(item: unknown, variant: string): string | undefined {
  switch (variant) {
    case "number":
    case "index":
      if (typeof item === "number") return numberKey(item);
      break;
    case "boolean":
    case "text":
    case "enum":
      if (typeof item === "boolean" || typeof item === "string") return `${typeof item}:${String(item)}`;
      break;
    case "color":
      if (isColor(item)) {
        const channels = [item.r, item.g, item.b, item.a].map((c) => Math.round(c * 255));
        return channels.some(Number.isNaN) ? undefined : channels.join(",");
      }
      break;
    case "point":
    case "point3d":
    case "point4d":
    case "size":
    case "anchor":
      if (Array.isArray(item) && item.every((c) => typeof c === "number")) {
        const parts: string[] = [];
        for (const c of item as number[]) {
          const key = numberKey(c);
          if (key === undefined) return undefined;
          parts.push(key);
        }
        return parts.join(",");
      }
      break;
  }
  return jsonKey(item, 0);
}

/** Items with duplicates removed, keeping first occurrences in order. */
export function dedupe(items: readonly unknown[], variant: string): unknown[] {
  const seen = new Set<string>();
  const unique: unknown[] = [];
  for (const item of items) {
    const key = dedupeKey(item, variant);
    if (key !== undefined) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    unique.push(item);
  }
  return unique;
}

export const loopDedupePatch = definePatch("loopDedupe", {
  evaluate(ctx) {
    if (passThroughWhenMuted(ctx, "index")) return;
    const unique = dedupe(ctx.inputItems("loop"), ctx.typeParam ?? "number");
    ctx.output("output", loopOf(unique));
    ctx.output("index", loopOf(indices(unique.length)));
  },
  mutedBehavior: "evaluate",
});
