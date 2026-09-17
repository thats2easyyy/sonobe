import { describe, expect, it } from "vitest";
import { DATE_TIME_PRESETS, MAX_TIME_EXCLUSIVE, MIN_TIME, dateParts, isSupportedTimeZone, mediaTime, strftime } from "./strftime.ts";

/** Saturday, March 14, 2026, 18:30:05 UTC. */
const T = 1773513005;
const utc = (seconds: number) => dateParts(Math.floor(seconds * 1000), "UTC");

describe("dateParts", () => {
  it("reads calendar fields in UTC", () => {
    expect(utc(T)).toEqual({ year: 2026, month: 3, day: 14, hour: 18, minute: 30, second: 5, millisecond: 0, weekday: 6, dayOfYear: 73, offsetMinutes: 0, zoneName: "UTC" });
    expect(utc(-0.5)).toMatchObject({ year: 1969, month: 12, day: 31, hour: 23, minute: 59, second: 59, millisecond: 500, dayOfYear: 365 });
    expect(utc(MIN_TIME)).toMatchObject({ year: 1, month: 1, day: 1, weekday: 1 });
    expect(utc(MAX_TIME_EXCLUSIVE - 1)).toMatchObject({ year: 9999, month: 12, day: 31, hour: 23, dayOfYear: 365 });
  });

  it("reads fields, offsets, and zone names in IANA zones", () => {
    expect(dateParts(T * 1000, "America/Los_Angeles")).toMatchObject({ day: 14, hour: 11, minute: 30, offsetMinutes: -420, zoneName: "PDT", weekday: 6 });
    expect(dateParts(T * 1000, "Asia/Kolkata")).toMatchObject({ day: 15, hour: 0, minute: 0, second: 5, offsetMinutes: 330, zoneName: "GMT+5:30", weekday: 0, dayOfYear: 74 });
    expect(dateParts(T * 1000, "Etc/GMT+12")).toMatchObject({ day: 14, hour: 6, offsetMinutes: -720 });
    expect(dateParts(Date.UTC(2026, 0, 1), "Asia/Tokyo")).toMatchObject({ year: 2026, month: 1, day: 1, hour: 9, dayOfYear: 1 });
  });

  it("handles years below 100 without shifting them", () => {
    const ms = new Date(0).setUTCFullYear(50, 0, 1);
    expect(dateParts(ms, "UTC")).toMatchObject({ year: 50, month: 1, day: 1, dayOfYear: 1 });
    expect(dateParts(ms + 12 * 3600_000, "Asia/Tokyo")).toMatchObject({ year: 50, month: 1, day: 1, offsetMinutes: expect.any(Number) });
  });

  it("reads unsupported zones as UTC", () => {
    expect(isSupportedTimeZone("Not/AZone")).toBe(false);
    expect(dateParts(T * 1000, "Not/AZone")).toEqual(utc(T));
  });
});

describe("strftime", () => {
  const p = utc(T);

  it("formats every preset", () => {
    const expected: Record<string, string> = {
      time12Hour: "6:30 PM",
      time12HourSeconds: "6:30:05 PM",
      time24Hour: "18:30",
      time24HourSeconds: "18:30:05",
      shortDateYmd: "2026-03-14",
      shortDateDmy: "14-03-2026",
      shortDateMdy: "03-14-2026",
      mediumDateMdy: "Mar 14, 2026",
      mediumDateDmy: "14 Mar, 2026",
      longDateMdy: "March 14, 2026",
      longDateDmy: "14 March, 2026",
    };
    for (const [key, pattern] of Object.entries(DATE_TIME_PRESETS)) expect(strftime(pattern, p), key).toBe(expected[key]);
  });

  it("expands every code", () => {
    const codes: Record<string, string> = {
      a: "Sat", A: "Saturday", b: "Mar", h: "Mar", B: "March", C: "20", c: "Sat Mar 14 18:30:05 2026", d: "14", D: "03/14/26",
      e: "14", F: "2026-03-14", H: "18", I: "06", j: "073", k: "18", l: " 6", L: "000", m: "03", M: "30", n: "\n", p: "PM",
      r: "06:30:05 PM", R: "18:30", S: "05", t: "\t", T: "18:30:05", u: "6", w: "6", x: "03/14/26", X: "18:30:05", y: "26",
      Y: "2026", z: "+0000", Z: "UTC", "%": "%",
    };
    for (const [code, value] of Object.entries(codes)) expect(strftime(`%${code}`, p), code).toBe(value);
  });

  it("pads small values and removes padding with the - flag", () => {
    const early = utc(Date.UTC(2026, 0, 5, 7, 4, 9, 42) / 1000);
    expect(strftime("%d %e %H %I %j %k %l %m %M %S %L", early)).toBe("05  5 07 07 005  7  7 01 04 09 042");
    expect(strftime("%-d %-e %-H %-I %-j %-k %-l %-m %-M %-S", early)).toBe("5 5 7 7 5 7 7 1 4 9");
    expect(strftime("%p %I %u %w", utc(Date.UTC(2026, 0, 4, 0, 0) / 1000))).toBe("AM 12 7 0");
  });

  it("leaves unknown codes, unsupported flags, and a trailing % as typed", () => {
    expect(strftime("%Q %U %V %W %G %g", p)).toBe("%Q %U %V %W %G %g");
    expect(strftime("%-y %-%", p)).toBe("%-y %-%");
    expect(strftime("100%", p)).toBe("100%");
    expect(strftime("%-", p)).toBe("%-");
    expect(strftime("%A, %B %-d at %-I:%M %p", utc(1773513000))).toBe("Saturday, March 14 at 6:30 PM");
    expect(strftime("🎉%🎉", p)).toBe("🎉%🎉");
  });

  it("writes offsets with an ASCII sign and at least four year digits", () => {
    expect(strftime("%z %Z", dateParts(T * 1000, "America/Los_Angeles"))).toBe("-0700 PDT");
    expect(strftime("%z", dateParts(T * 1000, "Asia/Kolkata"))).toBe("+0530");
    expect(strftime("%Y %y %C", utc(new Date(0).setUTCFullYear(50, 0, 1) / 1000))).toBe("0050 50 00");
  });
});

describe("mediaTime", () => {
  it("formats durations with and without a padded first number", () => {
    expect(mediaTime(125, true)).toBe("02:05");
    expect(mediaTime(125, false)).toBe("2:05");
    expect(mediaTime(3725, true)).toBe("01:02:05");
    expect(mediaTime(3725, false)).toBe("1:02:05");
    expect(mediaTime(0, true)).toBe("00:00");
    expect(mediaTime(59.9, true)).toBe("00:59");
    expect(mediaTime(59.9999999, true)).toBe("01:00");
    expect(mediaTime(360000, false)).toBe("100:00:00");
  });

  it("shows a sign on negative durations unless they round to 0", () => {
    expect(mediaTime(-5, true)).toBe("-00:05");
    expect(mediaTime(-0.5, false)).toBe("0:00");
  });
});
