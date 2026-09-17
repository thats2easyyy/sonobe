import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FAR_ZOOM, isFarZoom } from "./model/geometry.ts";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "patch-editor.css"), "utf8");

describe("patch editor far-zoom level of detail", () => {
  it("switches below FAR_ZOOM", () => {
    expect(isFarZoom(0.12)).toBe(true);
    expect(isFarZoom(FAR_ZOOM - 0.01)).toBe(true);
    expect(isFarZoom(FAR_ZOOM)).toBe(false);
    expect(isFarZoom(1)).toBe(false);
  });

  it("stops painting labels and values at far zoom but keeps handles and node boxes", () => {
    const rule = css.match(/\.sb-pe__canvas\[data-lod="far"\]\s*:is\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const selectors = rule![1]!.split(",").map((s) => s.trim());
    expect(selectors).toEqual(expect.arrayContaining([".sb-pe-port__label", ".sb-pe-value", ".sb-pe-port__live"]));
    // Handles must stay measurable and hoverable, and node boxes must still draw.
    expect(selectors.some((s) => s.startsWith(".sb-pe-handle") || s === ".sb-pe-node" || s === ".sb-pe-node__header")).toBe(false);
    // visibility keeps layout (handle positions); display: none would move cables.
    expect(rule![2]).toContain("visibility: hidden");
    expect(rule![2]).not.toContain("display");
  });
});
