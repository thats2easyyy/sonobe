/**
 * The built web player in real mobile Chromium (Playwright), served by the real LAN preview server:
 * taps reach the device as navigator.vibrate calls on Android and as bridge messages under a native
 * host like Sonobe Viewer. Skipped without Playwright's browser.
 */

import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hapticCheckDocument, servePlayer, type TestPlayerServer } from "./testing.ts";

type Browser = import("playwright").Browser;

const playwright = await (async () => {
  try {
    const mod = await import("playwright");
    return existsSync(mod.chromium.executablePath()) ? mod : null;
  } catch {
    return null;
  }
})();

/** What an Android phone's browser has: navigator.vibrate. */
function androidHost() {
  const w = window as unknown as { __vibrations: unknown[] };
  w.__vibrations = [];
  Object.defineProperty(Navigator.prototype, "vibrate", {
    configurable: true,
    value: (pattern: unknown) => {
      w.__vibrations.push(pattern);
      return true;
    },
  });
}

/** What Sonobe Viewer injects at document start. iOS has no navigator.vibrate. */
function nativeHost() {
  const w = window as unknown as { __posted: unknown[]; sonobeNative: unknown; webkit: unknown };
  w.__posted = [];
  w.sonobeNative = Object.freeze({ version: 1, platform: "ios", haptics: ["vibrate", "selection", "impactLight", "impactMedium", "impactHeavy", "notificationSuccess", "notificationWarning", "notificationError"], vibrate: true });
  w.webkit = { messageHandlers: { sonobe: { postMessage: (message: unknown) => w.__posted.push(message) } } };
  delete (Navigator.prototype as { vibrate?: unknown }).vibrate;
}

describe.skipIf(!playwright)("web player on a phone", () => {
  let server: TestPlayerServer;
  let browser: Browser;

  beforeAll(async () => {
    server = await servePlayer({ doc: hapticCheckDocument() });
    browser = await playwright!.chromium.launch({ args: ["--mute-audio"] });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function tapTwice(init: () => void) {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    try {
      await context.addInitScript(init);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto(server.url);
      await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "live", null, { timeout: 15_000 });
      await page.getByText("0", { exact: true }).waitFor({ timeout: 10_000 });
      for (let i = 0; i < 2; i++) {
        await page.touchscreen.tap(201, 600);
        await page.waitForTimeout(150);
      }
      await page.getByText("2", { exact: true }).waitFor({ timeout: 5_000 });
      const reached = await page.evaluate(() => {
        const w = window as unknown as { __vibrations?: unknown[]; __posted?: unknown[] };
        return { vibrations: w.__vibrations ?? null, posted: w.__posted ?? null };
      });
      return { ...reached, errors };
    } finally {
      await context.close();
    }
  }

  it("vibrates through navigator.vibrate on Android", { timeout: 60_000 }, async () => {
    const { vibrations, errors } = await tapTwice(androidHost);
    expect(errors).toEqual([]);
    // Notification Success at start, then Impact Medium's plan and a 50 ms Vibrate per tap.
    expect(vibrations).toHaveLength(5);
    expect(vibrations).toEqual(expect.arrayContaining([[15, 80, 25], [20], 50]));
    expect(vibrations!.filter((v) => JSON.stringify(v) === "[20]")).toHaveLength(2);
  });

  it("sends Haptic and Vibrate to a native host", { timeout: 60_000 }, async () => {
    const { posted, errors } = await tapTwice(nativeHost);
    expect(errors).toEqual([]);
    const count = (message: object) => posted!.filter((m) => JSON.stringify(m) === JSON.stringify(message)).length;
    expect(count({ kind: "haptic", type: "notificationSuccess" })).toBe(1);
    expect(count({ kind: "haptic", type: "impactMedium" })).toBe(2);
    expect(count({ kind: "vibrate", pattern: 50 })).toBe(2);
    expect(posted).toHaveLength(5);
  });
});
