/**
 * The built web player in real mobile Chromium (Playwright), served by the real LAN preview server:
 * taps reach the device as navigator.vibrate calls on Android and as bridge messages under a native
 * host like Sonobe Viewer; Sonobe's restart reaches the phone; a three-finger tap opens the menu
 * without touching the prototype; and Network Request and remote images reach other hosts through
 * the player's CSP. Skipped without Playwright's browser.
 */

import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildDoc } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hapticCheckDocument, servePlayer, type TestPlayerServer } from "./testing.ts";

type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

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

/** Sonobe Viewer with bridge version 2: the menu's Open Another Prototype, and the tip it remembers. */
function nativeHostV2() {
  const w = window as unknown as { __posted: unknown[]; sonobeNative: unknown; webkit: unknown };
  w.__posted = [];
  w.sonobeNative = Object.freeze({ version: 2, platform: "ios", haptics: ["impactMedium", "notificationSuccess"], vibrate: true, actions: ["openAnother"], menuTipSeen: false });
  w.webkit = { messageHandlers: { sonobe: { postMessage: (message: unknown) => w.__posted.push(message) } } };
  delete (Navigator.prototype as { vibrate?: unknown }).vibrate;
}

const posted = (page: Page) => page.evaluate(() => (window as unknown as { __posted: unknown[] }).__posted.map((m) => JSON.stringify(m)));
const count = (messages: string[], message: object) => messages.filter((m) => m === JSON.stringify(message)).length;

/** Three fingers down one after another, then up: what Chromium's touch emulation sends as pointer and touch events. */
async function threeFingerTap(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const fingers = [
    { x: 120, y: 560, id: 1 },
    { x: 200, y: 580, id: 2 },
    { x: 280, y: 560, id: 3 },
  ];
  for (let n = 1; n <= 3; n++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers.slice(0, n) });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
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

  async function openPlayer(init: () => void, url = server.url) {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.addInitScript(init);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "live", null, { timeout: 15_000 });
    return { context, page, errors };
  }

  it("restarts when Sonobe restarts the prototype", { timeout: 60_000 }, async () => {
    const { context, page, errors } = await openPlayer(nativeHost);
    try {
      await page.getByText("0", { exact: true }).waitFor({ timeout: 10_000 });
      for (let i = 0; i < 2; i++) await page.touchscreen.tap(201, 600);
      await page.getByText("2", { exact: true }).waitFor({ timeout: 5_000 });
      server.restart();
      // Back to the first frame: the count starts over and When Prototype Starts plays its haptic again.
      await page.getByText("0", { exact: true }).waitFor({ timeout: 5_000 });
      await page.getByText("Restarted from Sonobe").waitFor({ timeout: 5_000 });
      expect(count(await posted(page), { kind: "haptic", type: "notificationSuccess" })).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("opens the menu with a three-finger tap, which never reaches the prototype", { timeout: 60_000 }, async () => {
    const { context, page, errors } = await openPlayer(nativeHostV2);
    try {
      await page.getByText("0", { exact: true }).waitFor({ timeout: 10_000 });
      await page.touchscreen.tap(201, 600);
      await page.getByText("1", { exact: true }).waitFor({ timeout: 5_000 });

      await threeFingerTap(page);
      const items = page.locator("#menu .menu-item");
      await items.first().waitFor({ timeout: 5_000 });
      expect(await items.allTextContents()).toEqual(["Restart Prototype", "Reload", "Open Another Prototype"]);
      expect(await page.locator(".menu-title").textContent()).toBe("Haptic Check");
      // The fingers the prototype got were cancelled: no tap, no haptic, no vibration.
      await page.waitForTimeout(200);
      expect(await page.getByText("1", { exact: true }).count()).toBe(1);
      let messages = await posted(page);
      expect(count(messages, { kind: "haptic", type: "impactMedium" })).toBe(1);
      expect(count(messages, { kind: "vibrate", pattern: 50 })).toBe(1);
      // Opening the menu teaches the gesture as well as the tip does, so the app won't show the tip again.
      expect(count(messages, { kind: "menuTipSeen" })).toBe(1);

      await page.getByRole("button", { name: "Restart Prototype" }).click();
      await page.getByText("0", { exact: true }).waitFor({ timeout: 5_000 });
      expect(await page.locator("#menu").isHidden()).toBe(true);
      expect(count(await posted(page), { kind: "haptic", type: "notificationSuccess" })).toBe(2);

      await threeFingerTap(page);
      await page.getByRole("button", { name: "Open Another Prototype" }).click();
      messages = await posted(page);
      expect(count(messages, { kind: "openAnother" })).toBe(1);
      await threeFingerTap(page);
      await page.getByRole("button", { name: "Cancel" }).click();
      expect(await page.locator("#menu").isHidden()).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("teaches the gesture once with a tip", { timeout: 60_000 }, async () => {
    const { context, page, errors } = await openPlayer(androidHost);
    try {
      const tip = page.locator("#tip");
      await tip.waitFor({ timeout: 5_000 });
      expect(await tip.textContent()).toBe("Tap with three fingers for the menu");
      expect(await page.evaluate(() => localStorage.getItem("sonobe.player.menuTip"))).toBe("seen");
      await page.reload();
      await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "live", null, { timeout: 15_000 });
      await page.waitForTimeout(2_000);
      expect(await page.locator("#tip").count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("reaches other hosts: Network Request and remote images get through the player's CSP", { timeout: 90_000 }, async () => {
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    const api: Server = createServer((req, res) => {
      const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
      if (req.url === "/hello") res.writeHead(200, { ...headers, "Content-Type": "text/plain" }).end("Hello from another host");
      else if (req.url === "/dot.png") res.writeHead(200, { ...headers, "Content-Type": "image/png" }).end(PNG);
      else res.writeHead(404, headers).end();
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const registry = createPatchRegistry();
    const doc = buildDoc(
      {
        name: "Network Check",
        device: "iphone-17-pro",
        layers: [
          { id: "greeting", type: "text", name: "Greeting", props: { position: [24, 300], size: [354, 60], text: { link: "hello.result" }, fontSize: 24, textColor: "#ffffff" } },
          { id: "photo", type: "image", name: "Photo", props: { position: [24, 400], size: [100, 100], image: { link: "pic.result" } } },
        ],
        patches: {
          start: { type: "whenPrototypeStarts" },
          hello: { type: "networkRequest", typeParam: "text", inputs: { request: { link: "start.started" }, url: `${origin}/hello` } },
          // An image result is the remote URL itself, drawn by an <img> (img-src).
          pic: { type: "networkRequest", typeParam: "image", inputs: { request: { link: "start.started" }, url: `${origin}/dot.png` } },
        },
      },
      registry,
    );
    const network = await servePlayer({ doc, token: "network-check" });
    const { context, page, errors } = await openPlayer(androidHost, network.url);
    try {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
      });
      await page.getByText("Hello from another host").waitFor({ timeout: 10_000 });
      await page.waitForFunction(() => [...document.querySelectorAll("img")].some((img) => img.complete && img.naturalWidth === 1), null, { timeout: 10_000 });
      expect(violations).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await network.close();
      await new Promise((resolve) => api.close(resolve));
    }
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
