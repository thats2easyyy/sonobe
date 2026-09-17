/**
 * Examples demo: runs example project documents through the real engine runtime and patch library
 * and draws the frames with the DOM renderer inside a CSS device frame. demo/screenshot-examples.mjs
 * reads the projects from disk and hands them to the page. Time advances deterministically (1/60 s
 * per frame, only when stepped), so screenshots are reproducible; input goes through the renderer's
 * own DOM capture, exactly like the editor's viewer.
 */

import { getDevicePreset } from "@sonobe/core";
import type { SonobeDocument } from "@sonobe/core";
import { createRuntime } from "@sonobe/engine";
import type { SceneFrame, SceneNode, SonobeRuntime } from "@sonobe/engine";
import { createPatchRegistry } from "@sonobe/patches";
import { DomTextMeasurer, createDeviceFrame, createDomRenderer } from "../src/index.ts";
import type { DeviceFrame, DomRenderer } from "../src/index.ts";

interface LoadOptions {
  /** Frames to step before the first screenshot (entrance animations settle). Default 60. */
  frames?: number;
  /** Asset id → loadable URL (file URLs from the project's assets folder). */
  assetUrls?: Record<string, string>;
}

interface Loaded {
  doc: SonobeDocument;
  runtime: SonobeRuntime;
  renderer: DomRenderer;
  device: DeviceFrame;
  scene: SceneFrame;
}

/** Layer types whose body honours cornerRadius / cornerRadii. */
const RADIUS_TYPES = new Set(["group", "rectangle", "image", "video", "gradient", "shader"]);

const measurer = new DomTextMeasurer();
const registry = createPatchRegistry();
let current: Loaded | null = null;

function walk(nodes: readonly SceneNode[], visit: (node: SceneNode) => void): void {
  for (const n of nodes) {
    visit(n);
    walk(n.children ?? [], visit);
  }
}

function nodeFor(layerId: string): SceneNode | undefined {
  let found: SceneNode | undefined;
  if (current) walk(current.scene.roots, (n) => (found ??= n.layerId === layerId || n.key === layerId ? n : undefined));
  return found;
}

function step(frames: number): number {
  if (!current) return 0;
  for (let i = 0; i < frames; i++) {
    current.scene = current.runtime.step();
    current.renderer.render(current.scene);
  }
  return current.runtime.frame;
}

function load(doc: SonobeDocument, options: LoadOptions = {}): { issues: string[]; nodes: number; size: [number, number] } {
  if (current) {
    current.renderer.dispose();
    current.device.dispose();
    current.runtime.dispose();
    current = null;
  }
  const app = document.getElementById("app")!;
  app.replaceChildren();
  const stage = document.createElement("div");
  stage.className = "device-stage";
  app.appendChild(stage);
  const device = createDeviceFrame(stage, getDevicePreset(doc.project.device.preset), { showFrame: true, orientation: doc.project.device.orientation ?? "portrait" });
  const assetUrls = options.assetUrls ?? {};
  const resolveAssetUrl = (id: string) => assetUrls[id];
  const runtime = createRuntime(doc, { registry, textMeasurer: measurer, deterministic: true, fps: 60, resolveAssetUrl });
  const renderer = createDomRenderer(device.screen, {
    resolveAssetUrl,
    textMeasurer: measurer,
    onEvents: (events) => runtime.dispatch(events),
    onMediaState: (key, _layerId, media) => {
      const values: Record<string, number | boolean | [number, number]> = {};
      for (const [k, v] of Object.entries(media)) if (v !== undefined) values[k] = v;
      runtime.setLayerOutputs(key, values);
    },
  });
  current = { doc, runtime, renderer, device, scene: runtime.step() };
  renderer.render(current.scene);
  step(Math.max(0, (options.frames ?? 60) - 1));
  let nodes = 0;
  walk(current.scene.roots, () => nodes++);
  return { issues: runtime.issues().map((i) => `${i.severity} ${i.code}: ${i.message}`), nodes, size: current.scene.size };
}

const px = (v: string) => Number.parseFloat(v) || 0;

/**
 * Every drawn layer with a corner radius must have rounded corners in the DOM: a border radius on its
 * body (or a squircle clip-path with cornerSmoothing), and on the outer element when it blurs its backdrop.
 */
function auditCorners(): { checked: number; failures: string[] } {
  const failures: string[] = [];
  let checked = 0;
  if (!current) return { checked, failures: ["no example loaded"] };
  walk(current.scene.roots, (n) => {
    if (!RADIUS_TYPES.has(n.type)) return;
    const props = n.props ?? {};
    const radius = typeof props.cornerRadius === "number" ? props.cornerRadius : 0;
    const radii = Array.isArray(props.cornerRadii) ? (props.cornerRadii as number[]) : [];
    const expected = radii.some((r) => r > 0) ? Math.max(...radii) : radius;
    if (!(expected > 0) || n.width <= 0 || n.height <= 0) return;
    const el = current!.renderer.elementForKey(n.key);
    const body = el?.querySelector<HTMLElement>(":scope > .sonobe-body");
    if (!el || !body) {
      failures.push(`${n.key}: no element`);
      return;
    }
    checked++;
    const style = getComputedStyle(body);
    const smooth = typeof props.cornerSmoothing === "number" && props.cornerSmoothing > 0;
    const drawn = Math.max(px(style.borderTopLeftRadius), px(style.borderTopRightRadius), px(style.borderBottomRightRadius), px(style.borderBottomLeftRadius));
    if (smooth ? style.clipPath === "none" && drawn === 0 : drawn === 0) {
      failures.push(`${n.key} (${n.type}) cornerRadius ${expected} drew square corners (border-radius ${style.borderRadius}, cornerRadii ${JSON.stringify(props.cornerRadii)})`);
    }
    if (typeof props.backgroundBlur === "number" && props.backgroundBlur > 0 && px(getComputedStyle(el).borderTopLeftRadius) === 0 && !smooth) {
      failures.push(`${n.key} (${n.type}) backdrop blur isn't rounded`);
    }
  });
  return { checked, failures };
}

/** Computed corner radius of a layer's body and of its outer element (which shapes backdrop blur). */
function cornerStyle(layerId: string): { body: string; outer: string } | null {
  const n = nodeFor(layerId);
  const el = n && current?.renderer.elementForKey(n.key);
  const body = el?.querySelector<HTMLElement>(":scope > .sonobe-body");
  if (!el || !body) return null;
  return { body: getComputedStyle(body).borderTopLeftRadius, outer: getComputedStyle(el).borderTopLeftRadius };
}

/** Client-space centre of a layer (for Playwright's mouse). */
function layerCenter(layerId: string): { x: number; y: number } | null {
  const n = nodeFor(layerId);
  const el = n && current?.renderer.elementForKey(n.key);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Client-space position of a prototype point. */
function prototypePoint(x: number, y: number): { x: number; y: number } | null {
  if (!current) return null;
  const r = current.renderer.stage.getBoundingClientRect();
  const [w, h] = current.scene.size;
  return { x: r.left + (x / w) * r.width, y: r.top + (y / h) * r.height };
}

function getValue(address: string): unknown {
  return current?.runtime.getValue(address);
}

declare global {
  interface Window {
    __sonobeExamples: {
      load: typeof load;
      step: typeof step;
      auditCorners: typeof auditCorners;
      cornerStyle: typeof cornerStyle;
      layerCenter: typeof layerCenter;
      prototypePoint: typeof prototypePoint;
      getValue: typeof getValue;
    };
    __sonobeReady: boolean;
  }
}

window.__sonobeExamples = { load, step, auditCorners, cornerStyle, layerCenter, prototypePoint, getValue };
window.__sonobeReady = true;
