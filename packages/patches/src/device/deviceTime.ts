/**
 * Device Time: the device clock as whole Unix seconds, the millisecond part, and seconds since
 * midnight in the device's time zone (UTC in deterministic simulation, so traces match on every
 * machine). Holds while disabled.
 */

import { definePatch, toBool, warnOnce } from "../infra/index.ts";

interface TimeState {
  seconds: number;
  milliseconds: number;
  timeOfDay: number;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat | null>();

/** Hours, minutes, and seconds of `date` on the wall clock of `timeZone`, or undefined for an unknown zone. */
function zonedClock(date: Date, timeZone: string): [number, number, number] | undefined {
  let format = zoneFormats.get(timeZone);
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" });
    } catch {
      format = null;
    }
    zoneFormats.set(timeZone, format);
  }
  if (!format) return undefined;
  const parts = format.formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const clock: [number, number, number] = [read("hour"), read("minute"), read("second")];
  return clock.every(Number.isFinite) ? clock : undefined;
}

/**
 * Split epoch milliseconds into whole seconds, the 0–999 millisecond part, and seconds since
 * midnight: in UTC when `utc` is true, else in `timeZone` (an IANA zone such as "Europe/Paris"),
 * else in the host's local time zone.
 */
export function splitClock(epochMs: number, utc: boolean, timeZone?: string): TimeState {
  const now = Math.floor(epochMs);
  const seconds = Math.floor(now / 1000);
  const milliseconds = now - seconds * 1000;
  const d = new Date(now);
  const zoned = !utc && typeof timeZone === "string" && timeZone !== "" ? zonedClock(d, timeZone) : undefined;
  const [h, m, s] = utc ? [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()] : (zoned ?? [d.getHours(), d.getMinutes(), d.getSeconds()]);
  return { seconds, milliseconds, timeOfDay: h * 3600 + m * 60 + s + milliseconds / 1000 };
}

export const deviceTimePatch = definePatch<TimeState>("deviceTime", {
  state: () => ({ seconds: 0, milliseconds: 0, timeOfDay: 0 }),
  evaluate(ctx) {
    const s = ctx.state;
    if (toBool(ctx.input("enabled"))) {
      const now = ctx.services.now();
      if (typeof now === "number" && Number.isFinite(now)) {
        const deterministic = ctx.services.deterministic === true;
        Object.assign(s, splitClock(now, deterministic, deterministic ? undefined : ctx.services.device().timeZone));
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
