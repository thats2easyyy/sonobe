import type { RuntimeServices } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { formatDateTimePatch } from "./formatDateTime.ts";
import { dateParts, strftime } from "./strftime.ts";

const T = 1773513005;
const run = (inputs: Record<string, unknown>, services?: Partial<RuntimeServices>) => createPatchHarness(formatDateTimePatch, { inputs, ...(services ? { services } : {}) }).step().outputs.text;

describe("formatDateTime", () => {
  it("formats presets, resolving Device to UTC in deterministic simulation", () => {
    expect(run({ time: T })).toBe("6:30 PM");
    expect(run({ time: T, format: "time24HourSeconds" })).toBe("18:30:05");
    expect(run({ time: T, format: "longDateDmy", timeZone: "device" })).toBe("14 March, 2026");
    expect(run({ time: T, format: "mediumDateMdy", timeZone: "utc" })).toBe("Mar 14, 2026");
    expect(run({})).toBe("12:00 AM");
  });

  it("formats custom patterns", () => {
    expect(run({ time: 1773513000, format: "custom", customFormat: "%A, %B %-d at %-I:%M %p", timeZone: "utc" })).toBe("Saturday, March 14 at 6:30 PM");
    expect(run({ time: T, format: "custom" })).toBe("18:30:05");
    expect(run({ time: T + 0.9999, format: "custom", customFormat: "%S.%L" })).toBe("05.999");
    expect(run({ time: T, format: "custom", customFormat: "" })).toBe("");
  });

  it("falls back to 12-hour time for an unknown format key", () => {
    expect(run({ time: T, format: "fromTheFuture" })).toBe("6:30 PM");
  });

  it("treats Time as a duration for the media formats and ignores the time zone", () => {
    expect(run({ time: 125, format: "mediaTime" })).toBe("02:05");
    expect(run({ time: 125, format: "shortMediaTime", timeZone: "device" })).toBe("2:05");
    expect(run({ time: 3725, format: "shortMediaTime" })).toBe("1:02:05");
    expect(run({ time: -5, format: "mediaTime" })).toBe("-00:05");
  });

  it("uses a host-provided time zone for Device", () => {
    const device = createPatchHarness(formatDateTimePatch).services.device();
    const services = { device: () => ({ ...device, timeZone: "Asia/Kolkata" }) } as unknown as Partial<RuntimeServices>;
    expect(run({ time: T, format: "custom", customFormat: "%F %T %z" }, services)).toBe("2026-03-15 00:00:05 +0530");
    expect(run({ time: T, format: "custom", customFormat: "%T", timeZone: "utc" }, services)).toBe("18:30:05");
  });

  it("uses the platform time zone on a live clock", () => {
    const services: Partial<RuntimeServices> = { now: () => 1_800_000_000_000 };
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(run({ time: T, format: "custom", customFormat: "%F %T %Z" }, services)).toBe(strftime("%F %T %Z", dateParts(T * 1000, zone)));
  });

  it("outputs \"\" outside years 1 to 9999 and warns once per loop index per restart", () => {
    const h = createPatchHarness(formatDateTimePatch, { inputs: { time: 253402300800 } });
    expect(h.step().outputs.text).toBe("");
    expect(h.step({ inputs: { time: -62135596801 } }).outputs.text).toBe("");
    expect(h.step({ inputs: { time: Number.NaN } }).outputs.text).toBe("");
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    expect(h.step({ inputs: { time: 253402300799, format: "shortDateYmd" } }).outputs.text).toBe("9999-12-31");
    expect(h.step({ inputs: { time: -62135596800 } }).outputs.text).toBe("0001-01-01");
    h.restart();
    h.step({ inputs: { time: Number.POSITIVE_INFINITY } });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(2);
  });

  it("shows a non-finite duration as 0", () => {
    const h = createPatchHarness(formatDateTimePatch, { inputs: { time: Number.NaN, format: "mediaTime" } });
    expect(h.step().outputs.text).toBe("00:00");
    expect(h.logs).toHaveLength(1);
  });

  it("gives a loop of labels for a loop of timestamps", () => {
    expect(run({ time: loopOf([0, 3600, 7200]), format: "time24Hour" })).toEqual(loopOf(["00:00", "01:00", "02:00"]));
  });

  it("runs in the engine evaluator and outputs Time as text while muted", () => {
    expect(runPatch(formatDateTimePatch, [{ time: T, format: "time24Hour" }]).frames[0]!.outputs.text).toBe("18:30");
    expect(runPatch(formatDateTimePatch, [{ time: T, format: "time24Hour" }], { muted: true }).frames[0]!.outputs.text).toBe("1773513005");
  });
});
