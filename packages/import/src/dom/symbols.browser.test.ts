/** SF Symbol placeholders through a real capture in Chromium (Playwright), with a fake renderer. Skipped without Playwright's browser. */

import { existsSync } from "node:fs";
import { createEmptyDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import type { CaptureFrame, CaptureImage, CaptureNode, DesignCapture } from "../capture.ts";
import { planImport } from "../convert.ts";
import { capturePage } from "../node.ts";
import { resolveCaptureFiles } from "../resolve.ts";
import type { CaptureProgress } from "../run.ts";
import type { SymbolRenderer, SymbolRequest } from "../symbols.ts";
import { WALKER_SOURCE } from "./walkerSource.ts";

const playwrightReady = await (async () => {
  try {
    const { chromium } = (await import("playwright")) as { chromium: { executablePath(): string } };
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Draws every symbol as a masked rectangle 1.2em wide, like the helper's SVG (with a mask id "m0"). */
function fakeRenderer(): SymbolRenderer & { calls: SymbolRequest[][] } {
  const calls: SymbolRequest[][] = [];
  return {
    calls,
    async render(requests, options) {
      calls.push([...requests]);
      return requests.map((r, i) => {
        options?.onDrawn?.(i + 1, requests.length);
        if (r.name === "hart") return { ok: false as const, error: "“hart” isn't an SF Symbol on this Mac (macOS 26.6).", suggestions: ["heart", "cart"] };
        const w = Math.round(r.size * 1.2);
        const h = r.size;
        if (r.name === "nested.fill") return { ok: true as const, png: PNG, width: w, height: h, fallback: "masks inside masks" };
        // A badge reaching 0.2em past the frame's left edge, like person.crop.circle.badge.plus.
        const past = Math.round(r.size * 0.2);
        if (r.name === "nested.badge") return { ok: true as const, png: PNG, width: w, height: h, overflow: [0, 0, 0, past] as [number, number, number, number], fallback: "masks inside masks" };
        if (r.name.includes(".badge.")) {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + past}" height="${h}" viewBox="${-past} 0 ${w + past} ${h}"><path d="M0 0H${w}V${h}H0Z" fill="#34C759"/><path d="M${-past} ${h / 2}H${past}V${h}H${-past}Z" fill="#0A84FF"/></svg>`;
          return { ok: true as const, svg, width: w, height: h, overflow: [0, 0, 0, past] as [number, number, number, number] };
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><mask id="m0" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#FFFFFF"/></mask></defs><path d="M0 0H${w}V${h}H0Z" fill="${r.colors[0]!.slice(0, 7)}" mask="url(#m0)"/></svg>`;
        return { ok: true as const, svg, width: w, height: h, ...(r.name === "airplay.audio" ? { restriction: "This symbol may only be used to refer to Apple’s AirPlay." } : {}) };
      });
    },
  };
}

const page = (body: string) => `<!doctype html><html><head><style>body{margin:0;font-family:system-ui}.row{display:flex;gap:10px;align-items:center;padding:20px}</style></head><body>${body}</body></html>`;

function find(node: CaptureNode, name: string): CaptureNode | undefined {
  if (node.name === name) return node;
  if (node.kind !== "frame") return undefined;
  for (const child of node.children) {
    const found = find(child, name);
    if (found) return found;
  }
  return undefined;
}

const markup = (capture: DesignCapture, node: CaptureNode | undefined) => {
  const url = capture.images[(node as CaptureImage).image]!.url;
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString("utf8");
};

describe.skipIf(!playwrightReady)("SF Symbols in a capture", () => {
  it("draws placeholders before the walker reads the page, named after the symbol", async () => {
    const renderer = fakeRenderer();
    const progress: CaptureProgress[] = [];
    const result = await capturePage(
      {
        html: page(`<div class="row">
          <svg data-sf-symbol="heart.fill" style="font-size:20px;color:#F24D47"></svg>
          <div data-name="Share Icon" style="display:flex"><svg data-sf-symbol="square.and.arrow.up" style="font-size:18px"></svg></div>
          <svg data-sf-symbol="xmark" data-name="Close" style="font-size:17px;font-weight:700"></svg>
          <i data-sf-symbol="star.fill" style="font-size:12px"></i>
          <svg data-sf-symbol="person.crop.circle.badge.plus" data-sf-palette="#0A84FF, #34C759" data-sf-scale="large" style="font-size:24px"></svg>
        </div>
        <div class="row"><svg data-sf-symbol="heart.fill" style="font-size:20px;color:#F24D47"></svg></div>`),
        width: 400,
        height: 300,
        symbols: renderer,
      },
      { onProgress: (p) => progress.push(p) },
    );
    const { capture } = result;
    // Identical placeholders are drawn once.
    expect(renderer.calls).toHaveLength(1);
    const requests = renderer.calls[0]!;
    expect(requests.map((r) => r.name)).toEqual(["heart.fill", "square.and.arrow.up", "xmark", "star.fill", "person.crop.circle.badge.plus"]);
    expect(requests[0]).toEqual({ name: "heart.fill", size: 20, weight: "regular", scale: "medium", colors: ["#F24D47FF"] });
    expect(requests[2]).toMatchObject({ weight: "bold" });
    expect(requests[4]).toMatchObject({ scale: "large", colors: ["#0A84FFFF", "#34C759FF"] });
    expect(progress.filter((p) => p.stage === "symbols").at(-1)).toMatchObject({ done: 5, total: 5 });

    // The symbol's own frame size, not the 300×150 of an empty <svg>.
    const heart = find(capture.root, "heart.fill") as CaptureImage;
    expect(heart).toMatchObject({ kind: "image" });
    expect(heart.box.slice(2)).toEqual([24, 20]);
    // A paintless wrapper's name wins, and data-name on the placeholder names it.
    expect(find(capture.root, "Share Icon")).toMatchObject({ kind: "image" });
    expect(find(capture.root, "square.and.arrow.up")).toBeUndefined();
    expect(find(capture.root, "Close")).toMatchObject({ kind: "image" });
    // Any element can be a placeholder.
    expect(find(capture.root, "star.fill")).toMatchObject({ kind: "image", box: [expect.any(Number), expect.any(Number), 14, 12] });
    // Mask ids are made unique per symbol, so the page draws each with its own mask.
    const heartSvg = markup(capture, heart);
    const closeSvg = markup(capture, find(capture.root, "Close"));
    const heartMask = /mask id="([^"]+)"/.exec(heartSvg)![1]!;
    expect(heartSvg).toContain(`url(#${heartMask})`);
    expect(closeSvg).not.toContain(`id="${heartMask}"`);
    expect(capture.notes ?? []).toEqual([]);
    expect(result.notes).toBeUndefined();
  });

  it("explains what it couldn't draw: unknown names, bitmaps, Apple's restrictions", async () => {
    const result = await capturePage(
      {
        html: page(`<div class="row"><svg data-sf-symbol="hart" style="font-size:16px"></svg><svg data-sf-symbol="nested.fill" style="font-size:20px"></svg><svg data-sf-symbol="airplay.audio" style="font-size:20px"></svg></div>`),
        width: 400,
        height: 200,
        symbols: fakeRenderer(),
      },
    );
    const hart = find(result.capture.root, "hart") as CaptureFrame;
    expect(hart).toMatchObject({ kind: "frame", fill: "#E5E7EBFF", box: [expect.any(Number), expect.any(Number), 16, 16], children: [] });
    // A bitmap imports as a PNG image, not a PNG inside an SVG (resvg wouldn't draw that).
    const nested = find(result.capture.root, "nested.fill") as CaptureImage;
    expect(nested).toMatchObject({ kind: "image", box: [expect.any(Number), expect.any(Number), 24, 20] });
    expect(result.capture.images[nested.image]).toMatchObject({ url: `data:image/png;base64,${PNG}`, name: "nested.fill" });
    expect(result.notes).toEqual([
      "“hart” isn't an SF Symbol on this Mac (macOS 26.6). It's a gray placeholder. Did you mean heart or cart?",
      "“nested.fill” is a 3x bitmap rather than a vector (it uses masks inside masks), so it blurs when scaled up.",
      "Apple restricts “airplay.audio”: This symbol may only be used to refer to Apple’s AirPlay.",
    ]);
    // The host explained the placeholder, so the walker doesn't again.
    expect(result.capture.notes ?? []).toEqual([]);
  });

  it("takes a name the placeholder's own aria-label gives it over the symbol's, but not its id's", async () => {
    const result = await capturePage({
      html: page(`<div class="row"><svg data-sf-symbol="heart.fill" aria-label="Like" style="font-size:20px"></svg><i data-sf-symbol="bookmark" aria-label="Save" style="font-size:20px"></i><svg data-sf-symbol="xmark" id="close-icon" style="font-size:20px"></svg><svg data-sf-symbol="hart" aria-label="Share" style="font-size:20px"></svg></div>`),
      width: 400,
      height: 200,
      symbols: fakeRenderer(),
    });
    expect(find(result.capture.root, "Like")).toMatchObject({ kind: "image" });
    expect(find(result.capture.root, "Save")).toMatchObject({ kind: "image" });
    // Like an icon class, the symbol names the glyph better than an id does.
    expect(find(result.capture.root, "xmark")).toMatchObject({ kind: "image" });
    // A symbol that couldn't be drawn keeps the name too; the note names the symbol.
    expect(find(result.capture.root, "Share")).toMatchObject({ kind: "frame", fill: "#E5E7EBFF" });
    expect(find(result.capture.root, "heart.fill")).toBeUndefined();
  });

  it("captures what a symbol draws past its frame, without moving what's laid out around it", async () => {
    // 20pt symbols have 24×20 frames; the badges reach 4pt past the left edge.
    const html = (badge: string) => page(`<div class="row">${badge}<svg data-sf-symbol="heart.fill" style="font-size:20px"></svg></div>`);
    const { capture } = await capturePage({ html: html(`<svg data-sf-symbol="person.crop.circle.badge.plus" style="font-size:20px"></svg>`), width: 400, height: 200, symbols: fakeRenderer() });
    const badge = find(capture.root, "person.crop.circle.badge.plus") as CaptureImage;
    expect(badge).toMatchObject({ kind: "image", box: [16, 20, 28, 20] });
    expect(markup(capture, badge)).toMatch(/viewBox="-4 0 28 20"/);
    expect(find(capture.root, "heart.fill")?.box).toEqual([54, 20, 24, 20]);

    // A size the page gave the placeholder scales the overflow with the drawing.
    const sized = (await capturePage({ html: html(`<svg data-sf-symbol="person.crop.circle.badge.plus" width="48" height="40" style="font-size:20px"></svg>`), width: 400, height: 200, symbols: fakeRenderer() })).capture;
    expect(find(sized.root, "person.crop.circle.badge.plus")?.box).toEqual([12, 20, 56, 40]);

    // A bitmap drawing covers its overflow too, and its margins keep the frame where it was.
    const bitmap = (await capturePage({ html: html(`<svg data-sf-symbol="nested.badge" style="font-size:20px"></svg>`), width: 400, height: 200, symbols: fakeRenderer() })).capture;
    expect(find(bitmap.root, "nested.badge")).toMatchObject({ kind: "image", box: [16, 20, 28, 20] });
    expect(find(bitmap.root, "heart.fill")?.box).toEqual([54, 20, 24, 20]);
  });

  it("keeps a size the page gave the placeholder", async () => {
    const result = await capturePage({ html: page(`<div class="row"><svg data-sf-symbol="heart.fill" width="40" height="40" style="font-size:20px"></svg><svg data-sf-symbol="xmark" style="font-size:20px;width:30px;height:30px"></svg></div>`), width: 400, height: 200, symbols: fakeRenderer() });
    expect(find(result.capture.root, "heart.fill")?.box.slice(2)).toEqual([40, 40]);
    expect(find(result.capture.root, "xmark")?.box.slice(2)).toEqual([30, 30]);
  });

  it("waits for waitFor before it looks for placeholders", async () => {
    const renderer = fakeRenderer();
    const result = await capturePage({
      html: page(`<div class="row" id="list"></div><script>setTimeout(() => { list.innerHTML = '<svg id="late" data-sf-symbol="heart.fill" style="font-size:20px"></svg>'; }, 150)</script>`),
      width: 400,
      height: 200,
      waitFor: "#late",
      symbols: renderer,
    });
    expect(renderer.calls[0]?.map((r) => r.name)).toEqual(["heart.fill"]);
    expect(find(result.capture.root, "heart.fill")).toMatchObject({ kind: "image" });
  });

  it("leaves 1em gray placeholders and says why when the host can't draw SF Symbols", async () => {
    const result = await capturePage({ html: page(`<div class="row" data-name="Row" style="background:#eee"><svg data-sf-symbol="heart.fill" style="font-size:20px"></svg><svg data-sf-symbol="xmark" style="font-size:17px"></svg></div>`), width: 400, height: 200 });
    expect(find(result.capture.root, "heart.fill")).toMatchObject({ kind: "frame", fill: "#E5E7EBFF", box: [expect.any(Number), expect.any(Number), 20, 20] });
    // The row lays out around 20pt symbols, not 300×150 empty SVGs.
    expect((find(result.capture.root, "Row") as CaptureFrame).box[3]).toBe(60);
    expect(result.notes).toEqual(["The SF Symbols “heart.fill” and “xmark” are gray placeholders: Sonobe draws SF Symbols when it imports in the app on a Mac with macOS 13 or later."]);
  });

  it("imports drawn symbols as SVG image assets named after them", async () => {
    const { capture, images } = await capturePage({ html: page(`<div class="row"><svg data-sf-symbol="heart.fill" style="font-size:20px;color:#F24D47"></svg><svg data-sf-symbol="hart"></svg></div>`), width: 400, height: 200, symbols: fakeRenderer() });
    const files = await resolveCaptureFiles(capture, { fetch: async () => null });
    for (const [key, value] of images) if (value) files.set(key, value);
    const plan = await planImport(capture, createEmptyDocument({ name: "Symbols" }), files);
    const asset = plan.ops.find((op) => op.op === "addAsset");
    expect(asset).toMatchObject({ asset: { id: "heart_fill", name: "heart.fill", mime: "image/svg+xml" } });
    type Layer = { type: string; name?: string; props: Record<string, unknown>; children?: Layer[] };
    const flat = (l: Layer): Layer[] => [l, ...(l.children ?? []).flatMap(flat)];
    const screen = plan.ops.find((op) => op.op === "addLayer") as { layer: Layer };
    const layers = flat(screen.layer);
    expect(layers.find((l) => l.name === "heart.fill")).toMatchObject({ type: "image", props: { image: { asset: "heart_fill" } } });
    expect(layers.find((l) => l.name === "hart")).toMatchObject({ type: "rectangle", props: { color: "#E5E7EBFF" } });
  });
});

describe.skipIf(!playwrightReady)("SF Symbols in the walker alone (browser editor, Chrome extension)", () => {
  it("sizes undrawn placeholders to 1em and names them in a note", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const tab = await browser.newPage({ viewport: { width: 400, height: 200 } });
      await tab.setContent(page(`<div class="row"><svg data-sf-symbol="heart.fill" style="font-size:20px"></svg></div>`));
      await tab.evaluate(WALKER_SOURCE);
      const capture = (await tab.evaluate(`window.__sonobeCapture({ settleMs: 0 })`)) as DesignCapture;
      expect(find(capture.root, "heart.fill")).toMatchObject({ kind: "frame", fill: "#E5E7EBFF", box: [20, 20, 20, 20] });
      expect(capture.notes).toContain("The SF Symbol “heart.fill” is a gray placeholder: this capture didn't draw SF Symbols. Sonobe draws them when it imports in the app on a Mac with macOS 13 or later.");
    } finally {
      await browser.close();
    }
  });
});
