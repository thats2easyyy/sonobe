/**
 * Fidelity check for the importer: for each fixture page, capture it with the DOM walker, import the
 * capture into a blank document, draw that document with Sonobe's DOM renderer, and write
 * source | imported | difference images side by side, plus the capture JSON and a layer outline.
 *
 *   node packages/import/scripts/fidelity.ts [fixtures or http(s) URLs...] [--out dir] [--width 402 --height 874]
 *
 * Needs Playwright's Chromium (`npx playwright install chromium`).
 */

import { build } from "esbuild";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyOps, createEmptyDocument, getOutline } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { chromium } from "playwright";
import { globalFetcher, planImport, resolveCaptureFiles, WALKER_SOURCE, type DesignCapture } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1]! : fallback;
};
const outDir = path.resolve(flag("out", path.join(here, "../fidelity-out")));
const width = Number(flag("width", "402"));
const height = Number(flag("height", "874"));
const fixtures = args.length ? args.map((a) => (/^https?:/.test(a) ? a : path.resolve(a))) : readdirSync(path.join(here, "../fixtures")).filter((f) => f.endsWith(".html")).map((f) => path.join(here, "../fixtures", f));
mkdirSync(outDir, { recursive: true });

const bundle = await build({ entryPoints: [path.join(here, "fidelity/page.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", logLevel: "silent" });
const pageScript = bundle.outputFiles[0]!.text;
const registry = createPatchRegistry();

const browser = await chromium.launch();
try {
  for (const fixture of fixtures) {
    const isUrl = /^https?:/.test(fixture);
    const name = isUrl ? new URL(fixture).host.replace(/[^a-z0-9]+/gi, "-") + new URL(fixture).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "") : path.basename(fixture, ".html");
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const source = await context.newPage();
    await source.goto(isUrl ? fixture : pathToFileURL(fixture).href);
    await source.addScriptTag({ content: WALKER_SOURCE });
    const capture = (await source.evaluate(() => (window as unknown as { __sonobeCapture(o: object): Promise<unknown> }).__sonobeCapture({ settleMs: 100 }))) as DesignCapture;
    await source.screenshot({ path: path.join(outDir, `${name}-source.png`) });

    const doc = createEmptyDocument({ name, device: "custom" });
    const sized = applyOps(doc, [{ op: "setProject", changes: { device: { preset: "custom", size: [width, height] } } }], { registry }).doc;
    const images = await resolveCaptureFiles(capture, { fetch: globalFetcher() });
    const plan = await planImport(capture, sized, images);
    const result = applyOps(sized, plan.ops, { registry });
    if (!result.ok) throw new Error(`${name}: ${result.errors.map((e) => e.message).join("; ")}`);
    const assets: Record<string, string> = {};
    for (const f of plan.files) {
      const record = Object.values(result.doc.assets).find((a) => a.file === f.file)!;
      assets[record.id] = `data:${f.mime};base64,${Buffer.from(f.bytes).toString("base64")}`;
    }

    const imported = await context.newPage();
    await imported.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><div id="stage" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px"></div></body></html>`);
    await imported.addScriptTag({ content: pageScript });
    await imported.evaluate(({ doc, assets }) => window.__renderDocument(doc as never, assets), { doc: result.doc, assets });
    await imported.screenshot({ path: path.join(outDir, `${name}-imported.png`) });

    // Side by side with a difference image.
    const compare = await context.newPage();
    await compare.setViewportSize({ width: width * 3 + 40, height: height + 30 });
    const src = `data:image/png;base64,${Buffer.from(await source.screenshot()).toString("base64")}`;
    const imp = `data:image/png;base64,${Buffer.from(await imported.screenshot()).toString("base64")}`;
    await compare.setContent(`<body style="margin:0;background:#333;font:12px system-ui;color:#fff;display:flex;gap:20px">
      <div><div>source</div><img src="${src}" width="${width}"></div>
      <div><div>imported</div><img src="${imp}" width="${width}"></div>
      <div><div>difference</div><div style="position:relative;width:${width}px;height:${height}px"><img src="${src}" width="${width}" style="position:absolute"><img src="${imp}" width="${width}" style="position:absolute;mix-blend-mode:difference"></div></div></body>`);
    await compare.waitForTimeout(200);
    await compare.screenshot({ path: path.join(outDir, `${name}-compare.png`) });
    writeFileSync(path.join(outDir, `${name}-capture.json`), JSON.stringify({ ...capture, images: Object.fromEntries(Object.entries(capture.images).map(([k, v]) => [k, { ...v, url: v.url.slice(0, 80) }])) }, null, 1));
    writeFileSync(path.join(outDir, `${name}-outline.txt`), getOutline(result.doc, result.doc.project.root));
    console.log(`${name}: ${plan.summary.layers} layers, ${plan.summary.texts} texts, ${plan.summary.images} images, ${plan.summary.fonts} fonts, ${plan.summary.scrolls} scrolls${plan.notes.length ? `\n  ${plan.notes.join("\n  ")}` : ""}`);
    await context.close();
  }
} finally {
  await browser.close();
}
