// Screenshots of the HUD, the Learn drawer, and Connect Claude (Chromium, muted, reduced motion).
//
//   (cd apps/editor && npx vite --port 5203 --strictPort)          # dev server
//   node apps/editor/src/panels/hud/preview/screenshots.mjs [name…]  # all shots, or only the named ones
//
// Writes apps/editor/screenshots/hud-*.png, learn-*.png, and connect-*.png.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const require = createRequire(`${root}package.json`);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:5203/src/panels/hud/preview/index.html";
const OUT = process.env.OUT ?? `${root}apps/editor/screenshots`;
mkdirSync(OUT, { recursive: true });

/** @type {{ name: string; view: string; theme?: "dark" | "light"; wait?: number; run?: (page: import("playwright").Page) => Promise<void> }[]} */
const SHOTS = [
  { name: "hud-console", view: "hud-console" },
  { name: "hud-console-light", view: "hud-console", theme: "light" },
  { name: "hud-diagnostics", view: "hud-diagnostics" },
  { name: "hud-ai-activity", view: "hud-ai" },
  {
    name: "hud-performance",
    view: "hud-performance",
    wait: 14_000,
    run: async (page) => {
      const chart = page.locator(".sb-perfchart").first();
      const box = await chart.boundingBox();
      if (box) await page.mouse.move(box.x + box.width * 0.94, box.y + box.height / 2);
    },
  },
  { name: "learn-home", view: "learn-home" },
  { name: "learn-guide", view: "learn-guide" },
  { name: "learn-guide-light", view: "learn-guide", theme: "light" },
  { name: "learn-patch", view: "learn-patch" },
  {
    name: "learn-patch-search",
    view: "learn-patches",
    run: async (page) => {
      await page.getByRole("textbox", { name: "Search patches" }).fill("spring");
    },
  },
  { name: "connect-desktop", view: "connect-desktop" },
  {
    name: "connect-desktop-scrolled",
    view: "connect-desktop",
    run: async (page) => {
      await page.locator(".sb-connect__body").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    },
  },
  { name: "connect-desktop-config", view: "connect-desktop-config" },
  { name: "connect-browser", view: "connect-browser" },
  { name: "connect-light", view: "connect-desktop", theme: "light" },
];

const wanted = new Set(process.argv.slice(2));
const browser = await chromium.launch({ args: ["--mute-audio"] });
let failures = 0;

for (const shot of SHOTS) {
  if (wanted.size && !wanted.has(shot.name)) continue;
  const theme = shot.theme ?? "dark";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await context.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[${shot.name}] console.${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    failures++;
    console.log(`[${shot.name}] pageerror: ${e.message}`);
  });
  await page.goto(`${BASE}?view=${shot.view}&theme=${theme}`);
  await page.waitForSelector("body[data-preview-ready]", { timeout: 30_000 });
  await page.waitForTimeout(shot.wait ?? 700);
  if (shot.run) {
    await shot.run(page);
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log(`wrote ${shot.name}.png`);
  await context.close();
}

await browser.close();
if (failures) process.exitCode = 1;
