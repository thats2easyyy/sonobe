import { applyOps, createEmptyDocument, findLayer } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { parseCapture } from "./capture.ts";
import { planImport } from "./convert.ts";
import { figmaGradient, figmaToCapture, type FigmaNodeLike, type FigmaTransform } from "./figma.ts";
import { resolveCaptureFiles } from "./resolve.ts";

const at = (x: number, y: number): FigmaTransform => [[1, 0, x], [0, 1, y]];
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const SVG = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
const deps = { exportSvg: async () => SVG, imageData: async () => PNG };

const screen: FigmaNodeLike = {
  type: "FRAME",
  name: "Profile",
  width: 402,
  height: 874,
  absoluteTransform: at(1000, 200),
  fills: [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }],
  clipsContent: true,
  children: [
    {
      type: "RECTANGLE",
      name: "Cover",
      width: 402,
      height: 180,
      absoluteTransform: at(1000, 200),
      fills: [{ type: "GRADIENT_LINEAR", gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 1, g: 0.6, b: 0.38, a: 1 } }, { position: 1, color: { r: 0.49, g: 0.23, b: 0.93, a: 1 } }] }],
    },
    {
      type: "INSTANCE",
      name: "Follow Button",
      width: 160,
      height: 44,
      absoluteTransform: at(1036, 588),
      fills: [{ type: "SOLID", color: { r: 0.15, g: 0.5, b: 1 } }],
      cornerRadius: 12,
      effects: [{ type: "DROP_SHADOW", radius: 12, offset: { x: 0, y: 4 }, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.15 } }],
      children: [
        { type: "VECTOR", name: "Plus", width: 18, height: 18, absoluteTransform: at(1080, 601) },
        { type: "TEXT", name: "Follow", characters: "Follow", width: 44, height: 20, absoluteTransform: at(1104, 600), fontName: { family: "Inter", style: "Semi Bold" }, fontSize: 16, fontWeight: 600, lineHeight: { unit: "PIXELS", value: 20 }, letterSpacing: { unit: "PERCENT", value: -2 }, textAlignHorizontal: "CENTER", textAutoResize: "WIDTH_AND_HEIGHT", fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] },
      ],
    },
    { type: "ELLIPSE", name: "Avatar", width: 88, height: 88, absoluteTransform: at(1036, 336), fills: [{ type: "IMAGE", imageHash: "abc", scaleMode: "FILL" }], strokes: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }], strokeWeight: 4 },
    { type: "RECTANGLE", name: "Rectangle 12", visible: false, width: 10, height: 10, absoluteTransform: at(1000, 200) },
  ],
};

describe("figmaToCapture", () => {
  it("maps a frame onto a valid capture that imports as named layers", async () => {
    const capture = parseCapture(await figmaToCapture([screen], deps, { title: "Profile" }));
    expect(capture.source.kind).toBe("figma");
    expect(capture.viewport).toEqual({ width: 402, height: 874 });
    expect(capture.root).toMatchObject({ name: "Profile", box: [0, 0, 402, 874], fill: "#F5F5F7FF", clip: true });
    const [cover, button, avatar] = capture.root.children as never as Record<string, unknown>[];
    expect(capture.root.children).toHaveLength(3);
    expect(cover).toMatchObject({ name: "Cover", nameRank: 5, gradients: [{ kind: "linear", start: [0, 0.5], end: [1, 0.5] }] });
    expect(button).toMatchObject({ box: [36, 388, 160, 44], radii: [12, 12, 12, 12], shadows: [{ y: 4, blur: 12, color: "#00000026" }] });
    const label = (button!.children as Record<string, unknown>[])[1];
    expect(label).toMatchObject({ kind: "text", text: "Follow", box: [104, 400, 44, 20], nameRank: 1, style: { fontFamily: "Inter", fontWeight: 600, lineHeight: 20, letterSpacing: -0.32, align: "center", color: "#FFFFFFFF" } });
    expect(avatar).toMatchObject({ radii: [44, 44, 44, 44], border: { widths: [4, 4, 4, 4] }, children: [{ kind: "image", fit: "cover" }] });

    const doc = createEmptyDocument();
    const plan = await planImport(capture, doc, await resolveCaptureFiles(capture), {});
    const result = applyOps(doc, plan.ops, { registry: createPatchRegistry() });
    expect(result.errors).toEqual([]);
    const main = result.doc.components.main!;
    expect(findLayer(main.layers, "follow_button")?.layer.props).toMatchObject({ cornerRadius: 12, position: [36, 388] });
    expect(Object.values(result.doc.assets).map((a) => a.mime).sort()).toEqual(["image/png", "image/svg+xml"]);
  });

  it("wraps several selected layers, keeps rotation, and reports what it skipped", async () => {
    const rotated: FigmaNodeLike = { type: "RECTANGLE", name: "Tag", width: 100, height: 20, absoluteTransform: [[0, -1, 50], [1, 0, 0]], fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] };
    const slice: FigmaNodeLike = { type: "SLICE", name: "Slice", width: 10, height: 10, absoluteTransform: at(0, 0) };
    const capture = await figmaToCapture([rotated, slice], deps);
    expect(capture.root.name).toBe("Figma Selection");
    // The selection spans the slice at the origin too, so the rotated tag's center (40, 50) stays put.
    expect(capture.root.children[0]).toMatchObject({ rotation: 90, box: [-10, 40, 100, 20] });
    expect(capture.notes).toEqual(["Layers of type slice aren't imported."]);
    await expect(figmaToCapture([], deps)).rejects.toThrow("Select a frame");
  });

  it("places radial gradients by their transform", () => {
    const g = figmaGradient({ type: "GRADIENT_RADIAL", gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 0, a: 0 } }] }, 200, 100)!;
    expect(g).toMatchObject({ kind: "radial", start: [0.5, 0.5], end: [0.5, 1], ratio: 2 });
  });
});
