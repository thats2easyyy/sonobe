import { describe, expect, it } from "vitest";
import { cssGradient } from "./gradient.ts";
import { cssTransform, projectPoint, unprojectPoint } from "./matrix.ts";
import { buildFragmentSource, parseShaderLog, uniformVector } from "./shader.ts";
import { squirclePath } from "./squircle.ts";
import { cssColor, parseColor, propReader, readAssetUrl, readGradient, readLayerRef, readShapePath } from "./values.ts";

describe("values", () => {
  it("parses colors in every encoding", () => {
    expect(parseColor("#FF000080")).toEqual({ r: 1, g: 0, b: 0, a: 128 / 255 });
    expect(parseColor("#0f0")).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    expect(parseColor({ r: 0.5, g: 0.5, b: 0.5 })).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
    expect(parseColor([0, 0, 1, 0.5])).toEqual({ r: 0, g: 0, b: 1, a: 0.5 });
    expect(parseColor("nope")).toBeNull();
    expect(cssColor({ r: 2, g: -1, b: 0.5, a: 0.8 }, 0.5)).toBe("rgba(255, 0, 128, 0.4)");
  });

  it("reads assets, gradients, shapes, and layer refs", () => {
    const resolve = (id: string) => `blob:${id}`;
    expect(readAssetUrl({ assetId: "a" }, resolve)).toBe("blob:a");
    expect(readAssetUrl({ asset: "b" }, resolve)).toBe("blob:b");
    expect(readAssetUrl({ url: "https://x" }, resolve)).toBe("https://x");
    expect(readAssetUrl(null, resolve)).toBeNull();
    const g = readGradient({ gradient: { kind: "radial", stops: [[1, "#000000FF"], [0, "#FFFFFFFF"]], start: [0.5, 0.5], end: [1, 1] } })!;
    expect(g.kind).toBe("radial");
    expect(g.stops.map((s) => s.offset)).toEqual([0, 1]);
    expect(readShapePath({ path: "M0 0" })).toBe("M0 0");
    expect(readShapePath("  ")).toBeNull();
    expect(readLayerRef({ layer: "card" })).toEqual({ layerId: "card" });
    expect(readLayerRef({ layerId: "row", instance: 2 })).toEqual({ layerId: "row", instance: 2 });
  });

  it("falls back to layer spec defaults", () => {
    const p = propReader("text", {});
    expect(p.num("fontSize")).toBe(17);
    expect(p.str("fontFamily")).toBe("Inter");
    expect(p.color("textColor")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(p.vec("position", 2)).toEqual([0, 0]);
    expect(propReader("rectangle", { cornerRadius: null }).num("cornerRadius")).toBe(0);
  });
});

describe("cssGradient", () => {
  const stops = [
    { offset: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { offset: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
  ];

  it("places linear stops exactly between start and end", () => {
    expect(cssGradient({ kind: "linear", stops, start: [0, 0.5], end: [1, 0.5] }, 200, 100)).toBe("linear-gradient(90deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)");
    expect(cssGradient({ kind: "linear", stops, start: [0.25, 0.5], end: [0.75, 0.5] }, 200, 100)).toBe("linear-gradient(90deg, rgba(255, 0, 0, 1) 25%, rgba(0, 0, 255, 1) 75%)");
    const diagonal = cssGradient({ kind: "linear", stops, start: [0, 0], end: [1, 1] }, 100, 100);
    expect(diagonal).toMatch(/^linear-gradient\(135deg, rgba\(255, 0, 0, 1\) 0%, rgba\(0, 0, 255, 1\) 100%\)$/);
  });

  it("maps radial and angular gradients", () => {
    expect(cssGradient({ kind: "radial", stops, start: [0.5, 0.5], end: [0.5, 1] }, 200, 100)).toBe("radial-gradient(circle 50px at 100px 50px, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)");
    expect(cssGradient({ kind: "angular", stops, start: [0.5, 0.5], end: [1, 0.5] }, 200, 100)).toBe("conic-gradient(from 90deg at 100px 50px, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)");
  });

  it("handles single stops and zero-length lines", () => {
    expect(cssGradient({ kind: "linear", stops: [stops[0]!], start: [0, 0], end: [1, 0] }, 10, 10)).toBe("linear-gradient(90deg, rgba(255, 0, 0, 1) 0%, rgba(255, 0, 0, 1) 100%)");
    expect(cssGradient({ kind: "linear", stops, start: [0.5, 0.5], end: [0.5, 0.5] }, 10, 10)).toBe("linear-gradient(rgba(0, 0, 255, 1), rgba(0, 0, 255, 1))");
  });
});

describe("squirclePath", () => {
  it("draws circular arcs at smoothing 0 and longer curves when smoothed", () => {
    const plain = squirclePath(0, 0, 100, 100, [20, 20, 20, 20], 0);
    expect(plain.startsWith("M 80 0")).toBe(true);
    expect(plain.endsWith("Z")).toBe(true);
    const smooth = squirclePath(0, 0, 100, 100, [20, 20, 20, 20], 0.6);
    expect(smooth.startsWith("M 68 0")).toBe(true);
  });

  it("clamps radii and smoothing to the available room", () => {
    const pill = squirclePath(0, 0, 200, 40, [100, 100, 100, 100], 1);
    expect(pill).not.toMatch(/NaN|Infinity/);
    expect(pill.startsWith("M 180 0")).toBe(true);
    expect(squirclePath(0, 0, 0, 0, [10, 10, 10, 10], 0.5)).not.toMatch(/NaN/);
    expect(squirclePath(5, 5, 50, 50, [0, 0, 0, 0], 1)).toMatch(/^M 55 5 l 0 0 L 55 5/);
  });
});

describe("matrix", () => {
  it("writes affine matrices as matrix() and others as matrix3d()", () => {
    expect(cssTransform([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 10, -0.0000001, 0, 1])).toBe("matrix(2, 0, 0, 2, 10, 0)");
    expect(cssTransform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -0.001, 0, 0, 0, 1])).toMatch(/^matrix3d\(/);
  });

  it("unprojects points through rotation and perspective", () => {
    const c = Math.cos(0.4), s = Math.sin(0.4);
    const m = [c, s, 0, 0.0008, -s, c, 0, -0.0005, 0, 0, 1, 0, 40, 60, 0, 1];
    const world = projectPoint(m, 25, 75);
    const local = unprojectPoint(m, world[0], world[1])!;
    expect(local[0]).toBeCloseTo(25, 6);
    expect(local[1]).toBeCloseTo(75, 6);
  });
});

describe("shader source", () => {
  it("wraps mainImage with uniforms and a top-left fragCoord", () => {
    const code = "void mainImage(out vec4 c, in vec2 p) {\n  c = vec4(p / iResolution.xy, 0.0, 1.0);\n}";
    const { source, lineOffset, userLines } = buildFragmentSource(code);
    expect(source.startsWith("#version 300 es")).toBe(true);
    expect(source).toContain("uniform vec4 iMouse;");
    expect(source).toContain("iResolution.y - gl_FragCoord.y");
    expect(source.split("\n")[lineOffset]).toBe("void mainImage(out vec4 c, in vec2 p) {");
    expect(userLines).toBe(3);
  });

  it("passes complete shaders through and blanks duplicate builtin uniforms", () => {
    const full = "#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main(){o=vec4(1);}";
    expect(buildFragmentSource(full).source).toBe(full);
    const withMain = buildFragmentSource("uniform float iTime;\nout vec4 o;\nvoid main(){o=vec4(iTime);}");
    expect(withMain.source).not.toContain("sonobe_fragColor");
    expect(withMain.source.match(/uniform float iTime;/g)!.length).toBe(1);
    expect(withMain.source.split("\n")[withMain.lineOffset + 1]).toBe("out vec4 o;");
  });

  it("maps log line numbers back to user code", () => {
    const { lineOffset, userLines } = buildFragmentSource("void mainImage(out vec4 c, in vec2 p) {\n  c = vec4(foo);\n}");
    const err = parseShaderLog(`ERROR: 0:${lineOffset + 2}: 'foo' : undeclared identifier\nERROR: 0:${lineOffset + 2}: '' : compilation terminated`, lineOffset, userLines);
    expect(err.line).toBe(2);
    expect(err.message.split("\n")[0]).toBe("Line 2: 'foo' : undeclared identifier");
    expect(parseShaderLog("link failed", 0, 1)).toEqual({ message: "link failed", line: null });
  });

  it("normalizes uniform values", () => {
    expect(uniformVector({ r: 1, g: 0.5, b: 0, a: 1 }, 3)).toEqual([1, 0.5, 0]);
    expect(uniformVector([1, 2], 4)).toEqual([1, 2, 0, 0]);
    expect(uniformVector(0.5, 2)).toEqual([0.5, 0.5]);
    expect(uniformVector(true, 1)).toEqual([1]);
  });
});
