/** The DOM walker in real Chromium (Playwright), on the layouts that are easy to get wrong. Skipped without Playwright's browser. */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CaptureFrame, CaptureNode, DesignCapture } from "../capture.ts";
import { capturePage } from "../node.ts";
import { WALKER_SOURCE } from "./walkerSource.ts";

const playwrightReady = await (async () => {
  try {
    const { chromium } = (await import("playwright")) as { chromium: { executablePath(): string } };
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const capture = async (body: string, extra: { width?: number; height?: number; bodyAttrs?: string } = {}): Promise<DesignCapture> =>
  (await capturePage({ html: `<!doctype html><html><head><style>body{margin:0;font-family:system-ui}</style></head><body ${extra.bodyAttrs ?? ""}>${body}</body></html>`, width: extra.width ?? 400, height: extra.height ?? 800 })).capture;

function findText(node: CaptureNode): CaptureNode | undefined {
  if (node.kind === "text") return node;
  if (node.kind !== "frame") return undefined;
  for (const child of node.children) {
    const found = findText(child);
    if (found) return found;
  }
  return undefined;
}

function find(node: CaptureNode, name: string): CaptureNode | undefined {
  if (node.name === name) return node;
  if (node.kind !== "frame") return undefined;
  for (const child of node.children) {
    const found = find(child, name);
    if (found) return found;
  }
  return undefined;
}

describe.skipIf(!playwrightReady)("DOM walker in Chromium", () => {
  it("measures children of a scaled element without scaling them twice", async () => {
    const c = await capture(`<div data-name="Card" style="position:absolute;left:100px;top:100px;width:200px;height:100px;background:#eee;transform:scale(.5)"><div data-name="Bar" style="height:10px;background:#f00"></div></div>`);
    const card = find(c.root, "Card") as CaptureFrame;
    const bar = find(c.root, "Bar")!;
    expect(card).toMatchObject({ box: [100, 100, 200, 100], scale: 0.5 });
    // Unscaled inside the unscaled card; the group's scale shrinks both.
    expect(bar.box).toEqual([100, 100, 200, 10]);
  });

  it("starts wrapped text after an icon in the same row", async () => {
    const c = await capture(`<div style="display:flex;gap:8px;padding:10px;width:300px"><div data-name="Icon" style="width:40px;height:40px;flex:none;background:#000"></div><p data-name="Label" style="margin:0">A long label that wraps onto a second line because the row is narrow</p></div>`);
    const text = findText(c.root)!;
    expect(text).toMatchObject({ kind: "text", wraps: true });
    expect(text.box[0]).toBeGreaterThanOrEqual(57);
    expect(text.box[0] + text.box[2]).toBeLessThanOrEqual(311);
  });

  it("survives sprite ids that aren't selectors, and keeps shadow DOM content", async () => {
    const c = await capture(`<svg width="0" height="0" style="position:absolute"><symbol id=":r1:" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol></svg>
      <svg data-name="Sprite Icon" width="24" height="24"><use href="#:r1:"/></svg>
      <p>Hi <x-badge></x-badge> there</p>
      <script>customElements.define("x-badge", class extends HTMLElement { constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = '<span data-name="Badge" style="display:inline-block;width:20px;height:12px;background:#f00"></span>'; } });</script>`);
    expect(find(c.root, "Sprite Icon")?.kind).toBe("image");
    expect(find(c.root, "Badge")).toBeDefined();
  });

  it("lifts fixed bars to the screen, except inside a transformed ancestor", async () => {
    const c = await capture(`<div style="height:2000px"></div><nav data-name="Tab Bar" style="position:fixed;bottom:0;left:0;right:0;height:60px;background:#fff"></nav>
      <div style="transform:translateZ(0)"><div data-name="Inner Bar" style="position:fixed;top:0;left:0;width:100px;height:20px;background:#00f"></div></div>`);
    const tabBar = c.root.children.find((n) => n.name === "Tab Bar")!;
    expect(tabBar.box).toEqual([0, 740, 400, 60]);
    const content = c.root.children.find((n) => n.name === "Content") as CaptureFrame;
    expect(find(content, "Inner Bar")?.box[1]).toBe(2000);
  });

  it("waits all of waitMs, even past the load and settle timeout", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const tab = await browser.newPage({ viewport: { width: 400, height: 200 } });
      await tab.setContent(`<!doctype html><html><body style="margin:0"><div data-name="Early" style="height:20px;background:#000"></div>
        <script>setTimeout(() => document.body.insertAdjacentHTML("beforeend", '<div data-name="Late" style="height:20px;background:#f00"></div>'), 600)</script></body></html>`);
      await tab.evaluate(WALKER_SOURCE);
      // A short timeoutMs stands in for the 10 s default, which waitMs used to be cut to what was left of.
      const c = (await tab.evaluate(`window.__sonobeCapture({ timeoutMs: 200, waitMs: 1000, settleMs: 0 })`)) as DesignCapture;
      expect(find(c.root, "Early")).toBeDefined();
      expect(find(c.root, "Late")).toBeDefined();
    } finally {
      await browser.close();
    }
  });

  it("makes @font-face rules that share a file one face covering their weights, as Google Fonts serves a variable font", async () => {
    const roman = "data:font/woff2;base64,d09GMgABAAAAAAA=";
    const italic = "data:font/woff2;base64,d09GMgABAAAAAAE=";
    const face = (weight: string, url = roman, style = "normal") => `@font-face { font-family: "Test Sans"; font-style: ${style}; font-weight: ${weight}; src: url(${url}) format("woff2"); }`;
    const c = await capture(`<style>${face("400")}${face("600")}${face("700")}${face("400", italic, "italic")}</style><h1 style="font-family:'Test Sans';font-weight:700">Bold title</h1><p style="font-family:'Test Sans'">Body <i>and italic</i></p>`);
    expect(c.fonts).toEqual([
      { family: "Test Sans", url: roman, weight: "400 700" },
      { family: "Test Sans", url: italic, weight: "400", style: "italic" },
    ]);
  });
});

function all(node: CaptureNode, out: CaptureNode[] = []): CaptureNode[] {
  out.push(node);
  if (node.kind === "frame") node.children.forEach((c) => all(c, out));
  return out;
}

const texts = (root: CaptureNode) => all(root).filter((n) => n.kind === "text").map((n) => n.name);

describe.skipIf(!playwrightReady)("DOM walker names", () => {
  it("names a text layer after the paintless element that holds it (data-name, aria-label, test id, id)", async () => {
    const c = await capture(`
      <div data-name="Card 1 Name" style="font-size:28px">Leonard's Bakery</div>
      <div data-name="Card 1 Address" style="width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">933 Kapahulu Ave, Honolulu</div>
      <div data-name="Title Slot"><div style="padding:2px"><h3 style="margin:0">Hours</h3></div></div>
      <div aria-label="Rating">4.8 ★</div>
      <div data-testid="price-label">$4.99</div>
      <div id="welcome-title">Welcome back</div>`);
    expect(texts(c.root)).toEqual(["Card 1 Name", "Card 1 Address", "Title Slot", "Rating", "Price Label", "Welcome Title"]);
    expect(find(c.root, "Card 1 Address")).toMatchObject({ kind: "text", nameRank: 5, maxLines: 1, text: "933 Kapahulu Ave, Honolulu" });
  });

  it("keeps the words when the wrapper's name is its kind: a component type, a role, a tag, a generated id", async () => {
    const c = await capture(`
      <h2 class="react" data-component="PlaceTitle" style="margin:0">Rainbow Drive-In</h2>
      <h1 style="margin:0">Discover</h1>
      <a href="#" style="display:block">See all</a>
      <div id="radix-12">Menu</div>
      <script>for (const el of document.querySelectorAll(".react")) { const name = el.dataset.component; const type = { [name]: function () {} }[name]; const fiber = {}; fiber.return = { type, child: fiber, return: { tag: 3 } }; el["__reactFiber$t"] = fiber; }</script>`);
    expect(texts(c.root)).toEqual(["Rainbow Drive-In", "Discover", "See all", "Menu"]);
  });

  it("names a glyph after its icon class or aria-label", async () => {
    const c = await capture(`<span class="icon-heart" style="display:inline-block">♥</span><button aria-label="Close" style="all:unset;font-size:20px">×</button>`);
    expect(texts(c.root)).toEqual(["Heart Icon", "Close Button"]);
  });

  it("leaves a painted wrapper's name on its group", async () => {
    const c = await capture(`<div data-name="Price Tag" style="background:#fe0;padding:4px;width:fit-content">$5</div>`);
    expect(find(c.root, "Price Tag")).toMatchObject({ kind: "frame", children: [{ kind: "text", name: "$5" }] });
  });

  it("gives a named inline element its own text layer, inside a painted box or a sentence", async () => {
    const c = await capture(`
      <div data-name="Like Button" style="background:#f33;padding:8px;width:fit-content"><span data-name="Like Label">Like</span></div>
      <div><span data-name="City">Honolulu</span></div>
      <p style="margin:0">Open until <span data-name="Closing Time">9 PM</span> today</p>
      <div data-name="Price Row"><b data-name="Price">$4.99</b> <s data-name="Old Price">$6.00</s></div>`);
    expect(texts(c.root)).toEqual(["Like Label", "City", "Open until", "Closing Time", "today", "Price", "Old Price"]);
    const before = find(c.root, "Open until")!;
    const time = find(c.root, "Closing Time")!;
    expect(time).toMatchObject({ kind: "text", text: "9 PM" });
    // Where the browser drew it: after "Open until", on the same line.
    expect(time.box[0]).toBeGreaterThanOrEqual(before.box[0] + before.box[2]);
    expect(time.box[1]).toBe(before.box[1]);
  });

  it("names its run in a paragraph that wraps", async () => {
    const c = await capture(`<p style="margin:0;width:160px">We're open every day of the week until <span data-name="Closing Time" style="white-space:nowrap">9 PM</span>, except on public holidays.</p>`);
    expect(find(c.root, "Closing Time")).toMatchObject({ kind: "text", text: "9 PM" });
  });

  it("names text from an inline element's id or aria-label only when that element holds all of it", async () => {
    const c = await capture(`<div><span id="city-name">Honolulu</span></div>
      <p style="margin:0">Read the <a id="terms-link" href="#" style="color:inherit;text-decoration:none">terms</a> first</p>
      <div><b id="price-now">$4.99</b> <b>each</b></div>`);
    expect(texts(c.root)).toEqual(["City Name", "Read the terms first", "$4.99 each"]);
  });

  it("explains a name it can't place in a paragraph too long to split, and uses one that holds it all", async () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const c = await capture(`<p style="width:60px;font-size:11px;line-height:13px">${words} <span data-name="Author">someone</span> <b>bold</b> ${words}</p>
      <p style="width:60px;font-size:11px;line-height:13px"><span data-name="Legal">${words} <b>bold</b> ${words}</span></p>`);
    expect(c.notes?.join(" ")).toContain("“Author” names part of a long paragraph");
    expect(c.notes?.join(" ")).not.toContain("Legal");
    expect(find(c.root, "Legal")?.kind).toBe("text");
  });

  it("names the screen after <body data-name>, and a body that stays a layer doesn't repeat it", async () => {
    const plain = await capture(`<div style="height:10px;background:#000"></div>`, { bodyAttrs: `data-name="Discover"` });
    expect(plain.root.name).toBe("Discover");
    const painted = await capture(`<style>html{background:#eee}</style><div style="height:10px;background:#000"></div>`, { bodyAttrs: `data-name="Discover" style="background:#fff;margin:20px"` });
    expect(painted.root.name).toBe("Discover");
    expect(all(painted.root).filter((n) => n.name === "Discover")).toHaveLength(1);
    expect(find(painted.root, "Page")?.kind).toBe("frame");
  });

  it("doesn't give a kept frame and its image or field the same name", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const c = await capture(`<img data-name="Avatar" width="48" height="48" style="border:2px solid #333;border-radius:50%" src="${png}">
      <img data-name="Hero Photo" width="100" height="40" src="${png}">
      <input type="checkbox" data-name="Agree Checkbox" checked>
      <input data-name="Email Input" placeholder="you@example.com">
      <input data-name="Search" placeholder="Search">`);
    expect(find(c.root, "Avatar")).toMatchObject({ kind: "frame", children: [{ kind: "image", name: "Avatar Image" }] });
    expect(find(c.root, "Hero Photo")?.kind).toBe("image");
    expect(find(c.root, "Agree Checkbox")).toMatchObject({ kind: "frame", children: [{ kind: "image", name: "Checkmark" }] });
    expect(find(c.root, "Email Input Group")).toMatchObject({ kind: "frame", children: [{ kind: "input", name: "Email Input" }] });
    expect(find(c.root, "Search Input")).toMatchObject({ kind: "frame", children: [{ kind: "input", name: "Search" }] });
  });
});
