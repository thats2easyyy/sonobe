// Generates the welcome screen's template thumbnails: renders each example in examples/ headlessly
// (muted Chromium, the real engine, patch library, and DOM renderer at a fixed timestep) and writes
// apps/editor/src/app/welcome/thumbnails/<folder>.png, cropped to the top 4:5 of the screen.
//
//   node apps/editor/scripts/generate-thumbnails.mjs               every example
//   node apps/editor/scripts/generate-thumbnails.mjs 01-tap-to-grow  selected folders
//
// Re-run it after changing an example's look. The PNGs are committed so builds don't need a browser.
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const examplesDir = path.join(repo, "examples");
const outDir = path.join(repo, "apps/editor/src/app/welcome/thumbnails");

/** Frames before the screenshot (1/60 s each), so entrance animations settle. */
const FRAMES = 90;
/** Points → CSS pixels. At deviceScaleFactor 2 a 402-point phone becomes a 362-pixel-wide thumbnail. */
const SCALE = 0.45;
const DEVICE_SCALE = 2;

const wanted = process.argv.slice(2);
const folders = readdirSync(examplesDir)
  .filter((f) => /^\d\d-/.test(f) && existsSync(path.join(examplesDir, f, "project.json")))
  .filter((f) => wanted.length === 0 || wanted.includes(f))
  .sort();
if (folders.length === 0) {
  console.error(`No examples match ${wanted.join(", ")}.`);
  process.exit(2);
}

/** Project files as the editor's examples glob sees them: project.json, knobs.json, components, scripts, assets.json. */
function projectFiles(folder) {
  const dir = path.join(examplesDir, folder);
  const files = { "project.json": readFileSync(path.join(dir, "project.json"), "utf8") };
  for (const sub of ["components", "scripts"]) {
    const subDir = path.join(dir, sub);
    if (!existsSync(subDir)) continue;
    for (const name of readdirSync(subDir)) files[`${sub}/${name}`] = readFileSync(path.join(subDir, name), "utf8");
  }
  for (const rel of ["knobs.json", "assets/assets.json"]) {
    if (existsSync(path.join(dir, rel))) files[rel] = readFileSync(path.join(dir, rel), "utf8");
  }
  return files;
}

/** The example's asset files (photos, icons) as file URLs, by file name. */
function assetUrls(folder) {
  const dir = path.join(examplesDir, folder, "assets");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).filter((name) => name !== "assets.json").map((name) => [name, pathToFileURL(path.join(dir, name)).href]));
}

const work = mkdtempSync(path.join(tmpdir(), "sonobe-thumbnails-"));
let failures = 0;
try {
  await build({
    entryPoints: [path.join(here, "thumbnails/page.ts")],
    bundle: true,
    format: "iife",
    target: "es2022",
    outfile: path.join(work, "page.js"),
    logLevel: "warning",
  });
  writeFileSync(
    path.join(work, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}#stage{position:relative;overflow:hidden;isolation:isolate}</style></head><body><div id="stage"></div><script src="page.js"></script></body></html>`,
  );
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ args: ["--mute-audio"] });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 1000 }, deviceScaleFactor: DEVICE_SCALE });
    page.on("pageerror", (error) => console.error(`  page error: ${error.message}`));
    await page.goto(pathToFileURL(path.join(work, "index.html")).href);
    await page.waitForFunction(() => !!window.__sonobeThumbnail);
    for (const folder of folders) {
      const result = await page.evaluate(({ files, frames, scale, urls }) => window.__sonobeThumbnail.render(files, frames, scale, urls), { files: projectFiles(folder), frames: FRAMES, scale: SCALE, urls: assetUrls(folder) });
      // Let images decode, then let them and the fonts paint.
      await page.waitForFunction(() => [...document.querySelectorAll("#stage img")].every((img) => img.complete), undefined, { timeout: 10_000 });
      await page.waitForTimeout(120);
      const height = Math.min(result.height, Math.round((result.width * 5) / 4));
      const file = path.join(outDir, `${folder}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: result.width, height }, animations: "disabled" });
      const kb = Math.round(readFileSync(file).length / 1024);
      if (result.errors.length) {
        failures++;
        console.log(`✗ ${folder} (${kb} KB) — runtime errors: ${result.errors.join("; ")}`);
      } else {
        console.log(`✓ ${folder} → ${path.relative(repo, file)} (${kb} KB)`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
