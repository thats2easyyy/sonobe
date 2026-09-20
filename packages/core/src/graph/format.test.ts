import { describe, expect, it } from "vitest";
import { formatKnobValue } from "../knobs.ts";
import type { EnumOption, ValueType } from "../types.ts";
import { formatNumberShort, formatValue, formatValueLong, formatValueReserve, KNOB_RESERVE_MAX_CHARS, knobValueReserve, NUMBER_SHORT_CHARS, pickCopy } from "./format.ts";

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
  const numbers = [0, 0.5, -0.001, 1.04, -12.35, 100, -1234.567, 99999.94, -99999.9, 123456, -999999, 1234567, -999999999, Infinity, -Infinity, NaN];

  it("reserves the longest text of the port's type", () => {
    expect(formatValueReserve(0.5, "number", live)).toBe(NUMBER_SHORT_CHARS);
    expect(formatValueReserve(3, "index", live)).toBe(8);
    expect(formatValueReserve(false, "boolean", live)).toBe("Off".length);
    expect(formatValueReserve({ r: 1, g: 0, b: 0, a: 1 }, "color", live)).toBe("#RRGGBBAA".length);
    expect(formatValueReserve("Hi", "text", live)).toBe(12);
    expect(formatValueReserve("layer_1", "layer", live)).toBe(10);
    expect(formatValueReserve({ assetId: "a" }, "image", live)).toBe(10);
    expect(formatValueReserve([0, 0], "point", live)).toBe(18);
    expect(formatValueReserve(null, "number", live)).toBe(8);
  });

  it("reserves nothing when nothing prints: no value, or a pulse", () => {
    expect(formatValueReserve(undefined, "number", live)).toBe(0);
    expect(formatValueReserve(true, "pulse", live)).toBe(0);
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

  it("reserves a loop's ×N summary, or the watched copy's #k prefix, around one item", () => {
    const loop12 = loop(...Array.from({ length: 12 }, (_, i) => i * 1.5));
    expect(formatValueReserve(loop12, "number", live)).toBe("×12 ".length + 8 + "…".length);
    expect(formatValueReserve(loop12, "number", { ...live, copy: 3 })).toBe("#11 ".length + 8);
    expect(formatValueReserve(loop(true, false), "boolean", live)).toBe("×2 Off…".length);
    expect(formatValueReserve(loop("a"), "text", live)).toBe("×1 ".length + 10 + "…".length);
    expect(formatValueReserve(loop(), "number", live)).toBe("×0 ".length + 8 + "…".length);
  });

  it("is never shorter than what formatValue prints, for any value of the type", () => {
    const easing: EnumOption[] = [
      { key: "quadraticInOut", name: "Quadratic In & Out" },
      { key: "linear", name: "Linear" },
    ];
    const samples: [unknown, ValueType, EnumOption[]?][] = [
      ...numbers.flatMap((n): [unknown, ValueType][] => [
        [n, "number"],
        [Math.round(n), "index"],
        [[n, n], "point"],
        [[n, -n, n], "point3d"],
        [n, "json"],
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
      const values = loop(value, value, value);
      for (const copy of [null, 0, 2, 7]) {
        const text = formatValue(values, type, { ...options, copy });
        expect(text.length, `${type} loop ${text}`).toBeLessThanOrEqual(formatValueReserve(values, type, { ...options, copy }));
      }
    }
  });

  it("gives every number formatNumberShort prints at most 8 characters", () => {
    for (const n of numbers) expect(formatNumberShort(n).length).toBeLessThanOrEqual(NUMBER_SHORT_CHARS);
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
  });

  it("keeps at most 7 characters, so the knob's name keeps room in the chip", () => {
    expect(knobValueReserve({ type: "number", min: 0, max: 1, step: 1e-7 })).toBe(KNOB_RESERVE_MAX_CHARS);
    expect(knobValueReserve({ type: "number", min: -1000, max: 1000, step: 0.5, unit: "pt" })).toBe(7);
  });

  it("covers every value the slider snaps to", () => {
    const knob = { type: "number" as const, min: -2, max: 12, step: 0.25, unit: "s" };
    const reserve = knobValueReserve(knob);
    for (let i = 0; knob.min + i * knob.step <= knob.max; i++) expect(formatKnobValue(knob, knob.min + i * knob.step).length).toBeLessThanOrEqual(reserve);
  });

  it("reserves a boolean's off, and nothing for values picked from a menu or typed", () => {
    expect(knobValueReserve({ type: "boolean" })).toBe(3);
    expect(knobValueReserve({ type: "enum" })).toBe(0);
    expect(knobValueReserve({ type: "number" })).toBe(0);
    expect(knobValueReserve({ type: "number", min: 0 })).toBe(0);
    expect(knobValueReserve({ type: "text" })).toBe(0);
    expect(knobValueReserve({ type: "point", min: 0, max: 10 })).toBe(0);
  });
});
