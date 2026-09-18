#!/usr/bin/env node
/**
 * Loads the built extension into Chromium (Playwright) against a local page and checks both paths:
 * copying the page through the service worker, and the element picker copying one card to the
 * clipboard through the offscreen document. Then imports the capture with @sonobe/import.
 *
 *   node integrations/chrome-extension/smoke.ts    (builds a test copy with --test into dist-test/)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOps, createEmptyDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { chromium } from "playwright";
import { parseCapture, planImport, resolveCaptureFiles } from "../../packages/import/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist-test");
execFileSync(process.execPath, [path.join(here, "build.ts"), "--out", dist, "--test"], { stdio: "inherit" });
const profile = readFileSync(path.join(here, "../../packages/import/fixtures/profile.html"), "utf8");
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(profile);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const userData = mkdtempSync(path.join(tmpdir(), "sonobe-extension-"));
const assert = (ok: unknown, message: string) => {
  if (!ok) throw new Error(`Assertion failed: ${message}`);
};

const context = await chromium.launchPersistentContext(userData, {
  channel: "chromium",
  viewport: { width: 402, height: 874 },
  permissions: ["clipboard-read", "clipboard-write"],
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();

  const tabId = await worker.evaluate(async (pageUrl) => (await chrome.tabs.query({})).find((t) => t.url === pageUrl)?.id ?? -1, url);
  assert(tabId >= 0, "the page's tab");
  const reply = await worker.evaluate(async (id) => (globalThis as unknown as { captureTab(id: number, r: object): Promise<{ ok: boolean; text?: string; message?: string; summary?: string }> }).captureTab(id, {}), tabId);
  assert(reply.ok, `the page captures: ${reply.message}`);
  const capture = parseCapture(reply.text!);
  assert(capture.source.kind === "chrome" && capture.root.name === "Profile", "capture source and screen name");
  console.log(`[extension] page: ${reply.summary}`);

  // The picker: click the card, and the offscreen document puts the capture on the clipboard.
  await worker.evaluate((id) => (globalThis as unknown as { startPicker(id: number): Promise<void> }).startPicker(id), tabId);
  const card = page.locator("[data-name='Profile Card']");
  const box = (await card.boundingBox())!;
  // Point at the bio inside the card, then climb to the card with ↑ and copy it with Enter.
  await page.mouse.move(box.x + 60, box.y + 130);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("[data-sonobe-capture-target]"), undefined, { timeout: 15_000 });
  const picked = parseCapture(await page.evaluate(() => navigator.clipboard.readText()));
  assert(picked.root.name === "Profile Card" && picked.root.box[0] === 0, "the picked element on the clipboard");
  console.log(`[extension] picked: ${picked.root.name} ${picked.root.box[2]}×${picked.root.box[3]}`);

  const doc = createEmptyDocument();
  const plan = await planImport(picked, doc, await resolveCaptureFiles(picked), {});
  const result = applyOps(doc, plan.ops, { registry: createPatchRegistry() });
  assert(result.ok, `the pasted capture imports: ${result.errors.map((e) => e.message).join("; ")}`);
  console.log(`[extension] imports as ${plan.summary.layers} layers · ok`);
} finally {
  await context.close();
  server.close();
  rmSync(userData, { recursive: true, force: true });
}
