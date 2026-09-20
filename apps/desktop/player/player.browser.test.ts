/**
 * The built web player in real mobile Chromium (Playwright), served by the real LAN preview server:
 * taps reach the device as navigator.vibrate calls on Android and as bridge messages under a native
 * host like Sonobe Viewer; Sonobe's restart reaches the phone; a three-finger tap opens the menu
 * without touching the prototype; Network Request and remote images reach other hosts through the
 * player's CSP, which also lets the platform read a picked photo and a data: file; and Device Info reads
 * the phone's appearance, safe area, rotation and density.
 * Skipped without Playwright's browser.
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

  it("reads a picked photo's bytes and uploads a data: file through the player's CSP", { timeout: 90_000 }, async () => {
    const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const uploads: string[] = [];
    const api: Server = createServer((req, res) => {
      const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
      let size = 0;
      req.on("data", (chunk: Buffer) => (size += chunk.length));
      req.on("end", () => {
        uploads.push(`${req.method} ${req.headers["content-type"]?.split(";")[0]}`);
        res.writeHead(200, { ...headers, "Content-Type": "text/plain" }).end(`Uploaded ${size} bytes`);
      });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const doc = buildDoc(
      {
        name: "Upload Check",
        device: "iphone-17-pro",
        layers: [
          { id: "surface", type: "rectangle", name: "Surface", props: { position: [0, 0], size: [402, 874], color: "#1c1c22" } },
          { id: "encoded", type: "text", name: "Encoded", props: { position: [24, 100], size: [354, 200], text: { link: "encode.base64" }, fontSize: 10, textColor: "#ffffff" } },
          { id: "uploaded", type: "text", name: "Uploaded", props: { position: [24, 400], size: [354, 60], text: { link: "upload.result" }, fontSize: 14, textColor: "#ffffff" } },
        ],
        patches: {
          start: { type: "whenPrototypeStarts" },
          touch: { type: "interaction", inputs: { layer: { layer: "surface" } } },
          // A picked photo is a blob: URL, which Base64 Encode reads with fetch().
          picker: { type: "photoPicker", inputs: { open: { link: "touch.tap" }, mediaType: "photos" } },
          encode: { type: "base64Encode", typeParam: "image", inputs: { value: { link: "picker.image" } } },
          // A data: file in a form body is fetched into the multipart upload.
          upload: { type: "networkRequest", typeParam: "text", inputs: { request: { link: "start.started" }, url: `${origin}/upload`, method: "post", body: { json: { still: { url: `data:image/png;base64,${PNG_BASE64}` } } } } },
        },
      },
      createPatchRegistry(),
    );
    const upload = await servePlayer({ doc, token: "upload-check" });
    const { context, page, errors } = await openPlayer(androidHost, upload.url);
    try {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
      });
      await page.locator('[data-layer="uploaded"]').getByText(/^Uploaded \d+ bytes$/).waitFor({ timeout: 10_000 });
      expect(uploads).toEqual(["POST multipart/form-data"]);
      const chooser = page.waitForEvent("filechooser", { timeout: 10_000 });
      await page.touchscreen.tap(201, 700);
      await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") });
      await page.locator('[data-layer="encoded"]').getByText(PNG_BASE64).waitFor({ timeout: 10_000 });
      expect(violations).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await upload.close();
      await new Promise((resolve) => api.close(resolve));
    }
  });

  it("tells Device Info about the phone: its appearance, safe area, rotation and density", { timeout: 60_000 }, async () => {
    const readouts: Record<string, string> = { dark: "info.darkMode", top: "safe.top", bottom: "safe.bottom", left: "safe.left", turn: "info.orientation", scale: "info.screenScale" };
    const doc = buildDoc(
      {
        name: "Device Check",
        device: "iphone-17-pro",
        layers: Object.entries(readouts).map(([id, link], i) => ({ id, type: "text", name: id, props: { position: [24, 200 + 60 * i], size: [354, 40], text: { link }, fontSize: 24, textColor: "#ffffff" } })),
        patches: { info: { type: "deviceInfo" }, safe: { type: "edgesUnpack", inputs: { value: { link: "info.safeArea" } } } },
      },
      createPatchRegistry(),
    );
    const device = await servePlayer({ doc, token: "device-check" });
    // A phone unlike the project's iPhone 17 Pro (62 pt top inset, 3× density), so every value read is the phone's.
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      const cdp = await context.newCDPSession(page);
      const insets = (top: number, right: number, bottom: number, left: number) => cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, right, bottom, left } });
      const shows = async (values: Record<string, string>) => {
        for (const [id, value] of Object.entries(values)) await page.locator(`[data-layer="${id}"]`).getByText(value, { exact: true }).waitFor({ timeout: 5_000 });
      };
      await insets(59, 0, 34, 0);
      await page.goto(device.url);
      await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "live", null, { timeout: 15_000 });
      // The prototype fills this 402×874 screen at scale 1, so the phone's insets are the prototype's.
      await shows({ dark: "true", top: "59", bottom: "34", left: "0", turn: "0", scale: "2" });

      // Turned: the interface stays portrait, letterboxed between the side insets, so only the bottom one reaches it.
      await insets(0, 59, 21, 59);
      await page.setViewportSize({ width: 874, height: 402 });
      await shows({ turn: "90", top: "0", bottom: "46", left: "0" });

      await page.emulateMedia({ colorScheme: "light" });
      await shows({ dark: "false" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await device.close();
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
