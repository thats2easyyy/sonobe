/** Watch: shows a value as text, counts its changes, and logs them at most 4 lines a second. */

import { formatColor, isColor } from "@sonobe/core";
import { definePatch, isPlainObject, roundDecimal } from "../infra/index.ts";

export interface WatchState {
  count: number;
  lastLogged: string | null;
  lastLogTime: number;
  /** This loop index has evaluated before (a held boolean that starts on doesn't count as turning on). */
  started: boolean;
}

/** Minimum seconds between console lines for one loop index. */
export const WATCH_LOG_INTERVAL = 0.25;

/** Absorbs float drift in accumulated time, so 15 frames at 60 fps count as 0.25 s. */
const TIME_EPSILON = 1e-9;
const TEXT_LIMIT = 60;

/** `text` cut to at most `max` characters, ending in "…" when cut. */
function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function trimFraction(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value === undefined ? null : value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * A number as Watch text: 3 decimals with trailing zeros trimmed, or 3 significant digits in
 * exponent form when |v| ≥ 1e9 or 0 < |v| < 0.001. Non-finite values and -0 read "0".
 */
export function formatWatchNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e9 || abs < 0.001) {
    const [mantissa = "0", exponent = "+0"] = value.toExponential(2).split("e");
    return `${trimFraction(mantissa)}e${exponent}`;
  }
  const text = trimFraction(roundDecimal(value, 3));
  return text === "-0" ? "0" : text;
}

/** A value of `type` as the Watch readout shows it. Never throws. */
export function formatWatchValue(value: unknown, type: string): string {
  switch (type) {
    case "number":
      return formatWatchNumber(value);
    case "index":
      return typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : "0";
    case "boolean":
      return value === true ? "true" : "false";
    case "enum":
      return typeof value === "string" ? value : cut(stringify(value), TEXT_LIMIT);
    case "text":
      return `"${cut(String(value ?? "").replace(/\r\n|\r|\n/g, "↵"), TEXT_LIMIT)}"`;
    case "color":
      return isColor(value) ? formatColor(value) : cut(stringify(value), TEXT_LIMIT);
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d":
      return Array.isArray(value) ? `[${value.map((n) => formatWatchNumber(n)).join(", ")}]` : cut(stringify(value), TEXT_LIMIT);
    case "json":
      return cut(stringify(value), TEXT_LIMIT);
    case "image":
    case "video":
    case "sound":
      if (isPlainObject(value)) {
        if (typeof value.assetId === "string") return `${type} ${value.assetId}`;
        if (typeof value.url === "string") return `${type} ${cut(value.url, 40)}`;
      }
      return `no ${type}`;
    case "gradient":
      if (isPlainObject(value) && Array.isArray(value.stops)) {
        const n = value.stops.length;
        return `${typeof value.kind === "string" ? value.kind : "linear"} gradient, ${n} ${n === 1 ? "stop" : "stops"}`;
      }
      return "no gradient";
    case "shape":
      return isPlainObject(value) && typeof value.path === "string" ? `shape "${cut(value.path, 30)}"` : "no shape";
    case "layerEffect":
      return isPlainObject(value) && typeof value.kind === "string" ? `${value.kind} effect` : "no effect";
    case "layer":
      if (isPlainObject(value) && typeof value.layerId === "string") {
        return `@${value.layerId}${typeof value.instance === "number" ? `#${value.instance}` : ""}`;
      }
      return "no layer";
    default:
      return cut(stringify(value), TEXT_LIMIT);
  }
}

export const watch = definePatch<WatchState>("watch", {
  // The default bypass would pass Label into Display; a muted Watch shows nothing and logs nothing.
  mutedBehavior: "zero",
  state: () => ({ count: 0, lastLogged: null, lastLogTime: -Infinity, started: false }),
  evaluate(ctx) {
    const state = ctx.state;
    const type = ctx.typeParam ?? "number";
    const text = formatWatchValue(ctx.input("value"), type);
    // Upstream pulses always count; a boolean state that's already on when this index starts doesn't.
    const turnedOn = type === "boolean" && ctx.pulsed("value") && (state.started || ctx.isPulseSource("value"));
    state.started = true;
    if (ctx.pulsed("reset")) state.count = 0;
    else if (type === "boolean" ? turnedOn : ctx.changed("value")) state.count += 1;

    const label = String(ctx.input("label") ?? "").trim();
    const suffix = type === "boolean" && state.count > 0 ? ` · on ${state.count}×` : "";
    ctx.output("display", (label ? `${label}: ` : "") + text + suffix);
    ctx.output("changeCount", state.count);

    if (ctx.input<boolean>("logChanges") && text !== state.lastLogged) {
      if (ctx.time - state.lastLogTime >= WATCH_LOG_INTERVAL - TIME_EPSILON) {
        const who = label || ctx.node.name || ctx.id;
        const item = ctx.loopCount > 1 ? ` #${ctx.loopIndex}` : "";
        ctx.services.log("log", `${who}${item}: ${text}`);
        state.lastLogged = text;
        state.lastLogTime = ctx.time;
      } else {
        ctx.requestNextFrame();
      }
    }
  },
});
