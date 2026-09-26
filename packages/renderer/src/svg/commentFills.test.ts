import { readFileSync } from "node:fs";
import { componentNodeBoxes, deriveGraph } from "@sonobe/core/graph";
import { buildDoc, createMockRegistry } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { COMMENT_COLORS } from "../theme.ts";
import { COMMENT_FILLS, graphToSvg } from "./graphToSvg.ts";

const editorCss = readFileSync(new URL("../../../../apps/editor/src/panels/patch-editor/patch-editor.css", import.meta.url), "utf8");

const tokenBlock = (selector: string) => {
  const start = editorCss.indexOf(selector);
  return editorCss.slice(editorCss.indexOf("{", start) + 1, editorCss.indexOf("}", start));
};

const fillTokens = (selector: string) => Object.fromEntries([...tokenBlock(selector).matchAll(/--sb-comment-fill-(?!mix)([a-z]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim().toUpperCase()]));

/** OKLCH hue in degrees of a #RRGGBB color. */
function hue(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.782771766 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

describe("comment frame fills", () => {
  it.each(["dark", "light"] as const)("match patch-editor.css in %s", (theme) => {
    const css = theme === "dark" ? fillTokens(".sb-pe {") : fillTokens('[data-theme="light"] .sb-pe,');
    const expected = Object.fromEntries((["yellow", "orange", "pink"] as const).map((name) => [name, COMMENT_FILLS[theme][name]!.toUpperCase()]));
    expect(css).toEqual(expected);
  });

  it.each(["dark", "light"] as const)("tint the frame by the mix patch-editor.css uses in %s", (theme) => {
    const mix = /--sb-comment-fill-mix:\s*([\d.]+)%/.exec(tokenBlock(theme === "dark" ? ".sb-pe {" : '[data-theme="light"] .sb-pe,'));
    const doc = buildDoc({ ops: [{ op: "addComment", comment: { id: "frame", text: "", rect: [0, 0, 200, 100], color: "yellow" } }] }, createMockRegistry());
    const { svg } = graphToSvg(deriveGraph({ doc, componentId: "main", registry: createMockRegistry() }), { boxes: componentNodeBoxes(doc, createMockRegistry(), "main"), theme });
    expect(svg).toContain(`fill="${COMMENT_FILLS[theme].yellow}" fill-opacity="${Number(mix![1]) / 100}"`);
  });

  it.each(["dark", "light"] as const)("keep the other colors at their title color in %s", (theme) => {
    for (const name of ["gray", "purple", "blue", "green"] as const) expect(COMMENT_FILLS[theme][name]).toBe(COMMENT_COLORS[theme][name]);
  });

  it.each(["dark", "light"] as const)("keep yellow, orange and pink at least 25 degrees apart in %s", (theme) => {
    const [y, o, p] = (["yellow", "orange", "pink"] as const).map((name) => hue(COMMENT_FILLS[theme][name]!));
    const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    expect(apart(y!, o!)).toBeGreaterThanOrEqual(25);
    expect(apart(o!, p!)).toBeGreaterThanOrEqual(25);
    expect(apart(y!, p!)).toBeGreaterThanOrEqual(25);
  });
});
