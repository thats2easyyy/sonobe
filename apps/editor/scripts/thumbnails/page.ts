/**
 * Thumbnail page: renders an example project with the real engine, patch library, and DOM renderer
 * at a fixed timestep, so generate-thumbnails.mjs can screenshot the settled first screen.
 */

import { getDevicePreset, parseDocumentFiles } from "@sonobe/core";
import { createRuntime } from "@sonobe/engine";
import { createPatchRegistry } from "@sonobe/patches";
import { createDomRenderer, DomTextMeasurer } from "@sonobe/renderer";

export interface ThumbnailResult {
  width: number;
  height: number;
  errors: string[];
}

declare global {
  interface Window {
    /** `assetUrls` maps asset file names (assets/<file>) to URLs the page can load. */
    __sonobeThumbnail?: { render(files: Record<string, string>, frames: number, scale: number, assetUrls?: Record<string, string>): ThumbnailResult };
  }
}

const registry = createPatchRegistry();
const measurer = new DomTextMeasurer();
let dispose: (() => void) | null = null;

/** "#RRGGBBAA" → a CSS color. */
function cssColor(hex: unknown): string {
  if (typeof hex !== "string" || !/^#[0-9a-f]{8}$/i.test(hex)) return "#FFFFFF";
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${(n(7) / 255).toFixed(3)})`;
}

window.__sonobeThumbnail = {
  render(files, frames, scale, assetUrls = {}) {
    dispose?.();
    const doc = parseDocumentFiles(files);
    const preset = getDevicePreset(doc.project.device.preset);
    const [w, h] = doc.project.device.orientation === "landscape" ? [preset.size[1], preset.size[0]] : preset.size;
    const stage = document.getElementById("stage")!;
    stage.replaceChildren();
    stage.style.width = `${Math.round(w * scale)}px`;
    stage.style.height = `${Math.round(h * scale)}px`;
    stage.style.background = cssColor(doc.project.background);
    const errors: string[] = [];
    const runtime = createRuntime(doc, { registry, textMeasurer: measurer, deterministic: true, fps: 60, onLog: (level, args) => void (level === "error" && errors.push(args.map(String).join(" "))) });
    const resolveAssetUrl = (assetId: string) => {
      const file = doc.assets[assetId]?.file;
      return file ? assetUrls[file] : undefined;
    };
    const renderer = createDomRenderer(stage, { textMeasurer: measurer, captureInput: false, allowAudio: false, scale, resolveAssetUrl });
    for (let i = 0; i < frames; i++) renderer.render(runtime.step());
    dispose = () => {
      renderer.dispose();
      runtime.dispose();
    };
    return { width: Math.round(w * scale), height: Math.round(h * scale), errors };
  },
};
