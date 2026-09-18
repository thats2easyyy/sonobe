/** Fidelity harness page: draws a Sonobe document's first frame with the real DOM renderer. */

import type { SonobeDocument } from "@sonobe/core";
import { createRuntime } from "@sonobe/engine";
import { createPatchRegistry } from "@sonobe/patches";
import { createDomRenderer, createFontAssetRegistry, DomTextMeasurer } from "@sonobe/renderer";

declare global {
  interface Window {
    __renderDocument(doc: SonobeDocument, assets: Record<string, string>): Promise<void>;
  }
}

window.__renderDocument = async (doc, assets) => {
  const stage = document.getElementById("stage")!;
  const measurer = new DomTextMeasurer();
  const resolveAssetUrl = (assetId: string) => assets[assetId];
  createFontAssetRegistry(resolveAssetUrl).sync(doc.assets);
  await document.fonts.ready;
  const runtime = createRuntime(doc, { registry: createPatchRegistry(), textMeasurer: measurer, deterministic: true, seed: 1, platform: {}, resolveAssetUrl } as never);
  runtime.step();
  runtime.step();
  const renderer = createDomRenderer(stage, { resolveAssetUrl, textMeasurer: measurer, captureInput: false, scale: 1, devicePixelRatio: window.devicePixelRatio || 1 });
  const frame = runtime.step();
  renderer.render(frame);
  await Promise.all([...stage.querySelectorAll("img")].map((img) => img.decode().catch(() => undefined)));
  await document.fonts.ready;
  renderer.render(runtime.step());
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};
