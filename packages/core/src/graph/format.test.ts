import { describe, expect, it } from "vitest";
import { formatKnobValue } from "../knobs.ts";
import type { EnumOption, ValueType } from "../types.ts";
import { COORDINATE_CHARS, formatNumberShort, formatValue, formatValueLong, formatValueReserve, knobValueReserve, LOOP_PREVIEW_CHARS, loopBadgeReserve, NUMBER_SHORT_CHARS, pickCopy } from "./format.ts";

const loop = (...items: unknown[]) => ({ __loop: true as const, items });

describe("watched copies", () => {
  it("picks item k of a loop, wrapping like a shorter loop does, and passes plain values through", () => {
    expect(pickCopy(loop(10, 20, 30), 1)).toEqual({ value: 20, index: 1, empty: false });
    expect(pickCopy(loop(10, 20, 30), 4)).toEqual({ value: 20, index: 1, empty: false });
    expect(pickCopy(loop(), 2)).toEqual({ value: undefined, index: null, empty: true });
    expect(pickCopy(0.5, 7)).toEqual({ value: 0.5, index: null, empty: false });
  });

  it("shows the watched item instead of the ×N summary", () => {
    const values = loop(0, 0.25, 1);
    expect(formatValue(values, "number")).toBe("×3 0…");
    expect(formatValue(values, "number", { copy: 1 })).toBe("#1 0.25");
    expect(formatValue(values, "number", { copy: null })).toBe("×3 0…");
    expect(formatValue(loop(), "number", { copy: 1 })).toBe("×0");
    expect(formatValue(0.5, "number", { copy: 1 })).toBe("0.5");
    expect(formatValueLong(values, "number", { copy: 5 })).toBe("Copy #2 of 3: 1");
    expect(formatValueLong(values, "number")).toBe("Loop of 3: 0 · 0.25 · 1");
  });
});

describe("reserved widths", () => {
  const live = { maxText: 10 };
  const numbers = [0, 0.5, -0.001, 1.04, -12.35, 100, -1234.567, 99999.94, -99999.9, 123456, -999999, 1234567, -999999999, -1234567890, 12345678901, 123456789012, -999999999999, -987654321098765, Infinity, -Infinity, NaN];
  /** Coordinates on a screen, which a point's reserve covers. */
  const coordinates = [0, 0.5, -0.001, 1.04, -12.35, 100, 390, -999.94, 999.9, -120.5];
  /** Progress values, springs' overshoot included, and angles in degrees. */
  const progresses = [0, 0.5, 1, -0.125, 1.052, -9.999, 9.9994];
  const angles = [0, 45, -179.95, 359.9, -999.9, 12.345];
  /** Indexes: positions in a loop of up to 10,000, "not found", frames for hours, a snap's step below its offset. */
  const indexes = [0, 7, 9999, -1, 216000, 999999, -99999];

  it("reserves the longest text of the port's type", () => {
    expect(formatValueReserve(0.5, "number", live)).toBe(NUMBER_SHORT_CHARS);
    expect(formatValueReserve(false, "boolean", live)).toBe("Off".length);
    expect(formatValueReserve({ r: 1, g: 0, b: 0, a: 1 }, "color", live)).toBe("#RRGGBBAA".length);
    expect(formatValueReserve("Hi", "text", live)).toBe(12);
    expect(formatValueReserve("layer_1", "layer", live)).toBe(10);
    expect(formatValueReserve({ assetId: "a" }, "image", live)).toBe(10);
    expect(formatValueReserve(null, "number", live)).toBe(8);
  });

  it("keeps less for numbers that measure a progress or an angle, and for indexes", () => {
    expect(formatValueReserve(0.5, "number", { ...live, subtype: "progress" })).toBe("-0.125".length);
    expect(formatValueReserve(90, "number", { ...live, subtype: "angle" })).toBe("-179.9".length);
    expect(formatValueReserve(3, "index", live)).toBe("123.4k".length);
    expect(formatValueReserve(0.5, "number", { ...live, subtype: "distance" })).toBe(NUMBER_SHORT_CHARS);
    for (const n of progresses) expect(formatValue(n, "number", live).length, `${n}`).toBeLessThanOrEqual(formatValueReserve(n, "number", { ...live, subtype: "progress" }));
    for (const n of angles) expect(formatValue(n, "number", live).length, `${n}`).toBeLessThanOrEqual(formatValueReserve(n, "number", { ...live, subtype: "angle" }));
    for (const n of indexes) expect(formatValue(n, "index", live).length, `${n}`).toBeLessThanOrEqual(formatValueReserve(n, "index", live));
  });

  it("reserves a point's coordinates as far as ±999.9, whatever the point is now", () => {
    expect(formatValueReserve([0, 0], "point", live)).toBe("-999.9, -999.9".length);
    expect(formatValueReserve([-120.5, 88], "point", live)).toBe(14);
    expect(formatValueReserve(null, "point", live)).toBe(14);
    expect(formatValueReserve([375, 812], "size", live)).toBe(14);
    expect(formatValueReserve([0, 0, 0], "point3d", live)).toBe(3 * COORDINATE_CHARS + 4);
    expect(formatValueReserve([0, 0, 0, 0], "point4d", live)).toBe(4 * COORDINATE_CHARS + 6);
    // A flick's velocity passes ±999.9 and prints longer; its slot keeps the reserve, and the value ends in "…".
    expect(formatValue([1931.5, -1229.1], "point", live)).toBe("1931.5, -1229.1");
    expect(formatValueReserve([1931.5, -1229.1], "point", live)).toBe(14);
  });

  it("reserves a port's room before its first value arrives, except a pulse's, which prints nothing, and json's and any's, which follow their value", () => {
    expect(formatValueReserve(undefined, "number", live)).toBe(NUMBER_SHORT_CHARS);
    expect(formatValueReserve(undefined, "number", { ...live, subtype: "progress" })).toBe(formatValueReserve(0.5, "number", { ...live, subtype: "progress" }));
    for (const [type, value] of [
      ["boolean", false],
      ["color", { r: 1, g: 0, b: 0, a: 0.5 }],
      ["text", "Hi"],
      ["point", [1, 2]],
      ["point3d", [1, 2, 3]],
      ["layer", "layer_1"],
      ["image", { assetId: "a" }],
    ] as [ValueType, unknown][])
      expect(formatValueReserve(undefined, type, live), type).toBe(formatValueReserve(value, type, live));
    expect(formatValueReserve(undefined, "enum", { ...live, enumOptions: [{ key: "a", name: "Ease In" }] })).toBe(7);
    expect(formatValueReserve(true, "pulse", live)).toBe(0);
    expect(formatValueReserve(undefined, "pulse", live)).toBe(0);
    expect(formatValueReserve(undefined, "json", live)).toBe(0);
    expect(formatValueReserve(undefined, "any", live)).toBe(0);
  });

  it("uses the longest enum option when the options are known, and at most maxText", () => {
    const options = [
      { key: "a", name: "Linear" },
      { key: "b", name: "Ease In" },
      { key: "c", name: "Exponential In & Out" },
    ];
    expect(formatValueReserve("a", "enum", { ...live, enumOptions: options.slice(0, 2) })).toBe(7);
    expect(formatValueReserve("a", "enum", { ...live, enumOptions: options })).toBe(10);
    expect(formatValueReserve("custom_key", "enum", { ...live, enumOptions: options.slice(0, 2) })).toBe(10);
    expect(formatValueReserve("a", "enum", live)).toBe(10);
  });

  it("reserves json and any values by their own kind", () => {
    expect(formatValueReserve({ a: 1 }, "json", live)).toBe(3);
    expect(formatValueReserve(12.5, "json", live)).toBe(8);
    expect(formatValueReserve("text", "any", live)).toBe(12);
    expect(formatValueReserve([1, 2, 3, 4, 5], "json", live)).toBe(5);
    expect(formatValueReserve(null, "json", live)).toBe(1);
  });

  it("reserves a loop's ×NN summary with a short preview of its first item", () => {
    const loop12 = loop(...Array.from({ length: 12 }, (_, i) => i * 1.5));
    const summary = "×NN ".length + LOOP_PREVIEW_CHARS + "…".length;
    expect(formatValueReserve(loop12, "number", live)).toBe(summary);
    expect(formatValueReserve(loop(true, false), "boolean", live)).toBe("×NN Off…".length);
    expect(formatValueReserve(loop(0.5), "number", { ...live, subtype: "progress" })).toBe(summary);
    expect(formatValueReserve(loop("a"), "text", live)).toBe(summary);
    expect(formatValueReserve(loop([201.5, 366.5]), "point", live)).toBe(summary);
    expect(formatValueReserve(loop({ r: 1, g: 0, b: 0, a: 1 }), "color", live)).toBe(summary);
    expect(formatValueReserve(loop(), "number", live)).toBe(summary);
    // Past 99 copies the count takes a digit from the preview.
    expect(formatValueReserve(loop(...Array.from({ length: 120 }, () => 0)), "number", live)).toBe(summary);
    // Loop's Index prints "×12 0…", and a watched copy "#11 11", which fit whole.
    const indexes12 = loop(...Array.from({ length: 12 }, (_, i) => i));
    expect(formatValue(indexes12, "index", live).length).toBeLessThanOrEqual(formatValueReserve(indexes12, "index", live));
    expect(formatValue(indexes12, "index", { ...live, copy: 11 })).toBe("#11 11");
    // A watched copy's longer item ends in "…" in the summary's room.
    expect(formatValue(loop([201.5, 366.5]), "point", { ...live, copy: 0 }).length).toBeGreaterThan(summary);
  });

  it("keeps one room for a loop whichever copy is watched, or none, so watching a copy doesn't resize the node", () => {
    for (const [type, item] of [
      ["number", 1.5],
      ["point", [201.5, 366.5]],
      ["text", "Hello"],
      ["color", { r: 1, g: 0, b: 0, a: 0.5 }],
      ["boolean", true],
      ["index", 3],
    ] as [ValueType, unknown][]) {
      const values = loop(item, item, item);
      const rooms = [null, 0, 2, 7].map((copy) => formatValueReserve(values, type, { ...live, copy }));
      expect(new Set(rooms), type).toEqual(new Set([rooms[0]]));
    }
  });

  it("keeps a loop's room before its first value when the port carries a loop, and while it's empty", () => {
    expect(formatValueReserve(undefined, "point", { ...live, loop: true })).toBe(formatValueReserve(loop([187.5, 402.25]), "point", live));
    expect(formatValueReserve(undefined, "number", { ...live, loop: true })).toBe(formatValueReserve(loop(1, 2), "number", live));
    // A plain value on a port that carries a loop keeps the loop's room.
    expect(formatValueReserve(0.5, "number", { ...live, loop: true })).toBe(formatValueReserve(loop(0.5), "number", live));
    expect(formatValueReserve(undefined, "json", { ...live, loop: true })).toBe(formatValueReserve(loop(1), "json", live));
    expect(formatValueReserve(undefined, "pulse", { ...live, loop: true })).toBe(0);
  });

  it("keeps one room for a loop whatever its length, so a loop growing or emptying holds still", () => {
    const ofLength = (n: number) => loop(...Array.from({ length: n }, (_, i) => i));
    const counts = [0, 1, 9, 10, 14, 99, 100, 2500].map((n) => formatValueReserve(ofLength(n), "number", live));
    expect(new Set(counts)).toEqual(new Set(["×NN ".length + LOOP_PREVIEW_CHARS + "…".length]));
    // An empty loop prints "×0" for a watched copy, in the same room.
    const copies = [0, 1, 9, 10, 11, 14, 99].map((n) => formatValueReserve(ofLength(n), "number", { ...live, copy: 3 }));
    expect(new Set(copies)).toEqual(new Set(counts));
    expect(formatValueReserve(ofLength(9), "boolean", live)).toBe(formatValueReserve(ofLength(100), "boolean", live));
    // Touches at rest is an empty loop of points: it keeps the room the first touch needs.
    expect(formatValueReserve(loop(), "point", live)).toBe(formatValueReserve(loop([187.5, 402.25]), "point", live));
  });

  it("gives the header's loop badge the room of two digits, and a bare × no more", () => {
    expect([0, 7, 12, 99].map(loopBadgeReserve)).toEqual(["×00", "×00", "×00", "×00"]);
    expect(loopBadgeReserve(120)).toBe("×000");
    expect(loopBadgeReserve(undefined)).toBe("×");
  });

  it("is never shorter than what formatValue prints for a value, a loop's count and preview, or a watched copy's index and preview", () => {
    const easing: EnumOption[] = [
      { key: "quadraticInOut", name: "Quadratic In & Out" },
      { key: "linear", name: "Linear" },
    ];
    const samples: [unknown, ValueType, EnumOption[]?][] = [
      ...numbers.flatMap((n): [unknown, ValueType][] => [
        [n, "number"],
        [n, "json"],
      ]),
      ...indexes.map((n): [unknown, ValueType] => [n, "index"]),
      ...coordinates.flatMap((n): [unknown, ValueType][] => [
        [[n, -n], "point"],
        [[n, n], "size"],
        [[n, -n, n], "point3d"],
        [[n, -n, n, -n], "point4d"],
      ]),
      [true, "boolean"],
      [false, "boolean"],
      [{ r: 0.2, g: 0.4, b: 0.6, a: 1 }, "color"],
      [{ r: 0.2, g: 0.4, b: 0.6, a: 0.5 }, "color"],
      ["", "text"],
      ["A much longer piece of text", "text"],
      ["Hello", "text"],
      ["quadraticInOut", "enum", easing],
      ["linear", "enum", easing],
      ["a_layer_with_a_long_id", "layer"],
      [{ assetId: "asset_with_a_long_id" }, "image"],
      [{ nested: true }, "json"],
      ["string in json", "json"],
      [[1, "a"], "json"],
      [false, "any"],
    ];
    for (const [value, type, enumOptions] of samples) {
      const options = { ...live, ...(enumOptions ? { enumOptions } : {}) };
      const plain = formatValue(value, type, options);
      expect(plain.length, `${type} ${plain}`).toBeLessThanOrEqual(formatValueReserve(value, type, options));
      // The summary's count and the first LOOP_PREVIEW_CHARS of its item fit, and so do a watched
      // copy's index and as much of its item; a longer item ends early.
      const values = loop(value, value, value);
      for (const copy of [null, 0, 2, 7]) {
        const text = formatValue(values, type, { ...options, copy });
        expect(Math.min(text.length, "#2 ".length + LOOP_PREVIEW_CHARS + 1), `${type} loop ${text}`).toBeLessThanOrEqual(formatValueReserve(values, type, { ...options, copy }));
      }
    }
  });

  it("gives every number under a quadrillion at most 8 characters, compacting billions and trillions", () => {
    for (const n of numbers) expect(formatNumberShort(n).length, `${n}`).toBeLessThanOrEqual(NUMBER_SHORT_CHARS);
    expect(formatNumberShort(-1234567890)).toBe("-1.23B");
    expect(formatNumberShort(123456789012)).toBe("123.46B");
    expect(formatNumberShort(-999999999999)).toBe("-1000B");
    expect(formatNumberShort(2.5e12)).toBe("2.5T");
    expect(formatNumberShort(-987654321098765)).toBe("-987.65T");
    expect(formatNumberShort(-999999999)).toBe("-1000M");
  });
});

describe("knob value reserves", () => {
  it("reserves a ranged number knob's longer end at its slider's precision, unit included", () => {
    expect(knobValueReserve({ type: "number", min: 0, max: 1 })).toBe("0.00".length);
    expect(knobValueReserve({ type: "number", min: 0, max: 20, step: 0.5 })).toBe("12.5".length);
    expect(knobValueReserve({ type: "number", min: -100, max: 50, step: 1 })).toBe("-100".length);
    expect(knobValueReserve({ type: "number", min: 0, max: 400, step: 1, unit: "pt" })).toBe("400 pt".length);
    expect(knobValueReserve({ type: "number", min: 0, max: 360, step: 15, unit: "°" })).toBe("360°".length);
    expect(knobValueReserve({ type: "number", min: 0, max: 1, step: 0.001 })).toBe("0.000".length);
    expect(knobValueReserve({ type: "number", min: 0, max: 1, step: 1e-7 })).toBe("0.123457".length);
  });

  it("covers every value the slider snaps to, from min in steps (or hundredths of the range), and its ends", () => {
    const knobs = [
      { type: "number" as const, min: -2, max: 12, step: 0.25, unit: "s" },
      // Snaps to -0.5, 0.5 … 9.5, then 10: min's decimals count too.
      { type: "number" as const, min: -0.5, max: 10, step: 1 },
      // A hundredth of the range is 0.0030000000000000005, which the slider snaps as 0.003.
      { type: "number" as const, min: 0.1, max: 0.4 },
      { type: "number" as const, min: 0, max: 5000, step: 10, unit: "ms" },
    ];
    for (const knob of knobs) {
      const reserve = knobValueReserve(knob);
      const step = knob.step ?? (knob.max - knob.min) / 100;
      // The Slider's snap (Slider.tsx): min plus whole steps, rounded without float noise.
      const values = [knob.max, ...Array.from({ length: Math.floor((knob.max - knob.min) / step + 1e-9) + 1 }, (_, k) => Number((knob.min + k * step).toFixed(6)))];
      const longest = Math.max(...values.map((v) => formatKnobValue(knob, v).length));
      expect(longest, JSON.stringify(knob)).toBe(reserve);
    }
  });

  it("reserves a number knob without a range the whole steps its field scrubs through, to -999 and 9999", () => {
    const gap = { type: "number" as const };
    expect(knobValueReserve(gap)).toBe("-999".length);
    for (const v of [8, 120, -160, 9999, -999]) expect(formatKnobValue(gap, v).length).toBeLessThanOrEqual(knobValueReserve(gap));
    expect(knobValueReserve({ type: "number", min: 0 })).toBe(4);
    expect(knobValueReserve({ type: "number", step: 0.25, unit: "s" })).toBe("-999.25 s".length);
  });

  it("reserves a point knob's two fields, with a range the way number knobs do", () => {
    const offset = { type: "point" as const, min: -200, max: 200, step: 1 };
    expect(knobValueReserve(offset)).toBe("-200, -200".length);
    for (const v of [[0, 4], [24, -120], [-160, 4], [-200, -200]]) expect(formatKnobValue(offset, v).length).toBeLessThanOrEqual(knobValueReserve(offset));
    expect(knobValueReserve({ type: "point", min: 0, max: 10 })).toBe("10, 10".length);
    expect(knobValueReserve({ type: "point", unit: "pt" })).toBe("-999, -999 pt".length);
  });

  it("reserves a boolean's off and an enum's longest option, and nothing for text and colors", () => {
    expect(knobValueReserve({ type: "boolean" })).toBe(3);
    expect(knobValueReserve({ type: "enum", options: [{ key: "a", name: "Compact" }, { key: "b", name: "Comfortable" }] })).toBe("Comfortable".length);
    expect(knobValueReserve({ type: "enum" })).toBe(0);
    expect(knobValueReserve({ type: "text" })).toBe(0);
    expect(knobValueReserve({ type: "color" })).toBe(0);
  });
});
