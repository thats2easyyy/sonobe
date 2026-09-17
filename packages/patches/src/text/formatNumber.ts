/** Format Number: a number as display text with decimals, separators, a percent or K/M/B/T unit, and a prefix and suffix. */

import type { RoundingMode } from "../infra/index.ts";
import { definePatch, groupThousands, numberToText, roundDecimal, toBool, toText, warnOnce, wholeInRange } from "../infra/index.ts";

const UNITS = ["", "K", "M", "B", "T"] as const;

/** Thousands and decimal separators by Separators key. Space and Comma groups with a no-break space. */
export const NUMBER_SEPARATORS: Readonly<Record<string, readonly [group: string, decimal: string]>> = {
  commaPeriod: [",", "."],
  periodComma: [".", ","],
  spaceComma: [" ", ","],
};

export interface NumberFormatOptions {
  style: string;
  decimals: number;
  rounding: string;
  trailingZeros: boolean;
  minimumDigits: number;
  separators: string;
  groupThousands: boolean;
}

const roundingMode = (key: string): RoundingMode => (key === "down" || key === "up" ? key : "nearest");

/** The formatted number without Prefix and Suffix: sign, digits, decimals, and unit. Non-finite values format as 0. */
export function formatNumberText(value: number, options: NumberFormatOptions): string {
  const d = wholeInRange(options.decimals, 0, 20);
  const mode = roundingMode(options.rounding);
  let n = Number.isFinite(value) ? value : 0;
  if (options.style === "percent") n *= 100;
  let digits = roundDecimal(n, d, mode);
  let unit: string = options.style === "percent" ? "%" : "";
  if (options.style === "compact") {
    let k = 0;
    while (k < 4 && Math.abs(n) >= 1000 ** (k + 1)) k++;
    digits = roundDecimal(n / 1000 ** k, d, mode);
    if (k < 4 && Math.abs(Number(digits)) >= 1000) {
      k++;
      digits = roundDecimal(n / 1000 ** k, d, mode);
    }
    unit = UNITS[k]!;
  }
  const negative = digits.startsWith("-") && /[1-9]/.test(digits);
  const [rawInt = "0", rawFraction = ""] = digits.replace("-", "").split(".");
  const fraction = options.trailingZeros ? rawFraction : rawFraction.replace(/0+$/, "");
  let intPart = rawInt.padStart(wholeInRange(options.minimumDigits, 1, 21), "0");
  const [group, decimal] = Object.hasOwn(NUMBER_SEPARATORS, options.separators) ? NUMBER_SEPARATORS[options.separators]! : NUMBER_SEPARATORS.commaPeriod!;
  if (options.groupThousands) intPart = groupThousands(intPart, group);
  return (negative ? "-" : "") + intPart + (fraction ? decimal + fraction : "") + unit;
}

export const formatNumberPatch = definePatch("formatNumber", {
  evaluate(ctx) {
    const value = ctx.input<number>("value");
    if (ctx.muted) {
      ctx.output("text", numberToText(value));
      return;
    }
    if (!Number.isFinite(value)) warnOnce(ctx, "value", "Format Number: Value isn't a finite number, so it shows as 0.");
    const body = formatNumberText(value, {
      style: toText(ctx.input("style")),
      decimals: ctx.input<number>("decimals"),
      rounding: toText(ctx.input("rounding")),
      trailingZeros: toBool(ctx.input("trailingZeros")),
      minimumDigits: ctx.input<number>("minimumDigits"),
      separators: toText(ctx.input("separators")),
      groupThousands: toBool(ctx.input("groupThousands")),
    });
    ctx.output("text", toText(ctx.input("prefix")) + body + toText(ctx.input("suffix")));
  },
  mutedBehavior: "evaluate",
});
