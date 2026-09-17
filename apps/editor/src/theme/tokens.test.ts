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
