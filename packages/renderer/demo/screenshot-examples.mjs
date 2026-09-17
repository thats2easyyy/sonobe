// Run `npm run demo:examples:build -w @sonobe/renderer` first (or `npm run demo:examples -w @sonobe/renderer`).
// Loads example projects from examples/, runs them through the engine runtime with the full patch library in
// headless Chromium (muted), and writes screenshots/examples-<folder>[-<state>].png. It verifies that every
// layer with a corner radius draws rounded corners (the engine resolves unset cornerRadii to [0, 0, 0, 0]),
// that the runtime raises no errors, and that taps and drags reach the prototype through the renderer's input
// capture.
//
//   node demo/screenshot-examples.mjs                    01, 02, 04, 08, 15
//   node demo/screenshot-examples.mjs 03-scrolling-list  selected folders ("all" for every example)
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadProjectFromDisk } from "@sonobe/core/node";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(here, "../../../examples");
const outDir = path.join(here, "screenshots");
mkdirSync(outDir, { recursive: true });
const pageUrl = pathToFileURL(path.join(here, "examples.html")).href;

/**
 * Per-example settle time and scripted states. Taps and drags use Playwright's mouse on the rendered
 * stage; frames are stepped deterministically between input samples.
 */
const SCRIPTS = {
  "01-tap-to-grow": {
    states: [{ name: "zoomed", actions: [{ tap: "card" }], after: 75, expect: [["card_zoomed.on", true]] }],
  },
  "02-like-toggle": {
    corners: [["post", 28], ["post_photo", 20]],
    states: [{ name: "liked", actions: [{ tap: "heart_button" }], after: 85, expect: [["liked.on", true], ["@likes.text", "129 likes"]] }],
  },
  "04-carousel-paging": {
    corners: [["trip_1", 28], ["next_button", 28]],
    states: [{ name: "page-2", actions: [{ drag: [[330, 420], [70, 420]], frames: 8 }], after: 90, expect: [["trips_scroll.pageX", 1]] }],
  },
  "08-bottom-sheet": {
    corners: [["sheet", 28], ["search", 12]],
    states: [{ name: "dragged", actions: [{ drag: [["grabber"], [201, 300]], frames: 18 }], after: 90 }],
  },
  "15-grid-with-loops": {
    settle: 150,
    corners: [["preview", 24], ["tile#0", 18]],
    states: [{ name: "picked", actions: [{ tap: "tile#7" }], after: 40, expect: [["selected_tile.option", 7]] }],
  },
};

const DEFAULT_EXAMPLES = ["01-tap-to-grow", "02-like-toggle", "04-carousel-paging", "08-bottom-sheet", "15-grid-with-loops"];
const args = process.argv.slice(2);
const folders = args.includes("all")
  ? readdirSync(examplesDir).filter((f) => /^\d\d-/.test(f) && existsSync(path.join(examplesDir, f, "project.json"))).sort()
  : args.length
    ? args
    : DEFAULT_EXAMPLES;

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const sameValue = (a, b) => (typeof b === "number" ? typeof a === "number" && Math.abs(a - b) < 1e-3 : JSON.stringify(a) === JSON.stringify(b));

async function point(tab, target) {
  // A layer id / SceneNode key, or a prototype point [x, y].
  const p = typeof target === "string" ? await tab.evaluate((id) => window.__sonobeExamples.layerCenter(id), target) : await tab.evaluate(([x, y]) => window.__sonobeExamples.prototypePoint(x, y), target);
  if (!p) throw new Error(`no layer "${target}"`);
  return p;
}

const step = (tab, frames) => tab.evaluate((n) => window.__sonobeExamples.step(n), frames);

async function perform(tab, action) {
  if (action.tap) {
    const p = await point(tab, action.tap);
    await tab.mouse.move(p.x, p.y);
    await tab.mouse.down();
    await step(tab, 2);
    await tab.mouse.up();
    await step(tab, 1);
    return;
  }
  const [from, to] = action.drag.map((t) => (t.length === 1 ? t[0] : t));
  const a = await point(tab, from);
  const b = await point(tab, to);
  const frames = action.frames ?? 10;
  await tab.mouse.move(a.x, a.y);
  await tab.mouse.down();
  await step(tab, 1);
  for (let i = 1; i <= frames; i++) {
    await tab.mouse.move(a.x + ((b.x - a.x) * i) / frames, a.y + ((b.y - a.y) * i) / frames);
    await step(tab, 1);
  }
  await tab.mouse.up();
  await step(tab, 1);
}

async function verifyCorners(tab, script) {
  const audit = await tab.evaluate(() => window.__sonobeExamples.auditCorners());
  check(audit.checked > 0 && audit.failures.length === 0, `rounded corners on all ${audit.checked} radius-bearing layers`, audit.failures.slice(0, 6).join("\n    "));
  for (const [id, radius] of script.corners ?? []) {
    const drawn = await tab.evaluate((key) => window.__sonobeExamples.cornerStyle(key), id);
    check(drawn?.body === `${radius}px`, `${id} draws a ${radius}pt corner radius`, JSON.stringify(drawn));
  }
}

const browser = await chromium.launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const folder of folders) {
    const dir = path.join(examplesDir, folder);
    if (!existsSync(path.join(dir, "project.json"))) {
      check(false, `${folder} exists`, dir);
      continue;
    }
    const doc = await loadProjectFromDisk(dir);
    const assetUrls = Object.fromEntries(Object.entries(doc.assets ?? {}).map(([id, rec]) => [id, pathToFileURL(path.join(dir, "assets", rec.file)).href]));
    const script = SCRIPTS[folder] ?? {};
    console.log(`${folder}`);
    const context = await browser.newContext({ viewport: { width: 560, height: 1000 }, deviceScaleFactor: 2 });
    const tab = await context.newPage();
    const problems = [];
    tab.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") problems.push(`${msg.type()}: ${msg.text()}`);
    });
    tab.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
    await tab.goto(pageUrl);
    await tab.waitForFunction(() => window.__sonobeReady === true, null, { timeout: 30000 });
    const loaded = await tab.evaluate(([d, urls, frames]) => window.__sonobeExamples.load(d, { assetUrls: urls, frames }), [doc, assetUrls, script.settle ?? 60]);
    const errors = loaded.issues.filter((i) => i.startsWith("error"));
    check(errors.length === 0, `runs with no runtime errors (${loaded.nodes} scene nodes)`, errors.slice(0, 4).join("\n    "));
    for (const issue of loaded.issues.filter((i) => !i.startsWith("error"))) console.log(`  · ${issue}`);
    await verifyCorners(tab, script);
    const shot = async (suffix) => {
      const file = path.join(outDir, `examples-${folder}${suffix ? `-${suffix}` : ""}.png`);
      await tab.locator(".device-stage").screenshot({ path: file });
      console.log(`  → ${path.relative(process.cwd(), file)}`);
    };
    await shot("");
    for (const state of script.states ?? []) {
      try {
        for (const action of state.actions) await perform(tab, action);
        await step(tab, state.after ?? 60);
        for (const [address, expected] of state.expect ?? []) {
          const value = await tab.evaluate((a) => window.__sonobeExamples.getValue(a), address);
          check(sameValue(value, expected), `${state.name}: ${address} is ${JSON.stringify(expected)}`, JSON.stringify(value));
        }
        await verifyCorners(tab, { corners: [] });
        await shot(state.name);
      } catch (err) {
        check(false, `${state.name} runs`, String(err));
      }
    }
    for (const line of problems) {
      console.log(`  ${line}`);
      if (line.startsWith("pageerror") || line.startsWith("error")) failures++;
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
