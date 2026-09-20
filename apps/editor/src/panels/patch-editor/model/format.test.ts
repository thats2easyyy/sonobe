import { describe, expect, it } from "vitest";
import { formatValue, formatValueLong, pickCopy } from "./format.ts";

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
