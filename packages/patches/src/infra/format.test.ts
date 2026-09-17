import { describe, expect, it } from "vitest";
import { escapeRegExp, groupThousands, numberToText, padInteger, roundDecimal } from "./format.ts";
import type { RoundingMode } from "./format.ts";

describe("roundDecimal", () => {
  it("rounds the shortest decimal representation", () => {
    expect(roundDecimal(1.005, 2)).toBe("1.01");
    expect(roundDecimal(1234.5, 0)).toBe("1235");
    expect(roundDecimal(1234.5, 2)).toBe("1234.50");
    expect(roundDecimal(2.5, 0)).toBe("3");
    expect(roundDecimal(-2.5, 0)).toBe("-3");
    expect(roundDecimal(-2.1, 0, "down")).toBe("-3");
    expect(roundDecimal(2.1, 0, "up")).toBe("3");
    expect(roundDecimal(-2.9, 0, "up")).toBe("-2");
    expect(roundDecimal(2.9, 0, "down")).toBe("2");
    expect(roundDecimal(-0.4, 0)).toBe("-0");
    expect(roundDecimal(999.995, 2)).toBe("1000.00");
    expect(roundDecimal(9.99, 1)).toBe("10.0");
  });

  it("never writes exponent notation", () => {
    expect(roundDecimal(1e21, 0)).toBe("1" + "0".repeat(21));
    expect(roundDecimal(1.5e-7, 8)).toBe("0.00000015");
    expect(roundDecimal(1.5e-7, 2)).toBe("0.00");
    expect(roundDecimal(-1.5e-7, 2, "down")).toBe("-0.01");
  });

  it("reads non-finite values as 0 and whole decimals", () => {
    expect(roundDecimal(Number.NaN, 2)).toBe("0.00");
    expect(roundDecimal(Number.POSITIVE_INFINITY, 0)).toBe("0");
    expect(roundDecimal(1.25, 1.9)).toBe("1.3");
    expect(roundDecimal(1.25, -3)).toBe("1");
  });

  it("matches Intl.NumberFormat with roundingMode", () => {
    const options = (d: number, roundingMode: string) =>
      ({ useGrouping: false, minimumFractionDigits: d, maximumFractionDigits: d, roundingMode }) as Intl.NumberFormatOptions;
    if (new Intl.NumberFormat("en-US", options(0, "floor")).format(1.9) !== "1") return;
    const modes: Record<RoundingMode, string> = { nearest: "halfExpand", down: "floor", up: "ceil" };
    let seed = 7;
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 400; i++) {
      const x = (next() - 0.5) * 10 ** Math.floor(next() * 10 - 4);
      const d = Math.floor(next() * 5);
      for (const [mode, roundingMode] of Object.entries(modes) as [RoundingMode, string][]) {
        const intl = new Intl.NumberFormat("en-US", options(d, roundingMode)).format(String(x) as unknown as number);
        expect(roundDecimal(x, d, mode), `${x} at ${d} decimals, ${mode}`).toBe(intl);
      }
    }
  });
});

describe("text helpers", () => {
  it("groups, pads, and formats", () => {
    expect(groupThousands("1234567")).toBe("1,234,567");
    expect(groupThousands("123")).toBe("123");
    expect(groupThousands("1234", " ")).toBe("1 234");
    expect(padInteger("7", 2)).toBe("07");
    expect(padInteger("123", 2)).toBe("123");
    expect(numberToText(1 / 3)).toBe("0.333333");
    expect(numberToText(-0)).toBe("0");
  });

  it("escapes regular expressions", () => {
    const text = "a.b*c(d)[e]{f}|g/h\\i^$+?";
    expect(new RegExp(`^${escapeRegExp(text)}$`, "u").test(text)).toBe(true);
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
  });
});
