import { describe, expect, it } from "vitest";
import { colorsEqual, hsvaToRgba, parseHexColor, readableForeground, rgbaToHsva, toCssColor, toHex6, toHex8 } from "./colorMath.ts";

describe("parseHexColor", () => {
  it("accepts 3, 4, 6, and 8 digit forms with or without #", () => {
    expect(parseHexColor("#FFF")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseHexColor("0008")).toEqual({ r: 0, g: 0, b: 0, a: 0x88 / 255 });
    expect(parseHexColor("#FF0000")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseHexColor(" #11223344 ")).toEqual({ r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255, a: 0x44 / 255 });
  });

  it("rejects malformed input", () => {
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor("#GG0000")).toBeNull();
    expect(parseHexColor("")).toBeNull();
  });
});

describe("hex formatting", () => {
  it("round-trips document colors", () => {
    for (const hex of ["#D9D9D9FF", "#00000000", "#5F74E480"]) {
      expect(toHex8(parseHexColor(hex)!)).toBe(hex);
    }
    expect(toHex6({ r: 1, g: 0.5, b: 0, a: 0.2 })).toBe("#FF8000");
    expect(toCssColor({ r: 1, g: 0.5, b: 0, a: 0.25 })).toBe("rgb(255 128 0 / 0.25)");
  });
});

describe("HSV conversion", () => {
  it("converts primaries", () => {
    expect(rgbaToHsva({ r: 1, g: 0, b: 0, a: 1 })).toEqual({ h: 0, s: 1, v: 1, a: 1 });
    expect(rgbaToHsva({ r: 0, g: 0, b: 1, a: 0.5 })).toEqual({ h: 240, s: 1, v: 1, a: 0.5 });
    expect(hsvaToRgba({ h: 120, s: 1, v: 1, a: 1 })).toEqual({ r: 0, g: 1, b: 0, a: 1 });
  });

  it("wraps hue and handles grays", () => {
    expect(colorsEqual(hsvaToRgba({ h: 360, s: 1, v: 1, a: 1 }), { r: 1, g: 0, b: 0, a: 1 })).toBe(true);
    expect(rgbaToHsva({ r: 0.5, g: 0.5, b: 0.5, a: 1 })).toMatchObject({ h: 0, s: 0, v: 0.5 });
  });

  it("round-trips arbitrary colors", () => {
    const c = parseHexColor("#3A7BD5CC")!;
    expect(toHex8(hsvaToRgba(rgbaToHsva(c)))).toBe("#3A7BD5CC");
  });

  it("chooses a readable foreground", () => {
    expect(readableForeground({ r: 1, g: 1, b: 1, a: 1 })).toBe("dark");
    expect(readableForeground({ r: 0.1, g: 0.1, b: 0.3, a: 1 })).toBe("light");
  });
});
