/**
 * Sonobe Capture for Figma: copies the selected frame (or layers) as a design capture, for pasting into
 * Sonobe as real layers. The mapping lives in @sonobe/import (figma.ts); this file only reads the
 * selection, exports vectors and image fills, and hands the text to the UI, which owns the clipboard.
 */

import { figmaToCapture, type FigmaNodeLike } from "../../../packages/import/src/figma.ts";

declare const figma: {
  currentPage: { selection: readonly unknown[] };
  root: { name: string };
  mixed: symbol;
  showUI(html: string, options: { width: number; height: number; visible?: boolean; themeColors?: boolean }): void;
  ui: { postMessage(message: unknown): void; onmessage: ((message: { type?: string; ok?: boolean }) => void) | undefined };
  notify(message: string, options?: { error?: boolean }): void;
  closePlugin(): void;
  base64Encode(bytes: Uint8Array): string;
  getImageByHash(hash: string): { getBytesAsync(): Promise<Uint8Array> } | null;
};
declare const __html__: string;

const mimeOf = (bytes: Uint8Array) => (bytes[0] === 0xff ? "image/jpeg" : bytes[0] === 0x47 ? "image/gif" : bytes[0] === 0x52 ? "image/webp" : "image/png");

async function run(): Promise<void> {
  const selection = figma.currentPage.selection as unknown as FigmaNodeLike[];
  if (selection.length === 0) {
    figma.notify("Select a frame or layers to copy for Sonobe.");
    figma.closePlugin();
    return;
  }
  figma.showUI(__html__, { width: 280, height: 96, themeColors: true });
  try {
    const capture = await figmaToCapture(
      selection,
      {
        async exportSvg(node) {
          const bytes = await (node as unknown as { exportAsync(o: { format: "SVG" }): Promise<Uint8Array> }).exportAsync({ format: "SVG" });
          return `data:image/svg+xml;base64,${figma.base64Encode(bytes)}`;
        },
        async imageData(hash) {
          const bytes = await figma.getImageByHash(hash)?.getBytesAsync();
          return bytes ? `data:${mimeOf(bytes)};base64,${figma.base64Encode(bytes)}` : null;
        },
      },
      { title: figma.root.name },
    );
    figma.ui.onmessage = (message) => {
      if (message.type !== "copied") return;
      if (message.ok) figma.notify(`Copied “${capture.root.name}”. Paste it into Sonobe with ⌘V.`);
      else figma.notify("Figma didn't allow copying. Try again.", { error: true });
      figma.closePlugin();
    };
    figma.ui.postMessage({ type: "copy", text: JSON.stringify(capture), name: capture.root.name });
  } catch (err) {
    figma.notify(err instanceof Error ? err.message : String(err), { error: true });
    figma.closePlugin();
  }
}

void run();
