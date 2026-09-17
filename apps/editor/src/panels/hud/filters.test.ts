import { describe, expect, it } from "vitest";
import { isFiltered, toggleFilter } from "./filters.ts";

describe("toggleFilter", () => {
  const all = { error: true, warning: true, info: true };

  it("toggles one key", () => {
    expect(toggleFilter(all, "info")).toEqual({ error: true, warning: true, info: false });
    expect(isFiltered(toggleFilter(all, "info"))).toBe(true);
    expect(isFiltered(all)).toBe(false);
  });

  it("never hides everything", () => {
    const onlyErrors: Record<"error" | "warning" | "info", boolean> = { error: true, warning: false, info: false };
    expect(toggleFilter(onlyErrors, "error")).toEqual(all);
  });

  it("solos a key, and un-solos it on a second solo", () => {
    const solo = toggleFilter(all, "warning", true);
    expect(solo).toEqual({ error: false, warning: true, info: false });
    expect(toggleFilter(solo, "warning", true)).toEqual(all);
  });
});
