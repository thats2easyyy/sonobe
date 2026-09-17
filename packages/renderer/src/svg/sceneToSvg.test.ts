/** sceneToSvg on scenes the engine produces (and a few hand-written frames). Runs without a DOM. */

import { createEmptyDocument } from "@sonobe/core";
import type { LayerNode, SonobeDocument } from "@sonobe/core";
import { createApproximateTextMeasurer, createEngineRegistry, createRuntime } from "@sonobe/engine";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { affineFromMat4, invertAffine, multiplyAffine, transformRect } from "./affine.ts";
import { pathDataLength } from "./pathLength.ts";
import { findSceneNode, renderSceneSvg, sceneNodeBounds, sceneToSvg } from "./sceneToSvg.ts";
import { approximateTextWidth, truncateLines, wrapText, type SvgTextStyle } from "./text.ts";

const layer = (id: string, type: string, props: Record<string, unknown>, children: LayerNode[] = []): LayerNode => ({ id, type, name: id, props, children }) as LayerNode;

function engineScene(layers: LayerNode[]): SceneFrame {
  const doc: SonobeDocument = createEmptyDocument();
  doc.components[doc.project.root]!.layers = layers;
  const runtime = createRuntime(doc, { registry: createEngineRegistry([]), deterministic: true, fps: 60 });
  try {
    return runtime.step();
  } finally {
    runtime.dispose();
  }
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

function frameOf(nodes: SceneNode[], size: [number, number] = [200, 100]): SceneFrame {
  return { frame: 0, time: 0, size, background: { r: 1, g: 1, b: 1, a: 1 }, roots: nodes };
}

function node(key: string, type: string, props: Record<string, unknown>, box: [number, number, number, number]): SceneNode {
  const [x, y, width, height] = box;
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];
  return { key, layerId: key, type, parentKey: null, x, y, width, height, transform: m, worldTransform: m, opacity: 1, visible: true, clip: false, props: props as SceneNode["props"], children: [] };
}

describe("sceneToSvg", () => {
  const scene = engineScene([
    layer("card", "group", { position: [20, 40], size: [200, 100], color: "#FFFFFFFF" }, [
      layer("badge", "rectangle", { position: [10, 10], size: [20, 20], color: "#FF0000FF", rotation: 45 }),
      layer("dot", "oval", { position: [150, 30], size: [40, 20], color: "#00FF0080" }),
    ]),
  ]);

  it("nests layers with transforms derived from world transforms", () => {
    const { svg, width, height, notes } = renderSceneSvg(scene);
    expect([width, height]).toEqual(scene.size);
    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.size[0]}" height="${scene.size[1]}"`)).toBe(true);
    expect(svg).toContain('<g data-layer="card" transform="translate(20 40)"><rect width="200" height="100" fill="#ffffff"/>');
    expect(svg).toContain('<g data-layer="badge" transform="matrix(0.707107 0.707107 -0.707107 0.707107 20 5.857864)"><rect width="20" height="20" fill="#ff0000"/></g>');
    expect(svg).toContain('<ellipse cx="20" cy="10" rx="20" ry="10" fill="#00ff00" fill-opacity="0.502"/>');
    expect(notes).toEqual([]);
    expect(sceneToSvg(scene)).toBe(svg);
    expect(sceneNodeBounds(findSceneNode(scene, "card")!)).toEqual({ x: 20, y: 40, width: 200, height: 100 });
  });

  it("crops, scales, changes the background and overlays touch targets", () => {
    const r = renderSceneSvg(scene, { crop: { x: 20, y: 40, width: 200, height: 100 }, scale: 2, background: null, showHitTargets: ["badge"] });
    expect([r.width, r.height]).toEqual([400, 200]);
    expect(r.svg).toContain('viewBox="20 40 200 100"');
    expect(r.svg).not.toContain('<rect x="20" y="40"');
    expect(count(r.svg, 'fill="#7C5CFF"')).toBe(1);
    const far = frameOf([node("far", "rectangle", { color: "#FF0000FF", opacity: 0.5 }, [2000, 0, 10, 10]), node("near", "rectangle", { color: "#FF0000FF" }, [195, 0, 10, 10])]);
    const culled = sceneToSvg(far);
    expect(culled).not.toContain('data-layer="far"');
    expect(culled).toContain('data-layer="near"');
    expect(sceneToSvg(far, { crop: { x: 1990, y: 0, width: 50, height: 50 } })).toContain('data-layer="far"');
    const red = renderSceneSvg(scene, { background: "#FF0000FF" }).svg;
    expect(red).toContain(`<rect x="0" y="0" width="${scene.size[0]}" height="${scene.size[1]}" fill="#ff0000"/>`);
  });

  it("clips groups with rounded or smooth corners and draws strokes as rings", () => {
    const svg = sceneToSvg(
      engineScene([
        layer("round", "group", { size: [100, 100], clip: true, cornerRadius: 16, color: "#000000FF" }, [layer("inside", "rectangle", { position: [-10, -10], size: [50, 50] })]),
        layer("smooth", "group", { position: [0, 200], size: [100, 100], clip: true, cornerRadius: 24, cornerSmoothing: 0.6 }, [layer("inside_2", "rectangle", { size: [50, 50] })]),
        layer("framed", "rectangle", { position: [0, 400], size: [100, 50], cornerRadius: 8, strokeWidth: 4, strokeColor: "#0000FFFF", strokePosition: "outside" }),
      ]),
    );
    expect(svg).toMatch(/<clipPath id="(clip\d+)"><rect width="100" height="100" rx="16"\/><\/clipPath>/);
    expect(svg).toMatch(/<g clip-path="url\(#clip\d+\)"><rect width="100" height="100" rx="16" fill="#000000"\/><g data-layer="inside"/);
    expect(svg).toMatch(/<clipPath id="clip\d+"><path d="M [\d.]+ 0 c /);
    expect(svg).toMatch(/<path d="M 92 -4 [^"]+ M 92 0 [^"]+" fill="#0000ff" fill-rule="evenodd"\/>/);
  });

  it("paints gradients, box shadows, drop shadows, blur and blend modes", () => {
    const svg = sceneToSvg(
      engineScene([
        layer("sky", "rectangle", { size: [100, 200], gradient: { gradient: { kind: "linear", stops: [[0, "#FF0000FF"], [1, "#0000FFFF"]], start: [0.5, 0], end: [0.5, 1] } } }),
        layer("sun", "rectangle", { position: [0, 300], size: [50, 50], color: "#FFFFFFFF", shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: [0, 8], blendMode: "multiply" }),
        layer("glass", "rectangle", { position: [100, 300], size: [50, 50], color: "#FFFFFF33", shadowOpacity: 1, shadowRadius: 10 }),
        layer("label", "text", { position: [0, 500], text: "Hi", textColor: "#000000FF", shadowOpacity: 1, shadowRadius: 6, blur: 2 }),
        layer("spin", "gradient", { position: [200, 0], size: [80, 80], gradient: { gradient: { kind: "angular", stops: [[0, "#FF0000FF"], [1, "#00FF00FF"]], start: [0.5, 0.5], end: [0.5, 0] } } }),
      ]),
    );
    expect(svg).toMatch(/<linearGradient id="grad\d+" gradientUnits="userSpaceOnUse" x1="50" y1="0" x2="50" y2="200"><stop offset="0" stop-color="#ff0000"\/><stop offset="1" stop-color="#0000ff"\/><\/linearGradient>/);
    expect(svg).toMatch(/<rect width="100" height="200" fill="url\(#grad\d+\)"\/>/);
    expect(svg).toMatch(/<filter id="blur\d+" filterUnits="userSpaceOnUse" x="-32" y="-32" width="114" height="114"><feGaussianBlur stdDeviation="10"\/><\/filter>/);
    expect(svg).toMatch(/<g data-layer="sun" transform="translate\(0 300\)" style="mix-blend-mode:multiply"><rect width="50" height="50" fill="#000000" fill-opacity="0.5" transform="translate\(0 8\)" filter="url\(#blur\d+\)"\/>/);
    expect(svg).toMatch(/<mask id="mask\d+" maskUnits="userSpaceOnUse"/);
    expect(svg).toMatch(/<feGaussianBlur stdDeviation="2"\/><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#000000"\/>/);
    expect(svg).toMatch(/<g clip-path="url\(#clip\d+\)">(<path d="M 40 40 L [^"]+" fill="#[0-9a-f]{6}"\/>){90}<\/g>/);
  });

  it("lays text out like headless layout: wrapping, alignment, escaping and truncation", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const style = { fontFamily: "Inter", fontSize: 17, fontWeight: 400, letterSpacing: 0, lineHeight: 0 };
    const frame = engineScene([
      layer("para", "text", { size: [120, 200], widthMode: "fixed", heightMode: "fixed", text, textAlignment: "center", textColor: "#111111FF" }),
      layer("title", "text", { position: [0, 300], text: "Tom & <Jerry>\nsecond line", fontWeight: 700, italic: true, letterSpacing: 1, textDecoration: "underline" }),
      layer("clamped", "text", { position: [0, 400], size: [60, 100], widthMode: "fixed", text: "one two three four five six", maxLines: 2 }),
    ]);
    const r = renderSceneSvg(frame);
    expect(r.hasText).toBe(true);
    expect(r.notes).toContain("Text uses approximate font metrics, so line breaks can differ slightly from the app.");
    const lines = createApproximateTextMeasurer().measure(text, style, 120).height / (17 * 1.2);
    const para = r.svg.slice(r.svg.indexOf('data-layer="para"'), r.svg.indexOf('data-layer="title"'));
    expect(count(para, "<tspan")).toBe(lines);
    expect(lines).toBeGreaterThan(2);
    expect(para).toContain('text-anchor="middle"');
    expect(para).toContain('<tspan x="60" y="16.15">The quick</tspan>');
    const title = findSceneNode(frame, "title")!;
    expect(title.height).toBeCloseTo(2 * 17 * 1.2, 5);
    expect(r.svg).toContain("font-family=\"'Inter', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif\" font-size=\"17\" font-weight=\"700\" font-style=\"italic\" letter-spacing=\"1\" text-decoration=\"underline\" xml:space=\"preserve\" fill=\"#000000\"");
    expect(r.svg).toContain(">Tom &amp; &lt;Jerry&gt;</tspan>");
    const clamped = r.svg.slice(r.svg.indexOf('data-layer="clamped"'));
    expect(count(clamped, "<tspan")).toBe(2);
    expect(clamped).toMatch(/…<\/tspan><\/text>/);
  });

  it("draws images through resolveAsset, placeholders for video, and explains what it leaves out", () => {
    const frame = engineScene([
      layer("hero", "image", { size: [80, 60], image: { asset: "photo" }, fillMode: "fit", cornerRadius: 12 }),
      layer("missing", "image", { position: [0, 100], size: [80, 60], image: { asset: "gone" } }),
      layer("clip", "video", { position: [0, 200], size: [80, 60] }),
      layer("anim", "lottie", { position: [0, 300], size: [80, 60] }),
    ]);
    const r = renderSceneSvg(frame, { resolveAsset: (ref) => (ref.assetId === "photo" ? { href: "data:image/png;base64,AAAA", width: 8, height: 6 } : null) });
    expect(r.svg).toMatch(/<g clip-path="url\(#clip\d+\)"><image width="80" height="60" href="data:image\/png;base64,AAAA" preserveAspectRatio="xMidYMid meet"\/><\/g>/);
    expect(r.svg).toContain('<rect width="80" height="60" fill="#1C1C1E"/>');
    expect(r.notes).toEqual([
      'Image "missing" isn\'t drawn: its file couldn\'t be loaded.',
      "Video layers show a dark placeholder: headless screenshots can't play video.",
      "Lottie layers aren't drawn in headless screenshots.",
    ]);
  });

  it("draws clones as copies of their source at the clone's origin", () => {
    const svg = sceneToSvg(engineScene([layer("card", "rectangle", { position: [10, 10], size: [40, 40], color: "#FF0000FF" }), layer("copy", "clone", { position: [100, 100], size: [40, 40], source: { layer: "card" } })]));
    expect(svg).toContain('<g data-layer="copy" transform="translate(100 100)"><g data-layer="card"><rect width="40" height="40" fill="#ff0000"/></g></g>');
  });

  it("trims shape strokes by path length and fills shapes", () => {
    const shape = node("line", "shape", { shape: { path: "M 0 0 L 100 0" }, color: "#00000000", strokeWidth: 2, strokeColor: "#000000FF", strokeStart: 0.25, strokeEnd: 0.75, lineCap: "butt" }, [10, 10, 100, 10]);
    const svg = sceneToSvg(frameOf([shape]));
    expect(svg).toContain('<path d="M 0 0 L 100 0" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="butt" stroke-linejoin="round" stroke-dasharray="50 205" stroke-dashoffset="-25"/>');
    const filled = node("tri", "shape", { shape: "M 0 0 L 10 0 L 5 10 Z", color: "#FF0000FF" }, [0, 0, 10, 10]);
    expect(sceneToSvg(frameOf([filled]))).toContain('<path d="M 0 0 L 10 0 L 5 10 Z" fill="#ff0000"/>');
    const hidden = { ...node("gone", "rectangle", { color: "#FF0000FF" }, [0, 0, 10, 10]), visible: false };
    expect(sceneToSvg(frameOf([hidden]))).not.toContain("gone");
  });
});

describe("svg helpers", () => {
  it("measures path data", () => {
    expect(pathDataLength("M0 0 L 3 4")).toBeCloseTo(5, 6);
    expect(pathDataLength("M0 0 H10 V10 H0 Z")).toBeCloseTo(40, 6);
    expect(pathDataLength("m0 0 l10 0 0 10z")).toBeCloseTo(20 + Math.SQRT2 * 10, 6);
    expect(pathDataLength("M 0 50 A 50 50 0 1 0 100 50 A 50 50 0 1 0 0 50 Z")).toBeCloseTo(Math.PI * 100, 0);
    expect(pathDataLength("M0 0 a10 10 0 0110 10")).toBeCloseTo((Math.PI * 10) / 2, 1);
    expect(pathDataLength("M0 0 C 0 0 10 0 10 0 S 20 0 20 0")).toBeCloseTo(20, 4);
    expect(pathDataLength("M0 0 Q 5 0 10 0 T 20 0")).toBeCloseTo(20, 4);
    expect(pathDataLength("M 0 0 10 0 10 10")).toBeCloseTo(20, 6);
    expect(pathDataLength("nonsense")).toBe(0);
  });

  it("derives exact 2D transforms and flattens perspective", () => {
    const m = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 5, 7, 0, 1];
    const a = affineFromMat4(m, 10, 10)!;
    expect(a).toEqual([2, 0, 0, 3, 5, 7]);
    expect(multiplyAffine(invertAffine(a)!, a).map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(transformRect(a, { x: 0, y: 0, width: 10, height: 10 })).toEqual({ x: 5, y: 7, width: 20, height: 30 });
    const perspective = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    perspective[3] = 0.001;
    const flat = affineFromMat4(perspective, 100, 100)!;
    expect(flat[4]).toBe(0);
    expect(flat[0]).toBeCloseTo(100 / 1.1 / 100, 6);
    expect(affineFromMat4([Number.NaN], 1, 1)).toBeNull();
  });

  it("wraps and truncates text", () => {
    const style: SvgTextStyle = { fontFamily: "Inter", fontSize: 17, fontWeight: 400, letterSpacing: 0, lineHeight: 0, textTransform: "uppercase" };
    expect(wrapText("hello world\nagain", style, null)).toEqual(["HELLO WORLD", "AGAIN"]);
    const narrow = wrapText("one two three four five six", style, 60);
    expect(narrow.length).toBeGreaterThan(2);
    for (const line of narrow) expect(approximateTextWidth(line, style)).toBeLessThanOrEqual(60 + 1e-6);
    expect(truncateLines(["one two", "three four", "five six"], 2, "clip", 60, style)).toEqual(["one two", "three four"]);
    const end = truncateLines(["one two", "three four", "five six"], 2, "end", 60, style);
    expect(end[1]!.endsWith("…")).toBe(true);
    expect(approximateTextWidth(end[1]!, style)).toBeLessThanOrEqual(60);
    const middle = truncateLines(["one", "two three four five"], 1, "middle", 80, style);
    expect(middle).toHaveLength(1);
    expect(middle[0]).toContain("…");
    expect(truncateLines(["a", "b"], 0, "end", null, style)).toEqual(["a", "b"]);
    expect(wrapText("a b", style, 60, (s) => s.length * 100)).toEqual(["A", "B"]);
  });
});
