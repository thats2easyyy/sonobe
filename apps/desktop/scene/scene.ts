/**
 * Scene renderer page for simulation screenshots. The main process loads it in a hidden window,
 * calls `window.__sonobeRenderScene(request)` with a simulation's SceneFrame, waits for media to
 * load, and captures the page. No preload and no Node: it only draws what it's given.
 */

import type { SceneFrame } from "@sonobe/engine";
import { createDomRenderer, DomTextMeasurer, type DomRenderer } from "@sonobe/renderer";

export interface SceneRenderRequest {
  scene: SceneFrame;
  /** CSS pixels per prototype point. */
  scale: number;
  /** Asset id → loadable URL (file: URLs of the project's assets). */
  assets: Record<string, string>;
  /** How long to wait for images, video frames and fonts. Default 1500 ms. */
  mediaTimeoutMs?: number;
}

/** A self-contained SVG (a component's patch graph) drawn at a size in CSS pixels. */
export interface SvgRenderRequest {
  svg: string;
  width: number;
  height: number;
}

declare global {
  interface Window {
    __sonobeRenderScene?(request: SceneRenderRequest): Promise<{ width: number; height: number }>;
    __sonobeRenderSvg?(request: SvgRenderRequest): Promise<{ width: number; height: number }>;
  }
}

const stage = document.getElementById("stage") as HTMLElement;
const measurer = new DomTextMeasurer();
let renderer: DomRenderer | null = null;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Hidden windows may not run requestAnimationFrame; a timeout still lets layout and paint happen. */
const nextPaint = () => Promise.race([new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))), delay(60)]);

async function mediaReady(root: HTMLElement, timeoutMs: number): Promise<void> {
  const images = [...root.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined));
  const videos = [...root.querySelectorAll("video")].map((video) =>
    video.readyState >= 2 ? undefined : new Promise<void>((resolve) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", () => resolve(), { once: true });
    }),
  );
  const fonts = document.fonts?.ready.then(() => undefined);
  await Promise.race([Promise.all([...images, ...videos, fonts]), delay(timeoutMs)]);
}

window.__sonobeRenderScene = async (request) => {
  const scale = request.scale > 0 && Number.isFinite(request.scale) ? request.scale : 1;
  const assets = request.assets ?? {};
  renderer?.dispose();
  stage.replaceChildren();
  renderer = createDomRenderer(stage, {
    resolveAssetUrl: (assetId) => assets[assetId],
    textMeasurer: measurer,
    captureInput: false,
    scale,
    devicePixelRatio: window.devicePixelRatio || 1,
  });
  renderer.render(request.scene);
  const [width, height] = request.scene.size;
  stage.style.width = `${width * scale}px`;
  stage.style.height = `${height * scale}px`;
  await mediaReady(stage, request.mediaTimeoutMs ?? 1500);
  // Draw again so media that finished loading lands in the frame.
  renderer.render(request.scene);
  await nextPaint();
  await nextPaint();
  return { width: width * scale, height: height * scale };
};

// An SVG goes in as an image, so nothing in it runs or loads; system fonts still draw its text.
window.__sonobeRenderSvg = async (request) => {
  renderer?.dispose();
  renderer = null;
  const img = new Image(request.width, request.height);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(request.svg)}`;
  await img.decode().catch(() => undefined);
  stage.replaceChildren(img);
  stage.style.width = `${request.width}px`;
  stage.style.height = `${request.height}px`;
  await nextPaint();
  await nextPaint();
  return { width: request.width, height: request.height };
};
