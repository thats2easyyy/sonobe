/** Input readers shared by the shape patches: finite numbers and vectors, warning once per restart. */

import type { ShapeValue } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { toNumber, warnOnce } from "../infra/index.ts";
import { getSpec } from "../specs.ts";

/** The parts of a PatchContext the readers use. */
export type ReadContext = Pick<PatchContext, "id" | "componentPath" | "frame" | "services" | "node" | "input">;

/** The empty shape: the Shape layer draws nothing for it. */
export function emptyShape(): ShapeValue {
  return { path: "" };
}

function warnNonFinite(ctx: ReadContext, key: string): void {
  const spec = getSpec(ctx.node.type);
  const patch = spec?.name ?? ctx.node.type;
  const port = spec?.inputs.find((p) => p.key === key)?.name ?? key;
  warnOnce(ctx, `nonFinite:${key}`, `${patch}: ${port} isn't a finite number; using 0.`);
}

/** A number input as a finite number: NaN and ±Infinity read as 0 with one warning per restart. */
export function readNumber(ctx: ReadContext, key: string): number {
  const v = ctx.input<unknown>(key);
  if (typeof v !== "number") return toNumber(v);
  if (Number.isFinite(v)) return v;
  warnNonFinite(ctx, key);
  return 0;
}

/** A vector input as `length` finite components: missing ones read 0, non-finite ones read 0 with a warning. */
export function readVector(ctx: ReadContext, key: string, length: number): number[] {
  const v = ctx.input<unknown>(key);
  const items: readonly unknown[] = Array.isArray(v) ? v : typeof v === "number" ? new Array<number>(length).fill(v) : [];
  const out = new Array<number>(length);
  let bad = false;
  for (let i = 0; i < length; i++) {
    const c = items[i];
    if (typeof c === "number" && Number.isFinite(c)) {
      out[i] = c;
    } else {
      out[i] = 0;
      if (typeof c === "number") bad = true;
    }
  }
  if (bad) warnNonFinite(ctx, key);
  return out;
}

/** {@link readVector} for points, sizes, and anchors. */
export function readPair(ctx: ReadContext, key: string): [number, number] {
  const [x, y] = readVector(ctx, key, 2);
  return [x!, y!];
}
