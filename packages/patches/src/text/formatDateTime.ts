/** Format Date & Time: seconds as a clock time, a date, a media timestamp, or a custom % pattern. */

import type { PatchContext } from "@sonobe/engine";
import { definePatch, numberToText, toText } from "../infra/index.ts";
import { DATE_TIME_PRESETS, MAX_TIME_EXCLUSIVE, MIN_TIME, dateParts, isSupportedTimeZone, mediaTime, strftime } from "./strftime.ts";

/** Per loop index: whether a problem with Time was reported since restart. */
interface FormatDateTimeState {
  warned: boolean;
}

/**
 * The time zone "Device" resolves to: `services.device().timeZone` (the runtime reports "UTC" in
 * deterministic simulation unless the host set a zone), else UTC when `services.deterministic` so traces
 * reproduce everywhere, else the platform's zone. Zones Intl can't format fall back the same way.
 */
export function deviceTimeZone(ctx: Pick<PatchContext, "services">): string {
  const services = ctx.services;
  const zone = (services.device() as { timeZone?: unknown }).timeZone;
  if (typeof zone === "string" && isSupportedTimeZone(zone)) return zone;
  if (services.deterministic !== false) return "UTC";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const formatDateTimePatch = definePatch<FormatDateTimeState>("formatDateTime", {
  state: () => ({ warned: false }),
  evaluate(ctx) {
    const t = ctx.input<number>("time");
    if (ctx.muted) {
      ctx.output("text", numberToText(t));
      return;
    }
    const warn = (message: string) => {
      if (ctx.state.warned) return;
      ctx.state.warned = true;
      ctx.services.log("warn", message);
    };
    const format = toText(ctx.input("format"));
    if (format === "mediaTime" || format === "shortMediaTime") {
      if (!Number.isFinite(t)) warn("Format Date & Time: Time isn't a finite number, so it shows as 0.");
      ctx.output("text", mediaTime(Number.isFinite(t) ? t : 0, format === "mediaTime"));
      return;
    }
    if (!(t >= MIN_TIME && t < MAX_TIME_EXCLUSIVE)) {
      warn("Format Date & Time: Time is outside years 1 to 9999.");
      ctx.output("text", "");
      return;
    }
    const pattern = format === "custom" ? toText(ctx.input("customFormat")) : (DATE_TIME_PRESETS[format] ?? DATE_TIME_PRESETS.time12Hour!);
    if (pattern === "") {
      ctx.output("text", "");
      return;
    }
    const zone = toText(ctx.input("timeZone")) === "utc" ? "UTC" : deviceTimeZone(ctx);
    ctx.output("text", strftime(pattern, dateParts(Math.floor(t * 1000), zone)));
  },
  mutedBehavior: "evaluate",
});
