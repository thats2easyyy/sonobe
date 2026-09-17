// Run `npm run demo:build -w @sonobe/renderer` first (or `npm run demo:screenshots -w @sonobe/renderer`).
// Opens each demo view in headless Chromium (muted), writes screenshots/*.png, and verifies
// text measurement vs DOM wrapping, input coordinate conversion, typing, and minimal writes.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "screenshots");
mkdirSync(outDir, { recursive: true });
const pageUrl = pathToFileURL(path.join(here, "index.html")).href;

const views = [
  { name: "specimens", width: 1320, height: 1080 },
  { name: "prototype", width: 560, height: 1000 },
  { name: "hit-targets", width: 560, height: 1000 },
  { name: "devices", width: 1360, height: 1180 },
];
const only = process.argv.slice(2);
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;

async function verifyInput(tab, scale) {
  const box = await tab.locator(".sonobe-stage").first().boundingBox();
  await tab.evaluate(() => {
    window.__sonobeEvents.length = 0;
    window.__rawWheel = 0;
    window.addEventListener("wheel", (e) => (window.__rawWheel += e.deltaY), { capture: true, passive: true });
  });
  await tab.mouse.move(box.x + 201 * scale, box.y + 316 * scale);
  await tab.mouse.down();
  await tab.mouse.move(box.x + 231 * scale, box.y + 326 * scale, { steps: 3 });
  await tab.mouse.up();
  await tab.mouse.wheel(0, 120);
  const events = await tab.evaluate(() => window.__sonobeEvents);
  // Synthetic wheel deltas arrive divided by the device scale factor; compare with what the page received.
  const rawWheel = await tab.evaluate(() => window.__rawWheel);
  const down = events.find((e) => e.kind === "pointer" && e.phase === "down");
  const up = events.find((e) => e.kind === "pointer" && e.phase === "up");
  // Chromium may split one wheel gesture into several events; the deltas must add up.
  const wheels = events.filter((e) => e.kind === "wheel");
  const dy = wheels.reduce((sum, e) => sum + e.dy, 0);
  check(down && near(down.x, 201) && near(down.y, 316), `pointer down in prototype coords (scale ${scale})`, JSON.stringify(down));
  check(up && near(up.x, 231) && near(up.y, 326), "pointer up after drag", JSON.stringify(up));
  check(events.some((e) => e.kind === "pointer" && e.phase === "move"), "pointer moves while dragging");
  check(wheels.length > 0 && rawWheel !== 0 && near(dy, rawWheel / scale, 0.5) && wheels.every((e) => near(e.x, 231) && near(e.y, 326)), "wheel deltas in points at the pointer", `${wheels.length} event(s), dy=${dy}, browser deltaY=${rawWheel}`);
  return box;
}

const browser = await chromium.launch({ args: ["--mute-audio", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
try {
  for (const view of views) {
    if (only.length && !only.includes(view.name)) continue;
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 2 });
    const tab = await context.newPage();
    const problems = [];
    tab.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") problems.push(`${msg.type()}: ${msg.text()}`);
    });
    tab.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
    await tab.goto(`${pageUrl}?view=${view.name}&static=1`);
    await tab.waitForFunction(() => window.__sonobeReady === true, null, { timeout: 30000 });
    const file = path.join(outDir, `${view.name}.png`);
    await tab.screenshot({ path: file, fullPage: true });
    console.log(`${view.name} → ${path.relative(process.cwd(), file)}`);
    for (const line of await tab.evaluate(() => window.__sonobeLog ?? [])) console.log(`  log ${line}`);

    if (view.name === "specimens") {
      const text = await tab.evaluate(() => window.__sonobeVerifyText());
      check(text.mismatches.length === 0, `text measurer matches DOM wrapping (${text.cases} cases)`, text.mismatches.slice(0, 8).join("\n    "));
      const bench = await tab.evaluate(() => window.__sonobeBench());
      check(bench.rerenderWrites === 0, "re-rendering an identical frame writes nothing", JSON.stringify(bench));
      const bitmapPath = await tab.evaluate(() => [...document.querySelectorAll('[data-type="shader"] canvas')].every((c) => c.getContext("2d") === null));
      check(bitmapPath, "shader layers receive frames via transferToImageBitmap (no pixel copy)");
    }
    if (view.name === "prototype") {
      const box = await verifyInput(tab, 1);
      await tab.evaluate(() => (window.__sonobeEvents.length = 0));
      await tab.locator(".sonobe-input").first().click();
      await tab.keyboard.type("hi");
      await tab.keyboard.press("Enter");
      let events = await tab.evaluate(() => window.__sonobeEvents);
      check(events.some((e) => e.kind === "text" && e.layerId === "search_field" && e.value === "hi"), "typing emits text events");
      check(events.some((e) => e.kind === "key" && e.key === "Enter"), "Enter from a text field is forwarded");
      check(!events.some((e) => e.kind === "key" && e.key === "h"), "typed characters are not forwarded as keys");
      await tab.evaluate(() => (window.__sonobeEvents.length = 0));
      await tab.mouse.click(box.x + 200, box.y + 600);
      await tab.keyboard.press("ArrowDown");
      events = await tab.evaluate(() => window.__sonobeEvents);
      check(events.some((e) => e.kind === "key" && e.phase === "down" && e.key === "ArrowDown"), "keys reach the prototype once it has focus");
      const bench = await tab.evaluate(() => window.__sonobeBench());
      check(bench.rerenderWrites === 0 && bench.writesPerFrame <= 4, "animated frames write only what changed", JSON.stringify(bench));
    }
    if (view.name === "devices") {
      // The first device is inside an ancestor scale(0.5).
      const box = await tab.locator(".sonobe-stage").first().boundingBox();
      await tab.evaluate(() => (window.__sonobeEvents.length = 0));
      await tab.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
      const events = await tab.evaluate(() => window.__sonobeEvents);
      const down = events.find((e) => e.kind === "pointer" && e.phase === "down");
      check(down && near(down.x, 201, 1.5) && near(down.y, 218.5, 1.5), "pointer coords account for ancestor CSS scale", JSON.stringify(down));
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
