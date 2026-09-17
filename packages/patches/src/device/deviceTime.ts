/**
 * Device Time: the device clock as whole Unix seconds, the millisecond part, and seconds since
 * local midnight (UTC in simulation, so traces match on every machine). Holds while disabled.
 */

import { definePatch, toBool, warnOnce } from "../infra/index.ts";
import { isSimulationClock } from "./shared.ts";

interface TimeState {
  seconds: number;
  milliseconds: number;
  timeOfDay: number;
}

/** Split epoch milliseconds into whole seconds, the 0–999 millisecond part, and seconds since midnight. */
export function splitClock(epochMs: number, utc: boolean): TimeState {
  const now = Math.floor(epochMs);
  const seconds = Math.floor(now / 1000);
  const milliseconds = now - seconds * 1000;
  const d = new Date(now);
  const timeOfDay = utc
    ? d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000
    : d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  return { seconds, milliseconds, timeOfDay };
}

export const deviceTimePatch = definePatch<TimeState>("deviceTime", {
  state: () => ({ seconds: 0, milliseconds: 0, timeOfDay: 0 }),
  evaluate(ctx) {
    const s = ctx.state;
    if (toBool(ctx.input("enabled"))) {
      const now = ctx.services.now();
      if (typeof now === "number" && Number.isFinite(now)) {
        Object.assign(s, splitClock(now, isSimulationClock(ctx)));
      } else {
        warnOnce(ctx, "nonFinite", "Device Time: the device clock isn't a finite number, so the outputs hold their last values.");
      }
      ctx.requestNextFrame();
    }
    ctx.output("seconds", s.seconds);
    ctx.output("milliseconds", s.milliseconds);
    ctx.output("timeOfDay", s.timeOfDay);
  },
});
