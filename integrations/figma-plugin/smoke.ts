#!/usr/bin/env node
/**
 * Runs the built plugin (dist/code.js) in a sandbox with a stand-in `figma` global and a small frame, the
 * way Figma calls it: checks that it posts a valid design capture to its UI and closes after the copy.
 *
 *   node integrations/figma-plugin/build.ts && node integrations/figma-plugin/smoke.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parseCapture } from "../../packages/import/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (x: number, y: number) => [[1, 0, x], [0, 1, y]];
const posted: { type: string; text?: string }[] = [];
const notes: string[] = [];
let closed = false;
const frame = {
  type: "FRAME",
  name: "Checkout",
  width: 390,
  height: 844,
  absoluteTransform: at(400, 120),
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
  children: [
    { type: "RECTANGLE", name: "Hero", width: 390, height: 240, absoluteTransform: at(400, 120), fills: [{ type: "IMAGE", imageHash: "h1", scaleMode: "FILL" }] },
    { type: "VECTOR", name: "Cart Icon", width: 24, height: 24, absoluteTransform: at(750, 140), exportAsync: async () => new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>") },
    { type: "TEXT", name: "Total", characters: "$24.00", width: 80, height: 22, absoluteTransform: at(420, 900), fontName: { family: "Inter", style: "Bold" }, fontSize: 18, fontWeight: 700, lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PIXELS", value: 0 }, textAutoResize: "WIDTH_AND_HEIGHT", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] },
  ],
};
const ui = {
  postMessage(message: { type: string; text?: string }) {
    posted.push(message);
    queueMicrotask(() => ui.onmessage?.({ type: "copied", ok: true }));
  },
  onmessage: undefined as ((m: { type: string; ok: boolean }) => void) | undefined,
};
const figma = {
  currentPage: { selection: [frame] },
  root: { name: "Shop" },
  mixed: Symbol("mixed"),
  showUI: () => undefined,
  ui,
  notify: (message: string) => notes.push(message),
  closePlugin: () => {
    closed = true;
  },
  base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
  getImageByHash: () => ({ getBytesAsync: async () => Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64") }),
};
vm.runInNewContext(readFileSync(path.join(here, "dist/code.js"), "utf8"), { figma, __html__: "<html></html>", TextEncoder, console, queueMicrotask, setTimeout });
for (let i = 0; i < 50 && !closed; i++) await new Promise((r) => setTimeout(r, 20));
const copy = posted.find((m) => m.type === "copy");
if (!copy?.text || !closed) throw new Error(`The plugin didn't post a capture and close (notes: ${notes.join("; ")})`);
const capture = parseCapture(copy.text);
console.log(`[figma] ${capture.root.name}: ${capture.root.children.length} layers, ${Object.keys(capture.images).length} images · "${notes.at(-1)}"`);
