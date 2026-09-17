// Run `npm run demo:build -w @sonobe/renderer` first (or `npm run demo:screenshots -w @sonobe/renderer`).
// Opens each demo view in headless Chromium (muted), writes screenshots/*.png, and verifies
// text measurement vs DOM wrapping, input events (types, timestamps, leave, text-field focus
// and submit), Lottie playback, shader textures, minimal writes, and the 500-node frame budget.
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
  { name: "stress", width: 560, height: 1000 },
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
  const pointers = events.filter((e) => e.kind === "pointer");
  const down = pointers.find((e) => e.phase === "down");
  const up = pointers.find((e) => e.phase === "up");
  // Chromium may split one wheel gesture into several events; the deltas must add up.
  const wheels = events.filter((e) => e.kind === "wheel");
  const dy = wheels.reduce((sum, e) => sum + e.dy, 0);
  check(down && near(down.x, 201) && near(down.y, 316), `pointer down in prototype coords (scale ${scale})`, JSON.stringify(down));
  check(up && near(up.x, 231) && near(up.y, 326), "pointer up after drag", JSON.stringify(up));
  check(pointers.some((e) => e.phase === "move"), "pointer moves while dragging");
  // Hover moves before the press report 0; drag moves between down and up report the held primary button.
  const downAt = pointers.indexOf(down);
  const upAt = pointers.indexOf(up);
  const hoverMoves = pointers.slice(0, downAt).filter((e) => e.phase === "move");
  const dragMoves = pointers.slice(downAt + 1, upAt).filter((e) => e.phase === "move");
  check(down?.buttons === 1 && up?.buttons === 0 && dragMoves.length > 0 && dragMoves.every((e) => e.buttons === 1) && hoverMoves.every((e) => e.buttons === 0), "pointer events carry the buttons bitmask (0 hovering, 1 while pressed, 0 after release)", JSON.stringify(pointers.map((e) => `${e.phase}:${e.buttons}`)));
  const times = pointers.map((e) => e.timeStamp);
  check(pointers.every((e) => e.pointerType === "mouse" && typeof e.timeStamp === "number") && times.every((t, i) => i === 0 || t >= times[i - 1]), "pointer events carry pointerType and increasing timeStamps", JSON.stringify(times.slice(0, 6)));
  const rafClock = await tab.evaluate(() => new Promise((resolve) => requestAnimationFrame((t) => resolve(t))));
  check(Math.abs(rafClock - times.at(-1)) < 10000, "timeStamps share the requestAnimationFrame clock", `raf=${Math.round(rafClock)} last=${Math.round(times.at(-1))}`);
  check(wheels.length > 0 && rawWheel !== 0 && near(dy, rawWheel / scale, 0.5) && wheels.every((e) => near(e.x, 231) && near(e.y, 326)), "wheel deltas in points at the pointer", `${wheels.length} event(s), dy=${dy}, browser deltaY=${rawWheel}`);
  await tab.evaluate(() => (window.__sonobeEvents.length = 0));
  await tab.mouse.move(box.x - 12, box.y + 316 * scale, { steps: 4 });
  const left = await tab.evaluate(() => window.__sonobeEvents.filter((e) => e.kind === "pointer"));
  check(left.at(-1)?.phase === "leave" && !left.some((e) => e.phase === "move" && e.x < 0), "leaving the viewer emits a leave phase (no synthetic outside move)", JSON.stringify(left.at(-1)));
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
      const bitmapPath = await tab.evaluate(() => [...document.querySelectorAll('[data-type="shader"] canvas')].every((c) => c.getContext("2d") === null));
      check(bitmapPath, "shader layers receive frames via transferToImageBitmap (no pixel copy)");
      // The ripple shader outputs only what it samples, so opaque pixels prove the image texture is bound.
      const texel = await tab.evaluate(() => {
        const src = document.querySelector('[data-key="fx_texture"] canvas');
        const probe = document.createElement("canvas");
        probe.width = src.width;
        probe.height = src.height;
        const g = probe.getContext("2d");
        g.drawImage(src, 0, 0);
        const d = g.getImageData(Math.floor(src.width / 2), Math.floor(src.height * 0.3), 1, 1).data;
        return [...d];
      });
      check(texel[3] > 200 && texel[0] + texel[1] + texel[2] > 60, "shader iChannel0 samples the image asset", JSON.stringify(texel));
      const lottie = await tab.evaluate(() => ({
        playing: document.querySelectorAll('[data-key="lottie"] svg path').length,
        scrub: document.querySelectorAll('[data-key="lottie_scrub"] svg path').length,
        missing: document.querySelector('[data-key="lottie_missing"] .sonobe-placeholder')?.textContent ?? null,
        media: window.__sonobeMedia,
      }));
      check(lottie.playing > 0 && lottie.scrub > 0, "lottie layers render with lottie-web (inline JSON and asset URL)", `paths ${lottie.playing}/${lottie.scrub}`);
      check(near(lottie.media.lottie_scrub?.currentTime ?? -1, 1.4, 0.001) && near(lottie.media.lottie_scrub?.duration ?? 0, 2, 0.001), "lottie reports currentTime and duration", JSON.stringify(lottie.media.lottie_scrub));
      check(typeof lottie.missing === "string" && lottie.missing.includes("confetti"), "a lottie that can't load shows a placeholder", JSON.stringify(lottie.missing));
      await tab.evaluate(() => (window.__sonobeReady = false));
      const before = await tab.evaluate(() => window.__sonobeMedia.lottie?.currentTime ?? null);
      await tab.goto(`${pageUrl}?view=specimens`);
      await tab.waitForFunction(() => window.__sonobeReady === true, null, { timeout: 30000 });
      // Swiftshader frames are slow; wait for playback to move rather than sleeping a fixed time.
      await tab.waitForFunction(() => (window.__sonobeMedia.lottie?.currentTime ?? 0) > 0.2, null, { timeout: 5000 }).catch(() => {});
      const after = await tab.evaluate(() => window.__sonobeMedia.lottie?.currentTime ?? null);
      check(after !== null && after > 0.2 && after !== before, "lottie advances with frame time while playing", `currentTime ${before} → ${after}`);
      const bench = await tab.evaluate(() => window.__sonobeBench());
      check(bench.rerenderWrites === 0, "re-rendering an identical frame writes nothing", JSON.stringify(bench));
    }
    if (view.name === "prototype") {
      const box = await verifyInput(tab, 1);
      await tab.evaluate(() => (window.__sonobeEvents.length = 0));
      await tab.locator(".sonobe-input").first().click();
      await tab.keyboard.type("hi");
      await tab.keyboard.press("Enter");
      let events = await tab.evaluate(() => window.__sonobeEvents);
      check(events.some((e) => e.kind === "focus" && e.layerId === "search_field" && e.key === "search_field" && e.focused === true), "focusing a text field emits a focus event");
      check(events.some((e) => e.kind === "text" && e.layerId === "search_field" && e.key === "search_field" && e.value === "hi"), "typing emits keyed text events");
      check(events.some((e) => e.kind === "submit" && e.layerId === "search_field"), "Return emits a submit event");
      check(events.some((e) => e.kind === "key" && e.key === "Enter"), "Enter from a text field is forwarded");
      check(!events.some((e) => e.kind === "key" && e.key === "h"), "typed characters are not forwarded as keys");
      await tab.evaluate(() => (window.__sonobeEvents.length = 0));
      await tab.mouse.click(box.x + 200, box.y + 600);
      await tab.keyboard.press("ArrowDown");
      events = await tab.evaluate(() => window.__sonobeEvents);
      check(events.some((e) => e.kind === "focus" && e.focused === false), "clicking away emits focus false");
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
    if (view.name === "stress") {
      const bench = await tab.evaluate(() => window.__sonobeBench());
      check(bench.nodes === 500, "stress scene has 500 nodes", String(bench.nodes));
      check(bench.medianMs < 4, "500-node animated frames render in < 4 ms", JSON.stringify(bench));
      // 100 row transforms + 100 bar widths change per frame; nothing else may be written.
      check(bench.writesPerFrame <= 200 && bench.rerenderWrites === 0, "500-node frames write only what changed", `${bench.writesPerFrame} writes/frame`);
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
