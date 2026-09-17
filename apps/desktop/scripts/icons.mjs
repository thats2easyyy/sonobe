#!/usr/bin/env node
/**
 * App icons from assets/brand/sonobe-mark.svg, rasterized with Playwright's Chromium (headless, muted):
 *
 *   build/icon.icns       macOS, from a Big Sur–style iconset (iconutil; macOS only)
 *   build/icon.ico        Windows, 16–256 px PNG entries
 *   build/icons/NxN.png   Linux, 16–1024 px
 *   build/icon.png        1024 px, the electron-builder fallback
 *
 *   node scripts/icons.mjs           skip when build/icons.json matches the current sources
 *   node scripts/icons.mjs --force   always regenerate
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const out = path.join(root, "build");
const markPath = path.join(repo, "assets", "brand", "sonobe-mark.svg");
const manifestPath = path.join(out, "icons.json");
const force = process.argv.includes("--force");

const ICNS_SET = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

const mark = readFileSync(markPath, "utf8");
const source = createHash("sha256").update(mark).update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
const outputs = [path.join(out, "icon.ico"), path.join(out, "icon.png"), ...LINUX_SIZES.map((s) => path.join(out, "icons", `${s}x${s}.png`)), ...(process.platform === "darwin" ? [path.join(out, "icon.icns")] : [])];

if (!force && existsSync(manifestPath) && outputs.every((file) => existsSync(file))) {
  try {
    if (JSON.parse(readFileSync(manifestPath, "utf8")).source === source) {
      console.log("[icons] up to date");
      process.exit(0);
    }
  } catch {
    // Regenerate.
  }
}

/**
 * One icon at `size` px. "mac" follows Apple's icon grid (an 824/1024 rounded body with a soft
 * shadow); "flat" fills the canvas for Windows and Linux. The mark grows at small sizes to stay legible.
 */
function iconHtml(size, style) {
  const mac = style === "mac";
  const inset = mac ? (size * 100) / 1024 : size >= 64 ? size * 0.04 : 0;
  const body = size - inset * 2;
  const radius = body * (mac ? 0.2237 : 0.2);
  const markScale = mac ? (size <= 32 ? 0.74 : 0.62) : size <= 32 ? 0.82 : 0.68;
  const markSize = body * markScale;
  const shadow = mac && size >= 64 ? `0 ${(size * 10) / 1024}px ${(size * 24) / 1024}px rgba(0, 0, 0, 0.32)` : "none";
  const hairline = size >= 64 ? `inset 0 0 0 ${Math.max(1, size / 512)}px rgba(255, 255, 255, 0.08)` : "none";
  const svg = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;
  return `<!doctype html><html><head><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
  .body {
    position: absolute; left: ${inset}px; top: ${inset}px; width: ${body}px; height: ${body}px; border-radius: ${radius}px;
    background:
      radial-gradient(120% 90% at 50% 0%, rgba(155, 140, 255, 0.22) 0%, rgba(155, 140, 255, 0) 62%),
      linear-gradient(180deg, #2B2937 0%, #15141B 100%);
    box-shadow: ${shadow}, ${hairline};
    display: grid; place-items: center;
  }
  .body[data-shadow="none"] { box-shadow: ${hairline}; }
  img { width: ${markSize}px; height: ${markSize}px; display: block; }
</style></head><body><div class="body" data-shadow="${shadow === "none" ? "none" : "on"}"><img src="${svg}" alt=""></div></body></html>`;
}

/** A Windows .ico holding PNG entries. */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, data }, i) => {
    const o = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, o);
    directory.writeUInt8(size >= 256 ? 0 : size, o + 1);
    directory.writeUInt8(0, o + 2);
    directory.writeUInt8(0, o + 3);
    directory.writeUInt16LE(1, o + 4);
    directory.writeUInt16LE(32, o + 6);
    directory.writeUInt32LE(data.length, o + 8);
    directory.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.data)]);
}

mkdirSync(path.join(out, "icons"), { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const cache = new Map();
  const render = async (size, style) => {
    const key = `${style}:${size}`;
    if (cache.has(key)) return cache.get(key);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(iconHtml(size, style));
    await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    const png = await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    cache.set(key, png);
    return png;
  };

  for (const size of LINUX_SIZES) writeFileSync(path.join(out, "icons", `${size}x${size}.png`), await render(size, "flat"));
  writeFileSync(path.join(out, "icon.png"), await render(1024, "flat"));
  const ico = [];
  for (const size of ICO_SIZES) ico.push({ size, data: await render(size, "flat") });
  writeFileSync(path.join(out, "icon.ico"), encodeIco(ico));

  if (process.platform === "darwin") {
    const temp = mkdtempSync(path.join(tmpdir(), "sonobe-icons-"));
    const iconset = path.join(temp, "icon.iconset");
    mkdirSync(iconset);
    for (const [name, size] of ICNS_SET) writeFileSync(path.join(iconset, name), await render(size, "mac"));
    // Keep the 1024 px mac-style master for docs and the DMG.
    writeFileSync(path.join(out, "icon-mac.png"), await render(1024, "mac"));
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(out, "icon.icns")], { stdio: "inherit" });
    rmSync(temp, { recursive: true, force: true });
  } else {
    console.warn("[icons] iconutil is macOS-only; skipped build/icon.icns");
  }
} finally {
  await browser.close();
}

writeFileSync(manifestPath, `${JSON.stringify({ source, generatedFrom: "assets/brand/sonobe-mark.svg", ico: ICO_SIZES, linux: LINUX_SIZES, icns: ICNS_SET.map(([name]) => name) }, null, 2)}\n`);
console.log(`[icons] wrote ${path.relative(repo, out)}/icon.{icns,ico,png} and icons/`);
