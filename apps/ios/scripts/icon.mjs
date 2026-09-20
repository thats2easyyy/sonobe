#!/usr/bin/env node
/**
 * Sonobe Viewer's app icon from assets/brand/sonobe-mark.svg, rasterized with Playwright's Chromium:
 * a 1024 px opaque square (iOS rounds the corners) with the desktop icon's background and the mark.
 *
 *   node apps/ios/scripts/icon.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const iosDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(iosDir, "../..");
const out = path.join(iosDir, "SonobeViewer", "Assets.xcassets", "AppIcon.appiconset", "AppIcon.png");
const mark = readFileSync(path.join(repo, "assets", "brand", "sonobe-mark.svg"));

const size = 1024;
const html = `<!doctype html><html><head><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; overflow: hidden; }
  body {
    background:
      radial-gradient(120% 90% at 50% 0%, rgba(155, 140, 255, 0.22) 0%, rgba(155, 140, 255, 0) 62%),
      linear-gradient(180deg, #2B2937 0%, #15141B 100%);
    display: grid; place-items: center;
  }
  img { width: ${size * 0.56}px; height: ${size * 0.56}px; display: block; }
</style></head><body><img src="data:image/svg+xml;base64,${mark.toString("base64")}" alt=""></body></html>`;

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
  writeFileSync(out, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size, height: size } }));
} finally {
  await browser.close();
}
console.log(`[icon] wrote ${path.relative(repo, out)}`);
