// Screenshots of the Assistant drawer (Chromium, muted, reduced motion, fake host: no API calls).
//
//   (cd apps/editor && npx vite --port 5211 --strictPort)                 # dev server
//   OUT=/tmp/shots node apps/editor/src/panels/assistant/preview/screenshots.mjs [name…]
//
// Writes assistant-*.png into OUT (default apps/editor/screenshots).

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const require = createRequire(`${root}package.json`);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:5211/src/panels/assistant/preview/index.html";
const OUT = process.env.OUT ?? `${root}apps/editor/screenshots`;
mkdirSync(OUT, { recursive: true });

/** @type {{ name: string; view: string; theme?: "dark" | "light"; run?: (page: import("playwright").Page) => Promise<void> }[]} */
const SHOTS = [
  { name: "assistant-browser", view: "browser" },
  { name: "assistant-key", view: "key" },
  {
    name: "assistant-key-typed",
    view: "key",
    run: async (page) => {
      await page.locator('input[type="password"]').fill("my-key");
    },
  },
  { name: "assistant-key-unavailable", view: "key-unavailable" },
  { name: "assistant-empty", view: "empty" },
  { name: "assistant-chat", view: "chat" },
  { name: "assistant-chat-light", view: "chat", theme: "light" },
  {
    name: "assistant-key-saved",
    view: "empty",
    run: async (page) => {
      await page.getByRole("button", { name: "API key" }).click();
    },
  },
  {
    name: "assistant-model-picker",
    view: "empty",
    run: async (page) => {
      await page.getByRole("combobox", { name: "Model" }).or(page.getByRole("button", { name: /Sonnet 5/ })).first().click();
    },
  },
];

const wanted = new Set(process.argv.slice(2));
const browser = await chromium.launch({ args: ["--mute-audio"] });
let failures = 0;

for (const shot of SHOTS) {
  if (wanted.size && !wanted.has(shot.name)) continue;
  const context = await browser.newContext({ viewport: { width: 900, height: 860 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
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
    console.log(`[${shot.name}] page error: ${e.message}`);
  });
  await page.goto(`${BASE}?view=${shot.view}&theme=${shot.theme ?? "dark"}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".sb-assistant", { timeout: 15_000 });
  await page.waitForTimeout(400);
  if (shot.run) {
    await shot.run(page);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${OUT}/${shot.name}.png` });
  console.log(`wrote ${shot.name}.png`);
  await context.close();
}

await browser.close();
if (failures) process.exitCode = 1;
