/**
 * Gradient Builder: a linear, radial, or angular GradientValue from N stops (a Stop and a Color port
 * each). N is the node's inputCount within the catalog's `inputCountRange` (1…32, default 2); the
 * stop ports come from dynamic ports.
 */

import { getInputCountRange } from "@sonobe/core";
import type { Color, GradientStop, GradientValue, PatchNode, PortSpec } from "@sonobe/core";
import { clamp01, components, definePatch, toNumber, toText, warnOnce } from "../infra/index.ts";
import { getSpec } from "../specs.ts";
import { finiteOrZero, hexByte, readColor } from "./channels.ts";

const RANGE = getInputCountRange(getSpec("gradientBuilder")!) ?? { min: 1, max: 32, defaultCount: 2 };

export const MIN_GRADIENT_STOPS = RANGE.min;
export const MAX_GRADIENT_STOPS = RANGE.max;
export const DEFAULT_GRADIENT_STOPS = RANGE.defaultCount;

const KINDS: ReadonlySet<string> = new Set(["linear", "radial", "angular"]);

/** The Gradient output: a GradientValue, with `ratio` set only for a stretched radial gradient. */
export type BuiltGradient = GradientValue;

/** How many stops a node has: `inputCount` rounded and clamped to 1…32, or 2 when unset. */
export function gradientStopCount(node: Pick<PatchNode, "inputCount">): number {
  const n = node.inputCount;
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_GRADIENT_STOPS;
  return Math.min(MAX_GRADIENT_STOPS, Math.max(MIN_GRADIENT_STOPS, Math.round(n)));
}

/** Stop n's default position, evenly spaced from 0 to 1 (0 when there's one stop). */
const defaultOffset = (n: number, count: number) => (count === 1 ? 0 : (n - 1) / (count - 1));

/** The `stop{n}` and `color{n}` input ports for `count` stops, with evenly spaced positions and white-to-black grays. */
export function gradientStopPorts(count: number): PortSpec[] {
  const ports: PortSpec[] = [];
  for (let n = 1; n <= count; n++) {
    const t = defaultOffset(n, count);
    const gray = hexByte(1 - t);
    ports.push(
      {
        key: `stop${n}`,
        name: `Stop ${n}`,
        type: "number",
        subtype: "progress",
        default: t,
        min: 0,
        max: 1,
        step: 0.01,
        description: `Where Color ${n} sits along the gradient: 0 at Start, 1 at End.`,
      },
      { key: `color${n}`, name: `Color ${n}`, type: "color", default: `#${gray}${gray}${gray}FF`, description: `The color at Stop ${n}.` },
    );
  }
  return ports;
}

export const gradientBuilderPatch = definePatch("gradientBuilder", {
  dynamicPorts: (node) => ({ inputs: gradientStopPorts(gradientStopCount(node)), outputs: [] }),
  evaluate(ctx) {
    // ctx.inputCount is node.inputCount clamped to the catalog's inputCountRange.
    const count = gradientStopCount({ inputCount: ctx.inputCount });
    let kind = toText(ctx.input("type"));
    if (!KINDS.has(kind)) {
      warnOnce(ctx, "type", `Gradient Builder: "${kind}" isn't a gradient type, so it draws Linear.`);
      kind = "linear";
    }
    const point = (key: string, name: string): [number, number] => {
      const [x = 0, y = 0] = components(ctx.input(key), "anchor");
      const message = `Gradient Builder: ${name} has a component that isn't a finite number, so it counts as 0.`;
      return [finiteOrZero(ctx, x, key, message), finiteOrZero(ctx, y, key, message)];
    };
    const start = point("start", "Start");
    const end = point("end", "End");
    let ratio = ctx.input<number>("ratio");
    if (!(typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0)) {
      warnOnce(ctx, "ratio", "Gradient Builder: Ratio must be above 0, so it counts as 1.");
      ratio = 1;
    }
    const stops: GradientStop[] = [];
    for (let n = 1; n <= count; n++) {
      const rawOffset = ctx.input<unknown>(`stop${n}`);
      const offset = rawOffset === undefined ? defaultOffset(n, count) : typeof rawOffset === "number" ? rawOffset : toNumber(rawOffset, Number.NaN);
      const rawColor = ctx.input<unknown>(`color${n}`);
      const c: Color = rawColor === undefined ? { r: 1 - defaultOffset(n, count), g: 1 - defaultOffset(n, count), b: 1 - defaultOffset(n, count), a: 1 } : readColor(rawColor);
      stops.push({
        offset: finiteOrZero(ctx, offset, `stop${n}`, `Gradient Builder: Stop ${n} isn't a finite number, so it counts as 0.`),
        color: { r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), a: clamp01(c.a) },
      });
    }
    // Array.prototype.sort is stable, so equal offsets keep port order (a hard edge where the later stop wins).
    stops.sort((p, q) => p.offset - q.offset);
    const gradient: BuiltGradient = { kind: kind as GradientValue["kind"], stops, start, end };
    if (kind === "radial" && ratio !== 1) gradient.ratio = ratio;
    ctx.output("gradient", gradient);
  },
});
