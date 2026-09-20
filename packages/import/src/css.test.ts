import { describe, expect, it } from "vitest";
import { clampRadii, collapseWhitespace, coversLatin, mergeFontWeights, parseBackgroundImages, parseBoxShadows, parseFontFaceRules, parseFontFamilies, parseGradient, parseRadius, parseRgb, parseTransform, pickFontSource, splitTopLevel, titleize } from "./css.ts";

const color = (css: string) => parseRgb(css) ?? (css === "red" ? "#FF0000FF" : css === "blue" ? "#0000FFFF" : null);

describe("splitTopLevel", () => {
  it("splits outside parentheses and quotes", () => {
    expect(splitTopLevel("rgb(0, 0, 0) 0px 1px, rgba(0,0,0,.1) 0 2px", ",")).toEqual(["rgb(0, 0, 0) 0px 1px", "rgba(0,0,0,.1) 0 2px"]);
    expect(splitTopLevel('url("a,b.png"), none', ",")).toEqual(['url("a,b.png")', "none"]);
    expect(splitTopLevel("  a   b(c d)  e ", " ")).toEqual(["a", "b(c d)", "e"]);
  });
});

describe("colors", () => {
  it("reads rgb and rgba in both syntaxes", () => {
    expect(parseRgb("rgb(255, 59, 48)")).toBe("#FF3B30FF");
    expect(parseRgb("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
    expect(parseRgb("rgb(0 128 255 / 25%)")).toBe("#0080FF40");
    expect(parseRgb("transparent")).toBe("#00000000");
    expect(parseRgb("oklch(0.6 0.2 250)")).toBeNull();
  });
});

describe("box shadows", () => {
  it("reads Tailwind's layered shadows front first, with inset and spread", () => {
    expect(parseBoxShadows("rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px", color)).toEqual([
      { x: 0, y: 10, blur: 15, spread: -3, color: "#0000001A" },
      { x: 0, y: 4, blur: 6, spread: -4, color: "#0000001A" },
    ]);
    expect(parseBoxShadows("rgb(59, 130, 246) 0px 0px 0px 2px inset", color)).toEqual([{ x: 0, y: 0, blur: 0, spread: 2, color: "#3B82F6FF", inset: true }]);
    expect(parseBoxShadows("none", color)).toEqual([]);
  });
});

describe("gradients", () => {
  it("maps a linear angle onto start and end points in the box", () => {
    expect(parseGradient("linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))", color, 100, 200)).toEqual({ kind: "linear", stops: [[0, "#FF0000FF"], [1, "#0000FFFF"]], start: [0.5, 0], end: [0.5, 1] });
    const right = parseGradient("linear-gradient(90deg, red 20%, blue 80%)", color, 100, 50)!;
    expect(right.start).toEqual([0, 0.5]);
    expect(right.end).toEqual([1, 0.5]);
    expect(right.stops).toEqual([[0.2, "#FF0000FF"], [0.8, "#0000FFFF"]]);
  });

  it("handles magic corners, interpolation spaces and missing stop positions", () => {
    const corner = parseGradient("linear-gradient(to top right in oklab, red, rgb(0, 255, 0), blue)", color, 100, 100)!;
    expect(corner.stops.map((s) => s[0])).toEqual([0, 0.5, 1]);
    expect(corner.start[0]).toBeLessThan(0.5);
    expect(corner.end[1]).toBeLessThan(0.5);
  });

  it("reads radial and conic gradients", () => {
    const radial = parseGradient("radial-gradient(circle at 30% 30%, red, blue)", color, 100, 100)!;
    expect(radial.kind).toBe("radial");
    expect(radial.start).toEqual([0.3, 0.3]);
    expect(radial.end[1]).toBeGreaterThan(0.3);
    expect(parseGradient("conic-gradient(from 90deg, red, blue)", color, 100, 100)!.kind).toBe("angular");
    expect(parseGradient("image-set(url(a.png) 1x)", color, 10, 10)).toBeNull();
  });

  it("splits background layers into gradients and an image", () => {
    const layers = parseBackgroundImages('linear-gradient(red, blue), url("https://example.com/hero.jpg")', color, 100, 100);
    expect(layers.url).toBe("https://example.com/hero.jpg");
    expect(layers.gradients).toHaveLength(1);
  });
});

describe("transforms, radii and text", () => {
  it("reads rotation and scale from a matrix", () => {
    const t = parseTransform("matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)")!;
    expect(t.rotation).toBeCloseTo(45);
    expect(t.scale).toBeCloseTo(1);
    expect(parseTransform("matrix(1, 0, 0, 1, 20, 0)")).toBeNull();
    expect(parseTransform("matrix(2, 0, 0, 1, 0, 0)")!.approximate).toBe(true);
  });

  it("resolves percentages and clamps overlapping corners like CSS", () => {
    expect(parseRadius("50%", 88, 88)).toBe(44);
    expect(parseRadius("12px 8px", 100, 100)).toBe(8);
    expect(clampRadii([9999, 9999, 9999, 9999], 120, 40)).toEqual([20, 20, 20, 20]);
  });

  it("collapses whitespace per white-space and titleizes ids", () => {
    expect(collapseWhitespace("  Hello \n   world ", "normal")).toBe(" Hello world ");
    expect(collapseWhitespace("a  \n  b", "pre-line")).toBe("a\nb");
    expect(titleize("checkout-form_v2")).toBe("Checkout Form V2");
    expect(titleize("followButton")).toBe("Follow Button");
  });
});

describe("fonts", () => {
  it("reads family stacks and picks the best downloadable source", () => {
    expect(parseFontFamilies('"Inter Variable", ui-sans-serif, \'SF Pro\', system-ui')).toEqual(["Inter Variable", "ui-sans-serif", "SF Pro", "system-ui"]);
    expect(pickFontSource('local("Inter"), url(/fonts/inter.woff) format("woff"), url("/fonts/inter.woff2") format("woff2")', "http://localhost:3000/app/")).toBe("http://localhost:3000/fonts/inter.woff2");
    expect(pickFontSource('local("Arial")', "http://localhost/")).toBeNull();
    expect(pickFontSource("url(a.ttf)", "http://x.test/css/site.css")).toBe("http://x.test/css/a.ttf");
  });

  it("keeps Latin subsets of split families", () => {
    expect(coversLatin("U+0000-00FF, U+0131")).toBe(true);
    expect(coversLatin("U+0400-045F, U+0490-0491")).toBe(false);
    expect(coversLatin(undefined)).toBe(true);
  });

  it("merges the weights of faces that share a file into a range", () => {
    expect(mergeFontWeights("400", "700")).toBe("400 700");
    expect(mergeFontWeights("400 700", "600")).toBe("400 700");
    expect(mergeFontWeights("600", "300 500")).toBe("300 600");
    expect(mergeFontWeights(undefined, "bold")).toBe("400 700");
    expect(mergeFontWeights("100 900", undefined)).toBe("100 900");
    // A single weight stays as it is.
    expect(mergeFontWeights("400", "400")).toBe("400");
    expect(mergeFontWeights(undefined, "normal")).toBeUndefined();
    expect(mergeFontWeights("400", "bolder")).toBe("400");
  });

  it("parses @font-face rules from stylesheet text", () => {
    const css = `/* latin */\n@font-face { font-family: 'Geist'; font-style: normal; font-weight: 100 900; src: url(https://fonts.gstatic.com/s/geist.woff2) format('woff2'); unicode-range: U+0000-00FF; }\nbody { color: red }`;
    expect(parseFontFaceRules(css)).toEqual([{ family: "Geist", src: "url(https://fonts.gstatic.com/s/geist.woff2) format('woff2')", weight: "100 900", style: "normal", unicodeRange: "U+0000-00FF" }]);
  });
});
