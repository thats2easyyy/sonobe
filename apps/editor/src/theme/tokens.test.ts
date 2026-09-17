import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_COLORS,
  CONTROL_HEIGHT,
  DURATION,
  EASING,
  FONT_SIZE,
  PATCH_CATEGORIES,
  PORT_COLOR_GROUPS,
  PORT_GROUP_COLORS,
  PORT_GROUP_GLYPH,
  PORT_TYPE_GROUP,
  RADIUS,
  SPACING,
  THEME_TOKENS,
  THEMES,
  Z_INDEX,
  portColor,
  portColorVar,
  type ThemeName,
} from "./tokens.ts";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars: Record<string, string> = {};
  for (const match of css.slice(open + 1, close).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    vars[match[1]!] = match[2]!.trim().replace(/\s+/g, " ");
  }
  return vars;
}

const themeBlocks: Record<ThemeName, Record<string, string>> = {
  dark: block(':root,\n[data-theme="dark"]'),
  light: block('[data-theme="light"]'),
};

describe("tokens.css ↔ tokens.ts", () => {
  it("defines the same variables in both themes", () => {
    expect(Object.keys(themeBlocks.light).sort()).toEqual(Object.keys(themeBlocks.dark).sort());
  });

  it.each(THEMES)("matches semantic, port, and category colors for %s", (theme) => {
    const expected: Record<string, string> = { ...THEME_TOKENS[theme] };
    for (const group of PORT_COLOR_GROUPS) expected[`port-${group}`] = PORT_GROUP_COLORS[theme][group];
    for (const category of PATCH_CATEGORIES) expected[`category-${category}`] = CATEGORY_COLORS[theme][category];
    expect(themeBlocks[theme]).toEqual(expected);
  });

  it("matches the theme-independent scales", () => {
    const root = block(":root {");
    SPACING.forEach((px, i) => expect(root[`space-${i}`]).toBe(`${px}px`));
    for (const [key, px] of Object.entries(RADIUS)) expect(root[`radius-${key}`]).toBe(`${px}px`);
    for (const [key, px] of Object.entries(FONT_SIZE)) expect(root[`font-size-${key}`]).toBe(`${px}px`);
    for (const [key, px] of Object.entries(CONTROL_HEIGHT)) expect(root[`control-h-${key}`]).toBe(`${px}px`);
    for (const [key, z] of Object.entries(Z_INDEX)) expect(root[`z-${key}`]).toBe(String(z));
    for (const [key, ms] of Object.entries(DURATION)) expect(root[`duration-${key}`]).toBe(`${ms}ms`);
    const easingNames: Record<keyof typeof EASING, string> = { out: "ease-out", inOut: "ease-in-out", standard: "ease-standard", in: "ease-in", spring: "ease-spring" };
    for (const [key, value] of Object.entries(EASING)) expect(root[easingNames[key as keyof typeof EASING]]).toBe(value);
  });
});

describe("port palette", () => {
  it("covers every value type and group", () => {
    const groups = new Set(Object.values(PORT_TYPE_GROUP));
    expect([...groups].sort()).toEqual([...PORT_COLOR_GROUPS].sort());
    for (const group of PORT_COLOR_GROUPS) expect(PORT_GROUP_GLYPH[group]).toBeDefined();
  });

  it("uses a distinct color for every group in each theme", () => {
    for (const theme of THEMES) {
      const colors = Object.values(PORT_GROUP_COLORS[theme]);
      expect(new Set(colors).size).toBe(colors.length);
    }
  });

  it("resolves port colors and variables", () => {
    expect(portColorVar("point3d")).toBe("var(--port-vector)");
    expect(portColorVar("variant")).toBe("var(--port-any)");
    expect(portColor("enum", "light")).toBe(PORT_GROUP_COLORS.light.index);
  });
});

/** WCAG relative luminance of an sRGB color (0–1 channels). */
function luminance([r, g, b]: readonly number[]): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

/** "#RRGGBB" or "rgba(r, g, b, a)" → [r, g, b, a] in 0–1. */
function parseColor(value: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16) / 255).concat(1) as [number, number, number, number];
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (rgba) return [Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255, Number(rgba[4])];
  throw new Error(`Can't parse ${value}`);
}

/** A translucent color over an opaque one. */
const over = (top: readonly number[], base: readonly number[]) => [0, 1, 2].map((i) => top[i]! * top[3]! + base[i]! * (1 - top[3]!));

const contrast = (a: readonly number[], b: readonly number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("text contrast (WCAG AA, 4.5:1 for small text)", () => {
  const SURFACES = ["bg-window", "bg-toolbar", "bg-panel", "bg-sunken", "bg-elevated", "canvas-bg", "patch-node-bg"] as const;

  it.each(THEMES)("secondary and tertiary text pass on every %s surface, including fields over the toolbar", (theme) => {
    const tokens = THEME_TOKENS[theme];
    const surfaces: Record<string, readonly number[]> = Object.fromEntries(SURFACES.map((name) => [name, parseColor(tokens[name])]));
    surfaces["bg-field over bg-toolbar"] = over(parseColor(tokens["bg-field"]), parseColor(tokens["bg-toolbar"]));
    const failures: string[] = [];
    for (const text of ["text-secondary", "text-tertiary"] as const) {
      const color = parseColor(tokens[text]);
      for (const [surface, background] of Object.entries(surfaces)) {
        const ratio = contrast(color, background);
        if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(THEMES)("white numbers on the accent-pressed fill (the canvas size pill) pass in %s", (theme) => {
    expect(contrast([1, 1, 1], parseColor(THEME_TOKENS[theme]["accent-pressed"]))).toBeGreaterThanOrEqual(4.5);
  });
});
