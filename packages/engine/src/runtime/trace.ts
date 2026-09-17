/** Trace summaries: range, endpoints, settle time and overshoot of a sampled value. */

import type { Value } from "@sonobe/core";
import type { TraceSummary } from "../types.ts";

/** Seconds a value must stay settled at the end of a trace before settleTime is reported. */
export const SETTLE_CONFIRM_SECONDS = 0.05;

function numericSeries(values: readonly Value[]): number[] | null {
  if (!values.length) return null;
  const first = values[0];
  if (typeof first === "number" || typeof first === "boolean") {
    const out: number[] = [];
    for (const v of values) {
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
      else if (typeof v === "boolean") out.push(v ? 1 : 0);
      else return null;
    }
    return out;
  }
  if (Array.isArray(first) && first.length > 0 && first.every((n) => typeof n === "number")) {
    const size = first.length;
    let best = -1;
    let bestRange = -1;
    for (let c = 0; c < size; c++) {
      let min = Infinity;
      let max = -Infinity;
      for (const v of values) {
        const n = Array.isArray(v) ? v[c] : undefined;
        if (typeof n !== "number" || !Number.isFinite(n)) return null;
        if (n < min) min = n;
        if (n > max) max = n;
      }
      if (max - min > bestRange) {
        bestRange = max - min;
        best = c;
      }
    }
    return values.map((v) => (v as number[])[best]!);
  }
  return null;
}

/**
 * Summarize one traced series. Numbers and booleans (0/1) summarize directly; vectors use the
 * component that moves the most. Other values (text, colors, loops, missing) give null.
 * `settleTime` is the first sample time after which the value stays within 0.1% of its final
 * value (of the final value's magnitude or the series range, whichever is larger), or null when
 * the value was still moving within the last 50 ms.
 */
export function summarizeSeries(times: readonly number[], values: readonly Value[]): TraceSummary | null {
  const series = numericSeries(values);
  if (!series || series.length !== times.length || !series.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const n of series) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const start = series[0]!;
  const end = series[series.length - 1]!;
  const range = max - min;
  let settleTime: number | null = 0;
  if (range > 0) {
    const tolerance = 0.001 * Math.max(Math.abs(end), range);
    let i = series.length - 1;
    while (i > 0 && Math.abs(series[i - 1]! - end) <= tolerance) i--;
    settleTime = times[times.length - 1]! - times[i]! >= SETTLE_CONFIRM_SECONDS - 1e-9 ? times[i]! : null;
  }
  let overshoot: number;
  if (end > start) overshoot = max - end;
  else if (end < start) overshoot = end - min;
  else overshoot = Math.max(max - end, end - min);
  return { min, max, start, end, settleTime, overshoot: Math.max(0, overshoot) };
}
