/** Value at Path: reads nested JSON with dot paths, `*` wildcards, and a leading `..` search. */

import { definePatch, isPlainObject, toText, zeroValue } from "../infra/index.ts";
import { readAs, variantOf, warnIndexed } from "./shared.ts";

/** Deepest nesting a path walk or search follows. */
export const MAX_PATH_DEPTH = 256;

export interface PathResult {
  ok: boolean;
  value?: unknown;
}

const NOT_FOUND: PathResult = { ok: false };
const DIGITS = /^\d+$/;

function walk(node: unknown, steps: readonly string[], index: number, depth: number, tooDeep: () => void): PathResult {
  if (depth > MAX_PATH_DEPTH) {
    tooDeep();
    return NOT_FOUND;
  }
  if (index >= steps.length) return { ok: true, value: node };
  const step = steps[index]!;
  if (step === "*") {
    const children = Array.isArray(node) ? node : isPlainObject(node) ? Object.values(node) : null;
    if (!children) return NOT_FOUND;
    const flatten = steps.indexOf("*", index + 1) >= 0;
    const out: unknown[] = [];
    for (const child of children) {
      const r = walk(child, steps, index + 1, depth + 1, tooDeep);
      if (!r.ok) continue;
      if (flatten && Array.isArray(r.value)) for (const item of r.value) out.push(item);
      else out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (Array.isArray(node)) {
    if (!DIGITS.test(step)) return NOT_FOUND;
    const i = Number(step);
    return i < node.length ? walk(node[i], steps, index + 1, depth + 1, tooDeep) : NOT_FOUND;
  }
  if (isPlainObject(node) && Object.hasOwn(node, step)) return walk(node[step], steps, index + 1, depth + 1, tooDeep);
  return NOT_FOUND;
}

/**
 * Resolve `path` against `object` (see the catalog behavior): "" is the whole object, steps are
 * keys or array positions, `*` visits every child, and a leading `..` searches every depth.
 */
export function resolvePath(object: unknown, path: string, tooDeep: () => void = () => {}): PathResult {
  if (path === "") return { ok: true, value: object };
  const recursive = path.startsWith("..");
  const steps = (recursive ? path.slice(2) : path).split(".");
  if (steps.some((s) => s === "")) return NOT_FOUND;
  if (!recursive) return walk(object, steps, 0, 0, tooDeep);

  const first = steps[0]!;
  const collected: unknown[] = [];
  const search = (node: unknown, depth: number): void => {
    if (depth > MAX_PATH_DEPTH) {
      tooDeep();
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) search(child, depth + 1);
      return;
    }
    if (!isPlainObject(node)) return;
    if (Object.hasOwn(node, first)) {
      const r = walk(node[first], steps, 1, depth + 1, tooDeep);
      if (r.ok) collected.push(r.value);
    }
    for (const key of Object.keys(node)) search(node[key], depth + 1);
  };
  search(object, 0);
  return { ok: true, value: collected };
}

export const valueAtPath = definePatch("valueAtPath", {
  evaluate(ctx) {
    const r = resolvePath(ctx.input("object"), toText(ctx.input("path")), () =>
      warnIndexed(ctx, "depth", `Value at Path stops at ${MAX_PATH_DEPTH} levels of nesting.`),
    );
    const variant = variantOf(ctx, valueAtPath);
    ctx.output("value", r.ok ? readAs(r.value, variant) : zeroValue(variant));
    ctx.output("found", r.ok);
  },
});
