/**
 * Date and time formatting for Format Date & Time: calendar fields of an instant in a time zone,
 * strftime-style % codes with English names, preset patterns, and media timestamps.
 */

/** Calendar fields of an instant in a time zone. */
export interface DateParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** 0–6, Sunday = 0 */
  weekday: number;
  /** 1–366 */
  dayOfYear: number;
  /** Minutes ahead of UTC. */
  offsetMinutes: number;
  /** Short zone name such as "UTC", "PST", or "GMT+5:30". */
  zoneName: string;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Earliest and latest supported Time (years 1 to 9999, UTC), in seconds. */
export const MIN_TIME = -62135596800;
export const MAX_TIME_EXCLUSIVE = 253402300800;

/** Preset Format keys and their patterns. */
export const DATE_TIME_PRESETS: Readonly<Record<string, string>> = {
  time12Hour: "%-I:%M %p",
  time12HourSeconds: "%-I:%M:%S %p",
  time24Hour: "%H:%M",
  time24HourSeconds: "%H:%M:%S",
  shortDateYmd: "%Y-%m-%d",
  shortDateDmy: "%d-%m-%Y",
  shortDateMdy: "%m-%d-%Y",
  mediumDateMdy: "%b %-d, %Y",
  mediumDateDmy: "%-d %b, %Y",
  longDateMdy: "%B %-d, %Y",
  longDateDmy: "%-d %B, %Y",
};

const pad = (n: number, width: number, fill = "0") => String(n).padStart(width, fill);

/** UTC milliseconds for calendar fields, without Date.UTC shifting years below 100. */
function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime();
}

const dayOfYear = (year: number, month: number, day: number) => Math.round((utcMs(year, month, day) - utcMs(year, 1, 1)) / 86_400_000) + 1;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      timeZoneName: "short",
    });
    formatters.set(zone, f);
  }
  return f;
}

function utcParts(ms: number): DateParts {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return {
    year,
    month,
    day,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: ((ms % 1000) + 1000) % 1000,
    weekday: d.getUTCDay(),
    dayOfYear: dayOfYear(year, month, day),
    offsetMinutes: 0,
    zoneName: "UTC",
  };
}

/** True when `zone` is an IANA zone this platform can format. */
export function isSupportedTimeZone(zone: string): boolean {
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

/** Calendar fields of `ms` (epoch milliseconds) in `zone`. "UTC" and unsupported zones read as UTC. */
export function dateParts(ms: number, zone: string): DateParts {
  if (zone === "UTC" || !isSupportedTimeZone(zone)) return utcParts(ms);
  const fields: Record<string, string> = {};
  for (const part of formatterFor(zone).formatToParts(ms)) fields[part.type] = part.value;
  let year = Number(fields.year);
  if (fields.era && /^B/i.test(fields.era)) year = 1 - year;
  const month = Number(fields.month);
  const day = Number(fields.day);
  const hour = Number(fields.hour) % 24;
  const minute = Number(fields.minute);
  const second = Number(fields.second);
  const weekday = DAYS.findIndex((name) => name.startsWith(fields.weekday ?? ""));
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond: ((ms % 1000) + 1000) % 1000,
    weekday: weekday >= 0 ? weekday : new Date(utcMs(year, month, day)).getUTCDay(),
    dayOfYear: dayOfYear(year, month, day),
    offsetMinutes: Math.round((utcMs(year, month, day, hour, minute, second) - Math.floor(ms / 1000) * 1000) / 60_000),
    zoneName: fields.timeZoneName ?? zone,
  };
}

/** Codes whose zero or space padding the "-" flag removes. */
const UNPADDABLE = new Set(["d", "e", "H", "I", "j", "k", "l", "m", "M", "S"]);

const hour12 = (hour: number) => (hour % 12 === 0 ? 12 : hour % 12);

function expand(code: string, p: DateParts, noPad: boolean): string | undefined {
  if (noPad && !UNPADDABLE.has(code)) return undefined;
  const numeric = (n: number, width: number, fill = "0") => (noPad ? String(n) : pad(n, width, fill));
  switch (code) {
    case "a":
      return DAYS[p.weekday]!.slice(0, 3);
    case "A":
      return DAYS[p.weekday]!;
    case "b":
    case "h":
      return MONTHS[p.month - 1]!.slice(0, 3);
    case "B":
      return MONTHS[p.month - 1]!;
    case "C":
      return pad(Math.floor(p.year / 100), 2);
    case "c":
      return strftime("%a %b %e %H:%M:%S %Y", p);
    case "d":
      return numeric(p.day, 2);
    case "D":
    case "x":
      return strftime("%m/%d/%y", p);
    case "e":
      return numeric(p.day, 2, " ");
    case "F":
      return strftime("%Y-%m-%d", p);
    case "H":
      return numeric(p.hour, 2);
    case "I":
      return numeric(hour12(p.hour), 2);
    case "j":
      return numeric(p.dayOfYear, 3);
    case "k":
      return numeric(p.hour, 2, " ");
    case "l":
      return numeric(hour12(p.hour), 2, " ");
    case "L":
      return pad(p.millisecond, 3);
    case "m":
      return numeric(p.month, 2);
    case "M":
      return numeric(p.minute, 2);
    case "n":
      return "\n";
    case "p":
      return p.hour < 12 ? "AM" : "PM";
    case "r":
      return strftime("%I:%M:%S %p", p);
    case "R":
      return strftime("%H:%M", p);
    case "S":
      return numeric(p.second, 2);
    case "t":
      return "\t";
    case "T":
    case "X":
      return strftime("%H:%M:%S", p);
    case "u":
      return String(p.weekday === 0 ? 7 : p.weekday);
    case "w":
      return String(p.weekday);
    case "y":
      return pad(((p.year % 100) + 100) % 100, 2);
    case "Y":
      return p.year < 0 ? `-${pad(-p.year, 4)}` : pad(p.year, 4);
    case "z": {
      const abs = Math.abs(p.offsetMinutes);
      return (p.offsetMinutes < 0 ? "-" : "+") + pad(Math.floor(abs / 60), 2) + pad(abs % 60, 2);
    }
    case "Z":
      return p.zoneName;
    case "%":
      return "%";
    default:
      return undefined;
  }
}

/**
 * Expand % codes in `pattern`. A "-" after % removes padding from d, e, H, I, j, k, l, m, M, and S.
 * Unknown codes (including week numbers) and a trailing "%" stay as typed.
 */
export function strftime(pattern: string, parts: DateParts): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch !== "%") {
      out += ch;
      continue;
    }
    let j = i + 1;
    const noPad = pattern[j] === "-";
    if (noPad) j++;
    const code = pattern[j];
    if (code === undefined) {
      out += pattern.slice(i);
      break;
    }
    out += expand(code, parts, noPad) ?? pattern.slice(i, j + 1);
    i = j;
  }
  return out;
}

/**
 * A duration as a media timestamp: whole seconds (after a 1e-6 epsilon) as M:SS, or H:MM:SS from an
 * hour; `padFirst` zero-pads the first number. Negative durations get a "-" unless they round to 0.
 */
export function mediaTime(seconds: number, padFirst: boolean): string {
  const s = Math.floor(Math.abs(seconds) + 1e-6);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const lead = h > 0 ? h : m;
  const first = padFirst ? pad(lead, 2) : String(lead);
  const body = h > 0 ? `${first}:${pad(m, 2)}:${pad(sec, 2)}` : `${first}:${pad(sec, 2)}`;
  return (seconds < 0 && s > 0 ? "-" : "") + body;
}
