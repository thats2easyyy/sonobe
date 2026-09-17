/** Format Date & Time: seconds as a clock time, a date, a media timestamp, or a custom % pattern. */

import { DETERMINISTIC_EPOCH_MS } from "@sonobe/engine";
import type { PatchContext, RuntimePatchDefinition } from "@sonobe/engine";
import { definePatch, numberToText, toText } from "../infra/index.ts";
import { DATE_TIME_PRESETS, MAX_TIME_EXCLUSIVE, MIN_TIME, dateParts, isSupportedTimeZone, mediaTime, strftime } from "./strftime.ts";

/** Per loop index: whether a problem with Time was reported since restart. */
interface FormatDateTimeState {
  warned: boolean;
}

/** True when `services.now()` follows the deterministic simulation clock (epoch + prototype time). */
function usesSimulationClock(ctx: PatchContext): boolean {
  return Math.abs(ctx.services.now() - (DETERMINISTIC_EPOCH_MS + ctx.time * 1000)) < 1;
}

/**
 * The time zone "Device" resolves to: a host-provided `device().timeZone` (proposed contract field),
 * UTC in deterministic simulation so traces reproduce everywhere, else the platform's zone.
 */
export function deviceTimeZone(ctx: PatchContext): string {
  const fromHost = (ctx.services.device() as { timeZone?: unknown }).timeZone;
  if (typeof fromHost === "string" && isSupportedTimeZone(fromHost)) return fromHost;
  if (usesSimulationClock(ctx)) return "UTC";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const formatDateTimePatch: RuntimePatchDefinition<FormatDateTimeState> = {
  ...definePatch<FormatDateTimeState>("formatDateTime", {
    state: () => ({ warned: false }),
    evaluate(ctx) {
      const t = ctx.input<number>("time");
      if (ctx.node.muted) {
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
  }),
  mutedBehavior: "evaluate",
};
