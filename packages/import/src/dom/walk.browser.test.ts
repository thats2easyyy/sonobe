/** The DOM walker in real Chromium (Playwright), on the layouts that are easy to get wrong. Skipped without Playwright's browser. */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CaptureFrame, CaptureNode, DesignCapture } from "../capture.ts";
import { capturePage } from "../node.ts";

const playwrightReady = await (async () => {
  try {
    const { chromium } = (await import("playwright")) as { chromium: { executablePath(): string } };
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const capture = async (body: string, extra: { width?: number; height?: number } = {}): Promise<DesignCapture> =>
  (await capturePage({ html: `<!doctype html><html><head><style>body{margin:0;font-family:system-ui}</style></head><body>${body}</body></html>`, width: extra.width ?? 400, height: extra.height ?? 800 })).capture;

function findText(node: CaptureNode): CaptureNode | undefined {
  if (node.kind === "text") return node;
  if (node.kind !== "frame") return undefined;
  for (const child of node.children) {
    const found = findText(child);
    if (found) return found;
  }
  return undefined;
}

function find(node: CaptureNode, name: string): CaptureNode | undefined {
  if (node.name === name) return node;
  if (node.kind !== "frame") return undefined;
  for (const child of node.children) {
    const found = find(child, name);
    if (found) return found;
  }
  return undefined;
}

describe.skipIf(!playwrightReady)("DOM walker in Chromium", () => {
  it("measures children of a scaled element without scaling them twice", async () => {
    const c = await capture(`<div data-name="Card" style="position:absolute;left:100px;top:100px;width:200px;height:100px;background:#eee;transform:scale(.5)"><div data-name="Bar" style="height:10px;background:#f00"></div></div>`);
    const card = find(c.root, "Card") as CaptureFrame;
    const bar = find(c.root, "Bar")!;
    expect(card).toMatchObject({ box: [100, 100, 200, 100], scale: 0.5 });
    // Unscaled inside the unscaled card; the group's scale shrinks both.
    expect(bar.box).toEqual([100, 100, 200, 10]);
  });

  it("starts wrapped text after an icon in the same row", async () => {
    const c = await capture(`<div style="display:flex;gap:8px;padding:10px;width:300px"><div data-name="Icon" style="width:40px;height:40px;flex:none;background:#000"></div><p data-name="Label" style="margin:0">A long label that wraps onto a second line because the row is narrow</p></div>`);
    const text = findText(c.root)!;
    expect(text).toMatchObject({ kind: "text", wraps: true });
    expect(text.box[0]).toBeGreaterThanOrEqual(57);
    expect(text.box[0] + text.box[2]).toBeLessThanOrEqual(311);
  });

  it("survives sprite ids that aren't selectors, and keeps shadow DOM content", async () => {
    const c = await capture(`<svg width="0" height="0" style="position:absolute"><symbol id=":r1:" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol></svg>
      <svg data-name="Sprite Icon" width="24" height="24"><use href="#:r1:"/></svg>
      <p>Hi <x-badge></x-badge> there</p>
      <script>customElements.define("x-badge", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = '<span data-name="Badge" style="display:inline-block;width:20px;height:12px;background:#f00"></span>'; } });</script>`);
    expect(find(c.root, "Sprite Icon")?.kind).toBe("image");
    expect(find(c.root, "Badge")).toBeDefined();
  });

  it("lifts fixed bars to the screen, except inside a transformed ancestor", async () => {
    const c = await capture(`<div style="height:2000px"></div><nav data-name="Tab Bar" style="position:fixed;bottom:0;left:0;right:0;height:60px;background:#fff"></nav>
      <div style="transform:translateZ(0)"><div data-name="Inner Bar" style="position:fixed;top:0;left:0;width:100px;height:20px;background:#00f"></div></div>`);
    const tabBar = c.root.children.find((n) => n.name === "Tab Bar")!;
    expect(tabBar.box).toEqual([0, 740, 400, 60]);
    const content = c.root.children.find((n) => n.name === "Content") as CaptureFrame;
    expect(find(content, "Inner Bar")?.box[1]).toBe(2000);
  });
});
