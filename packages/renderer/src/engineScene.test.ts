// @vitest-environment happy-dom
/**
 * Regression tests on scenes produced by the engine runtime rather than hand-written frames.
 * The runtime resolves every layer prop, so props a document never set arrive as their type's
 * zero value (cornerRadii [0, 0, 0, 0], gradient null, strokeWidth 0...). Those must draw
 * exactly like the unset prop.
 */
import { createEmptyDocument } from "@sonobe/core";
import type { LayerNode, SonobeDocument } from "@sonobe/core";
import { createEngineRegistry, createRuntime } from "@sonobe/engine";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDomRenderer } from "./renderer.ts";
import type { DomRenderer } from "./renderer.ts";
import { writtenStyle } from "./style.ts";

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

function findNode(nodes: readonly SceneNode[], layerId: string): SceneNode | undefined {
  for (const n of nodes) {
    if (n.layerId === layerId) return n;
    const inner = findNode(n.children ?? [], layerId);
    if (inner) return inner;
  }
  return undefined;
}

describe("engine-produced scenes", () => {
  let container: HTMLElement;
  let renderer: DomRenderer;
  let scene: SceneFrame;
  const el = (layerId: string) => renderer.elementForKey(findNode(scene.roots, layerId)!.key)!;
  const body = (layerId: string) => el(layerId).querySelector(":scope > .sonobe-body") as HTMLElement;
  const draw = (layers: LayerNode[]) => {
    scene = engineScene(layers);
    renderer.render(scene);
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = createDomRenderer(container, { resolveAssetUrl: (id) => `https://cdn.test/${id}.png`, captureInput: false });
  });

  afterEach(() => {
    renderer.dispose();
    container.remove();
  });

  it("rounds cards and buttons whose unset cornerRadii resolves to [0, 0, 0, 0]", () => {
    // examples/02-like-toggle "post" / "post_photo", and the editor demo's backdrop-blurred like button.
    draw([
      layer("post", "group", { position: [16, 120], size: [370, 560], color: "#FFFFFFFF", cornerRadius: 28, shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: [0, 10] }, [
        layer("post_photo", "group", { position: [16, 72], size: [338, 380], cornerRadius: 20, clip: true }, [layer("photo_sky", "gradient", { size: [338, 380] })]),
      ]),
      layer("like_button", "group", { position: [322, 162], size: [48, 48], color: "#0000003D", cornerRadius: 24, backgroundBlur: 12 }),
    ]);
    const post = findNode(scene.roots, "post")!;
    expect(post.props.cornerRadius).toBe(28);
    expect(post.props.cornerRadii ?? null).not.toEqual([28, 28, 28, 28]);
    expect(writtenStyle(body("post"), "border-radius")).toBe("28px");
    expect(writtenStyle(body("post"), "box-shadow")).toBe("0px 10px 24px rgba(0, 0, 0, 0.08)");
    expect(writtenStyle(body("post_photo"), "border-radius")).toBe("20px");
    expect(writtenStyle(body("post_photo"), "overflow")).toBe("hidden");
    expect(writtenStyle(body("like_button"), "border-radius")).toBe("24px");
    // The backdrop blur is shaped by the outer element's radius.
    expect(writtenStyle(el("like_button"), "backdrop-filter")).toBe("blur(12px)");
    expect(writtenStyle(el("like_button"), "border-radius")).toBe("24px");
  });

  it("rounds every radius-bearing layer type from cornerRadius", () => {
    draw([
      layer("rect", "rectangle", { size: [100, 60], cornerRadius: 12 }),
      layer("sky", "gradient", { size: [100, 60], cornerRadius: 14 }),
      layer("photo", "image", { size: [100, 60], cornerRadius: 16, image: { asset: "photo" } }),
      layer("battery", "rectangle", { size: [25, 12], color: "#00000000", cornerRadius: 3.5, strokeColor: "#11111859", strokeWidth: 1 }),
    ]);
    expect(writtenStyle(body("rect"), "border-radius")).toBe("12px");
    expect(writtenStyle(body("sky"), "border-radius")).toBe("14px");
    expect(writtenStyle(body("photo"), "border-radius")).toBe("16px");
    const stroke = el("battery").querySelector(".sonobe-stroke") as HTMLElement;
    expect(writtenStyle(stroke, "border-radius")).toBe("3.5px 3.5px 3.5px 3.5px");
  });

  it("uses smooth corners from cornerRadius when cornerSmoothing is set", () => {
    draw([layer("card", "group", { size: [370, 300], color: "#FFFFFFFF", cornerRadius: 28, cornerSmoothing: 0.6, clip: true })]);
    expect(writtenStyle(body("card"), "clip-path")).toMatch(/^path\("M /);
    expect(writtenStyle(body("card"), "border-radius")).toBe("");
  });

  it("still lets an explicit cornerRadii override cornerRadius", () => {
    draw([layer("sheet", "group", { size: [402, 500], color: "#FFFFFFFF", cornerRadius: 8, cornerRadii: [28, 28, 0, 0] })]);
    expect(writtenStyle(body("sheet"), "border-radius")).toBe("28px 28px 0px 0px");
  });

  it("draws the fill color when the gradient prop is unset", () => {
    draw([
      layer("chip", "rectangle", { size: [80, 30], color: "#FF3D71FF" }),
      layer("thumb", "rectangle", { size: [56, 56], cornerRadius: 14, gradient: { gradient: { kind: "linear", stops: [[0, "#FFB37BFF"], [1, "#FF5E7EFF"]], start: [0, 0], end: [1, 1] } } }),
    ]);
    expect(findNode(scene.roots, "chip")!.props.gradient ?? null).toBeNull();
    expect(writtenStyle(body("chip"), "background-color")).toBe("rgba(255, 61, 113, 1)");
    expect(writtenStyle(body("chip"), "background-image")).toBe("");
    expect(writtenStyle(body("thumb"), "background-image")).toMatch(/^linear-gradient\(/);
    expect(writtenStyle(body("thumb"), "background-color")).toBe("");
    expect(writtenStyle(body("thumb"), "border-radius")).toBe("14px");
  });

  it("draws nothing extra for resolved defaults: stroke, shadow, effects, empty media, clone source", () => {
    draw([
      layer("plain", "group", { size: [100, 100], color: "#FFFFFFFF" }),
      layer("pic", "image", { size: [100, 100] }),
      layer("copy", "clone", { size: [100, 100] }),
      layer("outline", "shape", { size: [96, 96] }),
    ]);
    const plain = findNode(scene.roots, "plain")!;
    // Engine defaults: an opaque black stroke color at width 0 and a black shadow at opacity 0.
    expect(plain.props.strokeWidth).toBe(0);
    expect(plain.props.shadowOpacity).toBe(0);
    expect(el("plain").querySelector(".sonobe-stroke, .sonobe-stroke-svg")).toBeNull();
    expect(writtenStyle(body("plain"), "box-shadow")).toBe("");
    expect(writtenStyle(el("plain"), "filter")).toBe("");
    expect(writtenStyle(body("plain"), "border-radius")).toBe("");
    expect(body("pic").querySelector("img")).toBeNull();
    expect(writtenStyle(body("pic"), "background-image")).toBe("");
    expect(el("copy").querySelectorAll(".sonobe-layer")).toHaveLength(0);
    expect(el("outline").querySelector("svg")).toBeNull();
  });
});
