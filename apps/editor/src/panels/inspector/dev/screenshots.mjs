// Visual QA for the Inspector and Layers panels (Chromium, muted). Writes apps/editor/screenshots/inspector-*.png
// and layers-*.png, and fails (exit 1) when a check doesn't hold.
//
//   (cd apps/editor && npx vite --port 5213 --strictPort)                 # dev server
//   node apps/editor/src/panels/inspector/dev/screenshots.mjs [name…]      # all shots, or only the named ones

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const require = createRequire(`${root}package.json`);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:5213/src/panels/inspector/dev/index.html";
const OUT = process.env.OUT ?? `${root}apps/editor/screenshots`;
mkdirSync(OUT, { recursive: true });

const problems = [];
const check = (name, ok, detail) => {
  if (!ok) problems.push(`[${name}] ${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
};

const center = async (locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const inspectorRow = (page, name) => page.locator(".sb-insp-row").filter({ has: page.locator(".sb-insp-row__name", { hasText: new RegExp(`^${name}$`) }) }).first();
const layerRow = (page, name) => page.locator(".sb-tree__row").filter({ has: page.locator(".sb-tree__label", { hasText: new RegExp(`^${name}$`) }) }).first();
const outputHandle = (page, nodeId) => page.locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle.source`).first();
const doc = (page) => page.evaluate(() => window.__harness.session.document.getState().doc);
const layerProp = async (page, layerId, key) =>
  page.evaluate(
    ([id, prop]) => {
      const find = (layers) => {
        for (const layer of layers) {
          if (layer.id === id) return layer;
          const inner = layer.children ? find(layer.children) : undefined;
          if (inner) return inner;
        }
        return undefined;
      };
      return find(window.__harness.session.document.getState().doc.components.main.layers)?.props[prop];
    },
    [layerId, key],
  );

/** A PNG made in the page (a small sunset gradient), as bytes. */
async function samplePng(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 300;
    const g = canvas.getContext("2d");
    const gradient = g.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, "#FFB36B");
    gradient.addColorStop(0.6, "#FF6F91");
    gradient.addColorStop(1, "#6A5ACD");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 480, 300);
    g.fillStyle = "#FFE9B0";
    g.beginPath();
    g.arc(320, 130, 56, 0, Math.PI * 2);
    g.fill();
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** Start dragging a cable from a patch output; returns helpers to move and release it. */
async function startCable(page, nodeId) {
  const from = await center(outputHandle(page, nodeId));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 10, { steps: 4 });
  return {
    moveTo: async (locator) => {
      const to = await center(locator);
      await page.mouse.move(to.x, to.y, { steps: 18 });
      await page.waitForTimeout(120);
    },
    release: () => page.mouse.up(),
  };
}

/** @type {{ name: string; query?: string; run: (page: import("playwright").Page) => Promise<void> }[]} */
const SHOTS = [
  {
    name: "layers-01-default",
    query: "select=sun",
    run: async (page) => {
      check("layers-01", (await layerRow(page, "Sun").getAttribute("data-selected")) !== null, "Sun is selected in the tree");
    },
  },
  {
    name: "inspector-01-ports",
    query: "select=sun",
    run: async (page) => {
      await inspectorRow(page, "Opacity").hover();
      await page.waitForTimeout(150);
      check("inspector-01", (await page.locator('button[aria-label="Drive Opacity with a patch"]').count()) === 1, "Opacity has a Drive with a patch port");
    },
  },
  {
    name: "inspector-02-drive-picker",
    query: "select=sun",
    run: async (page) => {
      await page.locator('button[aria-label="Drive Opacity with a patch"]').click();
      await page.waitForTimeout(700);
      const targets = await page.evaluate(() => window.__harness.bridge().targets.main ?? []);
      check("inspector-02", targets.includes("@sun.opacity"), `patch editor shows the Opacity target (${targets.join(", ")})`);
    },
  },
  {
    name: "inspector-03-cable-over-row",
    query: "select=sun",
    run: async (page) => {
      const cable = await startCable(page, "zoom_spring");
      await cable.moveTo(inspectorRow(page, "Opacity"));
      const drop = await inspectorRow(page, "Opacity").getAttribute("data-drop");
      check("inspector-03", drop === "accept", `Opacity accepts the cable (data-drop=${drop})`);
      const hint = await inspectorRow(page, "Opacity").locator(".sb-insp-row__drop-hint").innerText().catch(() => "");
      check("inspector-03", hint.startsWith("Drive Opacity from"), `drop hint reads "${hint}"`);
      await page.screenshot({ path: `${OUT}/inspector-03-cable-over-row.png`, animations: "disabled", caret: "hide" });
      await cable.moveTo(layerRow(page, "Near Hill"));
      const overlay = layerRow(page, "Near Hill").locator("[data-sb-layer-drop]");
      check("layers-02", (await overlay.getAttribute("data-hover")) !== null, "Near Hill row lights up under the cable");
      await page.screenshot({ path: `${OUT}/layers-02-cable-over-row.png`, animations: "disabled", caret: "hide" });
      await cable.moveTo(inspectorRow(page, "Opacity"));
      await cable.release();
      await page.waitForTimeout(400);
      const opacity = await layerProp(page, "sun", "opacity");
      check("inspector-04", opacity?.link === "zoom_spring.output", `releasing connects Sun's Opacity (${JSON.stringify(opacity)})`);
    },
    after: "inspector-04-connected",
  },
  {
    name: "inspector-05-type-conflict",
    query: "patch=photo_scale",
    run: async (page) => {
      await page.locator('button[aria-label="Value type: Number"]').click();
      await page.locator('[role="option"]', { hasText: /^Color$/ }).click();
      await page.waitForTimeout(250);
      const card = page.locator('[role="alertdialog"]');
      check("inspector-05", (await card.count()) === 1, "Type change shows the conflict card");
      check("inspector-05", (await card.innerText()).includes("disconnects"), "card explains which cables disconnect");
    },
  },
  {
    name: "inspector-06-light-conflict",
    query: "theme=light&patch=photo_scale",
    run: async (page) => {
      await page.locator('button[aria-label="Value type: Number"]').click();
      await page.locator('[role="option"]', { hasText: /^Color$/ }).click();
      await page.waitForTimeout(250);
      check("inspector-06", (await page.locator('[role="alertdialog"]').count()) === 1, "light theme conflict card");
    },
  },
  {
    name: "inspector-07-asset-empty",
    query: "select=hero",
    run: async (page) => {
      check("inspector-07", (await page.locator(".sb-insp-dropzone").count()) === 1, "empty Image shows the import drop zone");
    },
  },
  {
    name: "inspector-08-asset-imported",
    query: "select=hero",
    run: async (page) => {
      const buffer = await samplePng(page);
      await page.locator('input[type="file"][aria-label="Import a file for Image"]').setInputFiles({ name: "Sunset.png", mimeType: "image/png", buffer });
      await page.waitForFunction(() => {
        const find = (layers) => layers.find((l) => l.id === "hero");
        return !!find(window.__harness.session.document.getState().doc.components.main.layers)?.props.image;
      });
      await page.waitForTimeout(300);
      const image = await layerProp(page, "hero", "image");
      const assets = (await doc(page)).assets;
      check("inspector-08", !!image?.asset && assets[image.asset]?.width === 480, `imported Sunset.png (${JSON.stringify(assets[image?.asset])})`);
    },
  },
  {
    name: "layers-03-file-drag",
    query: "select=photo",
    run: async (page) => {
      const buffer = [...(await samplePng(page))];
      await layerRow(page, "Photo").evaluate((row, bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], "Beach.png", { type: "image/png" }));
        row.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
        row.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        window.__dropTransfer = dt;
      }, buffer);
      await page.waitForTimeout(150);
      const label = await layerRow(page, "Photo").locator('.sb-layerspanel__drop[data-kind="file"]').innerText().catch(() => "");
      check("layers-03", label === "Add image to Photo", `drop label reads "${label}"`);
      await page.screenshot({ path: `${OUT}/layers-03-file-drag.png`, animations: "disabled", caret: "hide" });
      await layerRow(page, "Photo").evaluate((row) => row.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: window.__dropTransfer })));
      await page.waitForFunction(() => window.__harness.session.selection.getState().layers.some((id) => id.startsWith("beach")), undefined, { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(400);
      const selected = await page.evaluate(() => window.__harness.session.selection.getState().layers);
      check("layers-04", selected.length === 1 && selected[0].startsWith("beach"), `dropped image becomes a selected layer (${selected.join(", ")})`);
    },
    after: "layers-04-file-dropped",
  },
  {
    name: "inspector-09-light-layer",
    query: "theme=light&select=sun",
    run: async (page) => {
      await inspectorRow(page, "Opacity").hover();
      await page.waitForTimeout(150);
    },
  },
  {
    name: "layers-05-light",
    query: "theme=light&select=like_button",
    run: async (page) => {
      check("layers-05", (await page.locator(".sb-tree__row").count()) > 5, "light theme tree renders");
    },
  },
  {
    name: "inspector-10-light-cable-over-row",
    query: "theme=light&select=sun",
    run: async (page) => {
      const cable = await startCable(page, "like_spring");
      await cable.moveTo(inspectorRow(page, "Opacity"));
      check("inspector-10", (await inspectorRow(page, "Opacity").getAttribute("data-drop")) === "accept", "light theme drop highlight");
      await page.screenshot({ path: `${OUT}/inspector-10-light-cable-over-row.png`, animations: "disabled", caret: "hide" });
      await cable.moveTo(page.locator(".sb-pe .react-flow__pane"));
      await page.keyboard.press("Escape");
      await cable.release();
    },
    skipShot: true,
  },
];

const only = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--mute-audio"] });
try {
  for (const shot of SHOTS) {
    if (only.length && !only.some((name) => shot.name.includes(name))) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        // Storage blocked.
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${BASE}?mute=1${shot.query ? `&${shot.query}` : ""}`);
    await page.waitForSelector("body[data-harness-ready]");
    await page.waitForSelector(".sb-pe .react-flow__node");
    await page.waitForSelector(".sb-tree__row");
    await page.waitForTimeout(900);
    await shot.run(page);
    if (!shot.skipShot && !shot.after) await page.screenshot({ path: `${OUT}/${shot.name}.png`, animations: "disabled", caret: "hide" });
    if (shot.after) await page.screenshot({ path: `${OUT}/${shot.after}.png`, animations: "disabled", caret: "hide" });
    check(shot.name, errors.length === 0, errors.length ? `console errors: ${errors.slice(0, 3).join(" | ")}` : "no console errors");
    await context.close();
  }
} finally {
  await browser.close();
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("\nAll inspector and layers checks passed.");
