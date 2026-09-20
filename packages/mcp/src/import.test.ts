import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SymbolRenderer } from "@sonobe/import";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHeadlessHost, symbolsFromEnv, type HeadlessHost } from "./headless.ts";
import { isHostError, type CapturedDesign, type DesignCaptureRequest, type HostCallControl } from "./host.ts";
import { connectClient, tempProject, type TempProject, type TestClient } from "./test-helpers.ts";
import { IMPORT_META_KEY, offScreenNote, type ImportResultMeta } from "./tools/import.ts";

let project: TempProject;
let client: TestClient;

beforeEach(async () => {
  project = await tempProject();
  client = await connectClient(project.host);
});

afterEach(async () => {
  await client.close();
  await project.cleanup();
});

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const capture = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "chrome", title: "Checkout" },
  viewport: { width: 402, height: 874 },
  root: {
    kind: "frame",
    name: "Checkout",
    box: [0, 0, 402, 874],
    fill: "#F5F5F7FF",
    clip: true,
    children: [
      {
        kind: "frame",
        name: "Pay Button",
        nameRank: 5,
        box: [16, 780, 370, 52],
        fill: "#277FFFFF",
        radii: [14, 14, 14, 14],
        interactive: true,
        children: [{ kind: "text", name: "Pay", text: "Pay $24", box: [170, 794, 62, 24], style: { fontFamily: "system-ui", fontSize: 17, fontWeight: 600, color: "#FFFFFFFF", lineHeight: 24 } }],
      },
      { kind: "image", name: "Product Photo", box: [16, 60, 370, 240], image: "img1", fit: "cover", radii: [20, 20, 20, 20] },
    ],
  },
  images: { img1: { url: PIXEL, name: "product" } },
};

describe("import_design", () => {
  it("imports a capture as one screen with named layers, an asset file, and an outline", async () => {
    const r = await client.call("import_design", { capture });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain('Imported "Checkout" as layer checkout');
    expect(r.text).toContain('layer pay_button group "Pay Button"');
    expect(r.structured.screenId).toBe("checkout");
    const outline = await client.call("get_outline", {});
    expect(outline.text).toContain("cornerRadius=14");
    expect(outline.text).toMatch(/layer product_photo image "Product Photo" @16,60 370x240 image=asset:product/);
    const files = readdirSync(path.join(project.project, "assets"));
    expect(files.some((f) => f.endsWith(".png"))).toBe(true);
    const history = await client.call("list_history", {});
    expect(history.text).toContain("imported Checkout");
  });

  it("re-imports over a screen after one of its layers was removed", async () => {
    expect((await client.call("import_design", { capture })).isError).toBe(false);
    expect((await client.call("delete_items", { ids: ["pay_button"] })).isError).toBe(false);
    const again = await client.call("import_design", { capture, replace: "checkout" });
    expect(again.isError, again.text).toBe(false);
    const outline = (await client.call("get_outline", {})).text;
    expect(outline).toContain('layer pay_button_2 group "Pay Button"');
    expect(outline).toContain('layer product_photo image "Product Photo"');
  });

  it("notes a screen that lands entirely outside the device screen, and not one that's partly on it", async () => {
    const note = "“Checkout” is at 482, 0, outside the 402 × 874 screen, so the canvas and viewer won't show it. Put new screens at [0, 0].";
    const dry = await client.call("import_design", { capture, position: [482, 0], dryRun: true });
    expect(dry.text).toContain(`Note: ${note}`);
    const r = await client.call("import_design", { capture, position: [482, 0] });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain(`Note: ${note}`);
    expect(r.structured.importNotes).toEqual([note]);
    // The import isn't refused: the screen is there, beside the artboard.
    expect((await client.call("get_outline", {})).text).toMatch(/layer checkout group "Checkout" @482,0 402x874/);
    // A replace keeps the screen's place, so it still says so.
    expect((await client.call("import_design", { capture, replace: "checkout" })).text).toContain(`Note: ${note}`);
    const partly = await client.call("import_design", { capture, name: "Peek", position: [-300, 800] });
    expect(partly.isError, partly.text).toBe(false);
    expect(partly.text).not.toContain("outside the");
    expect((await client.call("import_design", { capture, name: "Home" })).text).not.toContain("outside the");
  });

  it("teaches when the source is missing, doubled, or not a capture", async () => {
    expect((await client.call("import_design", {})).text).toContain("needs a source");
    expect((await client.call("import_design", { html: "<p>hi</p>", url: "http://localhost:3000" })).text).toContain("only one");
    const bad = await client.call("import_design", { capture: { format: "sonobe.design-capture", version: 1 } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("isn't valid");
  });
});

describe("offScreenNote", () => {
  it("notes only a frame with no part on the artboard", () => {
    const screen: [number, number] = [402, 874];
    const outside = [[402, 0, 402, 874], [-402, 0, 402, 874], [0, 874, 402, 874], [0, -874, 402, 874], [-120, 300, 100, 44], [482, 0, 0, 0]] as const;
    for (const frame of outside) expect(offScreenNote("Profile", frame, screen), frame.join()).not.toBeNull();
    const on = [[0, 0, 402, 874], [401, 0, 402, 874], [-401, 0, 402, 874], [0, 873, 402, 874], [-10, -10, 1000, 2000], [0, 0, 0, 0]] as const;
    for (const frame of on) expect(offScreenNote("Profile", frame, screen), frame.join()).toBeNull();
    expect(offScreenNote(null, [482.25, 0, 402, 874], screen)).toBe("The draft is at 482.25, 0, outside the 402 × 874 screen, so the canvas and viewer won't show it. Put new screens at [0, 0].");
  });
});

/** The project's host with captureDesign replaced (like a page in a hidden window that takes a while). */
function withCapture(host: HeadlessHost, captureDesign: (request: DesignCaptureRequest, control: HostCallControl) => Promise<CapturedDesign>): HeadlessHost {
  const wrapped = Object.create(host) as HeadlessHost;
  Object.defineProperty(wrapped, "captureDesign", { value: (request: DesignCaptureRequest, control: HostCallControl = {}) => captureDesign(request, control) });
  return wrapped;
}

const captured = (): CapturedDesign => ({ capture: capture as never, images: new Map() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("import_design progress and cancelling", () => {
  it("stops the capture and changes nothing when the client cancels", async () => {
    let hostSignal: AbortSignal | undefined;
    const c = await connectClient(
      withCapture(project.host, (_request, control) => {
        hostSignal = control.signal;
        return new Promise<never>(() => undefined);
      }),
    );
    try {
      const before = (await project.host.getDocument()).revision;
      const controller = new AbortController();
      const call = c.client.callTool({ name: "import_design", arguments: { html: "<p>slow</p>" } }, undefined, { signal: controller.signal });
      await sleep(100);
      controller.abort("the person pressed Esc");
      await expect(call).rejects.toThrow();
      await sleep(20);
      expect(hostSignal?.aborted).toBe(true);
      expect((await project.host.getDocument()).revision).toBe(before);
    } finally {
      await c.close();
    }
  });

  it("applies nothing when the capture finishes after the cancel", async () => {
    // A host that ignores the signal: the capture still completes, but the import must not land.
    const c = await connectClient(withCapture(project.host, async () => (await sleep(300), captured())));
    try {
      const controller = new AbortController();
      const call = c.client.callTool({ name: "import_design", arguments: { html: "<p>slow</p>" } }, undefined, { signal: controller.signal });
      await sleep(100);
      controller.abort();
      await expect(call).rejects.toThrow();
      await sleep(400);
      expect((await c.call("list_history", {})).text).not.toContain("imported");
      expect((await project.host.getDocument()).revision).toBe(0);
    } finally {
      await c.close();
    }
  });

  it("reports the host's steps as progress, which keeps a short client timeout alive", async () => {
    const c = await connectClient(
      withCapture(project.host, async (_request, control) => {
        for (const stage of ["Loading the page", "Reading the page's layers", "Downloading images: 1 of 2", "Downloading images: 2 of 2", "Taking the page screenshot"]) {
          control.progress?.({ message: stage });
          await sleep(300);
        }
        return captured();
      }),
    );
    try {
      const messages: string[] = [];
      const r = await c.client.callTool({ name: "import_design", arguments: { html: "<p>slow</p>" } }, undefined, {
        timeout: 700,
        resetTimeoutOnProgress: true,
        onprogress: (p) => messages.push(String(p.message)),
      });
      expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
      expect(messages[0]).toBe("Rendering the HTML");
      expect(messages).toEqual(expect.arrayContaining(["Reading the page's layers", "Taking the page screenshot"]));
      expect(messages.length).toBeGreaterThanOrEqual(5);
    } finally {
      await c.close();
    }
  });

  it("sends no progress to a client that didn't ask for it, and lists the capture's notes", async () => {
    const c = await connectClient(withCapture(project.host, async (_request, control) => (control.progress?.({ message: "Loading the page" }), { ...captured(), notes: ["The page screenshot is left out (it timed out). Compare with get_screenshot instead."] })));
    try {
      const seen: unknown[] = [];
      const transport = (c.client as unknown as { transport: { onmessage?: (m: unknown) => void } }).transport;
      const original = transport.onmessage;
      transport.onmessage = (m) => {
        if ((m as { method?: string }).method === "notifications/progress") seen.push(m);
        original?.(m);
      };
      const r = await c.call("import_design", { html: "<p>fast</p>" });
      expect(r.isError, r.text).toBe(false);
      expect(r.text).toContain("Note: The page screenshot is left out");
      expect(seen).toEqual([]);
    } finally {
      await c.close();
    }
  });
});

/** import_design with its result's _meta, which TestClient.call leaves out. */
async function importWithMeta(c: TestClient, args: Record<string, unknown>) {
  const r = await c.client.callTool({ name: "import_design", arguments: args });
  const content = (r.content ?? []) as { type: string; text?: string }[];
  return {
    text: content.map((x) => x.text ?? "").join("\n"),
    isError: r.isError === true,
    content,
    structured: r.structuredContent as Record<string, unknown> | undefined,
    meta: (r._meta as Record<string, unknown> | undefined)?.[IMPORT_META_KEY] as ImportResultMeta | undefined,
  };
}

describe("import_design dry runs and _meta", () => {
  /** Stored asset files (assets.json is the list, there from the start). */
  const assetFiles = () => {
    const dir = path.join(project.project, "assets");
    return existsSync(dir) ? readdirSync(dir).filter((f) => f !== "assets.json") : [];
  };

  it("plans without changing the revision or storing files, and names what a replace would remove", async () => {
    const dry = await importWithMeta(client, { capture, dryRun: true });
    expect(dry.isError, dry.text).toBe(false);
    expect(dry.text).toContain("Dry run: importing would add “Checkout”: 4 layers (1 text, 1 image). Nothing changed.");
    expect(dry.structured).toMatchObject({ ok: true, changed: "none", dryRun: true, revision: 0 });
    expect(dry.meta).toEqual({ docId: "test", dryRun: true, screenId: null, screenName: "Checkout", txnId: null, replaced: null, dropped: [], droppedCount: 0, lostConnections: 0, kept: null });
    expect((await project.host.getDocument()).revision).toBe(0);
    expect(assetFiles()).toEqual([]);
    expect((await client.call("list_history", {})).text).not.toContain("imported");

    // Import it for real, then add a layer by hand inside the screen and wire it.
    expect((await client.call("import_design", { capture })).isError).toBe(false);
    expect((await client.call("add_layers", { parent: "checkout", layers: [{ type: "rectangle", name: "Promo Badge" }] })).isError).toBe(false);
    expect((await client.call("add_patches", { patches: [{ type: "interaction", name: "Tap Promo", inputs: { layer: { layer: "promo_badge" } } }] })).isError).toBe(false);
    const revision = (await project.host.getDocument()).revision;
    const files = assetFiles();

    const replace = await importWithMeta(client, { capture, replace: "checkout", dryRun: true });
    expect(replace.isError, replace.text).toBe(false);
    const lines = replace.text.split("\n");
    expect(lines[0]).toBe("Dry run: importing over “Checkout” (checkout) would keep 4 of its layers and remove 1 that isn't in the new design: Promo Badge, and drop 1 connection. Nothing changed.");
    // Nothing changed, so the notes say what would go.
    expect(lines).toContain("Note: 1 layer of the old “Checkout” wouldn't be found again and would be removed: Promo Badge. Give layers you'll import again a data-name so they're found.");
    expect(lines.some((line) => line.startsWith("Note: 1 connection to layers the new screen doesn't have would be removed: "))).toBe(true);
    expect(replace.text).not.toMatch(/\b(was|were) removed\b/);
    expect(replace.meta).toEqual({ docId: "test", dryRun: true, screenId: null, screenName: "Checkout", txnId: null, replaced: "checkout", dropped: [{ id: "promo_badge", name: "Promo Badge" }], droppedCount: 1, lostConnections: 1, kept: 4 });
    expect((await project.host.getDocument()).revision).toBe(revision);
    expect(assetFiles()).toEqual(files);
    expect((await client.call("get_outline", {})).text).toContain('layer promo_badge rectangle "Promo Badge"');

    // The real replace names the same layers in its notes.
    const real = await importWithMeta(client, { capture, replace: "checkout" });
    expect(real.text).toContain("Note: 1 layer of the old “Checkout” wasn't found again and was removed: Promo Badge.");
    expect(real.meta).toMatchObject({ dryRun: false, screenId: "checkout", replaced: "checkout", dropped: [{ id: "promo_badge", name: "Promo Badge" }], droppedCount: 1, lostConnections: 1, kept: 4 });
  });

  it("puts the screen id and txnId in _meta, also when a screenshot leaves out structuredContent", async () => {
    const plain = await importWithMeta(client, { capture });
    expect(plain.isError, plain.text).toBe(false);
    expect(plain.meta).toMatchObject({ docId: "test", dryRun: false, screenId: "checkout", screenName: "Checkout", replaced: null, dropped: [], droppedCount: 0, lostConnections: 0, kept: null });
    expect(plain.meta!.txnId).toBeTruthy();
    expect(plain.meta!.txnId).toBe(plain.structured!.txnId);

    const screenshot = { data: PIXEL.slice(PIXEL.indexOf(",") + 1), mimeType: "image/png" as const, width: 1, height: 1 };
    const c = await connectClient(withCapture(project.host, async () => ({ ...captured(), screenshot })));
    try {
      const shot = await importWithMeta(c, { html: "<p>checkout</p>", replace: "checkout", screenshot: true });
      expect(shot.isError, shot.text).toBe(false);
      expect(shot.structured).toBeUndefined();
      expect(shot.content.some((x) => x.type === "image")).toBe(true);
      expect(shot.meta).toMatchObject({ dryRun: false, screenId: "checkout", screenName: "Checkout", replaced: "checkout", kept: 4, droppedCount: 0 });
      expect(shot.meta!.txnId).toBeTruthy();
      expect(shot.meta!.txnId).not.toBe(plain.meta!.txnId);
      expect((await c.call("list_history", {})).text).toContain(shot.meta!.txnId!);

      // A dry run keeps the page image too.
      const revision = (await project.host.getDocument()).revision;
      const dry = await importWithMeta(c, { html: "<p>checkout</p>", screenshot: true, dryRun: true });
      expect(dry.content.some((x) => x.type === "image")).toBe(true);
      expect(dry.meta).toMatchObject({ dryRun: true, screenId: null, txnId: null });
      expect((await project.host.getDocument()).revision).toBe(revision);
    } finally {
      await c.close();
    }
  });

  it("replaces one element of a screen from a selector capture, in place", async () => {
    expect((await client.call("import_design", { capture })).isError).toBe(false);
    const requests: DesignCaptureRequest[] = [];
    // What the capture of `selector: "#pay"` holds: the button alone, in page coordinates.
    const button = { ...capture.root.children[0]!, fill: "#34C759FF" };
    const c = await connectClient(withCapture(project.host, async (request) => (requests.push(request), { capture: { ...capture, root: button } as never, images: new Map() })));
    try {
      const r = await importWithMeta(c, { html: "<button id=pay>Pay $24</button>", selector: "#pay", replace: "pay_button" });
      expect(r.isError, r.text).toBe(false);
      expect(requests[0]).toMatchObject({ selector: "#pay" });
      expect(r.meta).toMatchObject({ screenId: "pay_button", screenName: "Pay Button", replaced: "pay_button", droppedCount: 0 });
      const outline = (await c.call("get_outline", {})).text;
      expect(outline).toContain('layer checkout group "Checkout"');
      expect(outline).toMatch(/\n {2}layer pay_button group "Pay Button" @16,780 370x52 .*color=#34C759FF/);
      expect(outline).toContain('layer product_photo image "Product Photo"');
    } finally {
      await c.close();
    }
  });

  it("lists its sources last, so the small fields stream first", async () => {
    const { tools } = await client.client.listTools();
    const properties = Object.keys(tools.find((t) => t.name === "import_design")!.inputSchema.properties ?? {});
    expect(properties).toEqual(["docId", "component", "name", "replace", "parent", "position", "index", "width", "height", "selector", "waitFor", "waitMs", "fullPage", "colorScheme", "scrolling", "screenshot", "dryRun", "label", "expectedRevision", "preview", "url", "capture", "html"]);
  });
});

const playwrightReady = await (async () => {
  try {
    const { chromium } = (await import("playwright")) as { chromium: { executablePath(): string } };
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

describe.skipIf(!playwrightReady)("import_design with a browser (headless Playwright)", () => {
  it("renders HTML, names layers from data-name, and makes a long page scroll", async () => {
    const html = `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#fff">
      <header data-name="Top Bar" style="position:fixed;top:0;left:0;right:0;height:60px;background:#111;color:#fff;display:flex;align-items:center;padding:0 16px">Inbox</header>
      <main style="padding-top:60px">${Array.from({ length: 30 }, (_, i) => `<div style="height:72px;border-bottom:1px solid #eee;padding:0 16px;display:flex;align-items:center">Message ${i + 1}</div>`).join("")}</main>
      <button data-name="Compose" style="position:fixed;right:16px;bottom:24px;width:56px;height:56px;border-radius:28px;border:0;background:#277FFF;color:#fff">+</button>
    </body></html>`;
    const r = await client.call("import_design", { html, name: "Inbox" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain("Scroll patch");
    expect(r.text).toContain('"Top Bar"');
    expect(r.text).toContain('"Compose"');
    const outline = await client.call("get_outline", {});
    expect(outline.text).toMatch(/patch \w+ scroll "Scroll Content"/);
    const sim = await client.call("sim_reset", {});
    const simId = sim.structured.simId as string;
    await client.call("sim_dispatch", { simId, events: [{ kind: "drag", from: [200, 600], to: [200, 200], durationMs: 300 }] });
    const values = await client.call("sim_step", { simId, until: "idle", watch: ["@content.position"] });
    expect(values.isError, values.text).toBe(false);
    const after = await client.call("sim_get_values", { simId, targets: ["@content.position"] });
    const y = (after.structured.values as Record<string, number[]>)["@content.position"]![1]!;
    expect(y).toBeLessThan(-100);
  }, 60_000);

  it("names text after the element holding it, and the screen after <body data-name>", async () => {
    const html = `<!doctype html><html><body data-name="Discover" style="margin:0;font-family:system-ui">
      <div data-name="Card 1" style="margin:80px 16px;padding:16px;border-radius:20px;background:#f2f2f7">
        <div data-name="Card 1 Name" style="font-size:22px;font-weight:700">Leonard's Bakery</div>
        <div data-name="Card 1 Address">933 Kapahulu Ave, Honolulu</div>
      </div>
    </body></html>`;
    const r = await client.call("import_design", { html });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain('Imported "Discover" as layer discover');
    const outline = await client.call("get_outline", {});
    expect(outline.text).toContain('layer card_1_name text "Card 1 Name"');
    expect(outline.text).toContain('layer card_1_address text "Card 1 Address"');
  }, 60_000);

  it("explains a dead dev server", async () => {
    const r = await client.call("import_design", { url: "http://127.0.0.1:9/nothing" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Couldn't load");
  }, 60_000);

  it("imports the page's dark mode with a screenshot", async () => {
    // The title reads prefers-color-scheme while the page parses, so it proves the scheme was set first.
    const html = `<!doctype html><style>body{margin:0;background:#fff}@media (prefers-color-scheme: dark){body{background:#000}}</style><body><button data-name="Buy" style="margin:40px">Buy</button><script>document.title = matchMedia("(prefers-color-scheme: dark)").matches ? "Dark" : "Light"</script></body>`;
    const r = await client.call("import_design", { html, colorScheme: "dark", screenshot: true });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain('Imported "Dark"');
    expect(r.content.some((c) => c.type === "image")).toBe(true);
  }, 60_000);

  it("stops a page stuck in a loop at the deadline, naming the step", async () => {
    const busy = '<!doctype html><title>Busy</title><body>busy<script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 0))</script></body>';
    const started = Date.now();
    const err = await project.host.captureDesign!({ html: busy, width: 402, height: 874, timeoutMs: 3_000 }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(isHostError(err) && err.code).toBe("capture_timeout");
    expect((err as Error).message).toContain("within 3 seconds");
    expect((err as Error).message).toContain("reading the page's layers");
  }, 60_000);

  it("closes the browser as soon as the capture is cancelled", async () => {
    const controller = new AbortController();
    const steps: string[] = [];
    const capturing = project.host.captureDesign!({ html: "<p>waiting</p>", waitFor: "#never", width: 402, height: 874 }, { signal: controller.signal, progress: (s) => steps.push(s.message) });
    const caught = capturing.catch((e: unknown) => e);
    const deadline = Date.now() + 20_000;
    while (!steps.some((s) => s.startsWith("Waiting for")) && Date.now() < deadline) await sleep(50);
    const abortedAt = Date.now();
    controller.abort();
    const err = await caught;
    expect(Date.now() - abortedAt).toBeLessThan(2_000);
    expect(isHostError(err) && err.code).toBe("cancelled");
    expect(steps).toEqual(expect.arrayContaining(["Starting a headless browser", "Rendering the HTML"]));
  }, 60_000);
});

describe("SF Symbols in headless imports", () => {
  it("finds the helper through SONOBE_SFSYMBOL, and explains when it can't", () => {
    expect(symbolsFromEnv({}).unavailable).toContain("only when SONOBE_SFSYMBOL names the sfsymbol helper");
    expect(symbolsFromEnv({ SONOBE_SFSYMBOL: "/nowhere/sfsymbol" }).unavailable).toBe("SONOBE_SFSYMBOL names /nowhere/sfsymbol, but there's no file there. Point it at the sfsymbol helper (Sonobe.app/Contents/Resources/bin/sfsymbol) and restart the server.");
    expect(symbolsFromEnv({ SONOBE_SFSYMBOL: process.execPath }).unavailable).toBeUndefined();
  });

  const withSymbols = async (symbols: SymbolRenderer) => {
    const dir = await mkdtemp(path.join(tmpdir(), "sonobe-mcp-symbols-"));
    const host = createHeadlessHost({ symbols });
    await host.createDocument({ path: path.join(dir, "Symbols.sonobe") });
    const c = await connectClient(host);
    return {
      c,
      cleanup: async () => {
        await c.close();
        await host.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  };

  const circles: SymbolRenderer = {
    render: async (requests) =>
      requests.map((r) => ({ ok: true, width: r.size, height: r.size, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${r.size}" height="${r.size}" viewBox="0 0 ${r.size} ${r.size}"><circle cx="${r.size / 2}" cy="${r.size / 2}" r="${r.size / 2}" fill="${r.colors[0]!.slice(0, 7)}"/></svg>` })),
  };

  it("says in get_document_info whether imports draw SF Symbols", async () => {
    for (const [symbols, text, flag] of [
      [circles, "imports draw SF Symbols", true],
      [symbolsFromEnv({}), "imports show SF Symbols as placeholders", false],
    ] as const) {
      const { c, cleanup } = await withSymbols(symbols);
      try {
        const info = await c.call("get_document_info", {});
        expect(info.text).toContain(text);
        expect(info.structured.host).toMatchObject({ kind: "headless", sfSymbols: flag });
      } finally {
        await cleanup();
      }
    }
  });

  it.skipIf(!playwrightReady)("imports <svg data-sf-symbol> as an image the wrapper names, or a placeholder with a note", async () => {
    const html = `<!doctype html><body style="margin:0"><div data-name="Like Button" style="display:flex;margin:80px 16px"><svg data-sf-symbol="heart.fill" style="font-size:28px;color:#F24D47"></svg></div></body>`;
    const drawn = await withSymbols(circles);
    try {
      const r = await drawn.c.call("import_design", { html, name: "Card" });
      expect(r.isError, r.text).toBe(false);
      const outline = await drawn.c.call("get_outline", {});
      expect(outline.text).toMatch(/layer like_button image "Like Button" @16,80 28x28 image=asset:heart_fill/);
    } finally {
      await drawn.cleanup();
    }
    const placeholder = await withSymbols(symbolsFromEnv({}));
    try {
      const r = await placeholder.c.call("import_design", { html, name: "Card" });
      expect(r.isError, r.text).toBe(false);
      expect(r.text).toContain("Note: The SF Symbol “heart.fill” is a gray placeholder: Headless Sonobe draws SF Symbols only when SONOBE_SFSYMBOL names the sfsymbol helper");
      const outline = await placeholder.c.call("get_outline", {});
      expect(outline.text).toMatch(/layer like_button rectangle "Like Button" @16,80 28x28/);
    } finally {
      await placeholder.cleanup();
    }
  }, 60_000);
});
