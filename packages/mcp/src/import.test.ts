import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HeadlessHost } from "./headless.ts";
import { isHostError, type CapturedDesign, type DesignCaptureRequest, type HostCallControl } from "./host.ts";
import { connectClient, tempProject, type TempProject, type TestClient } from "./test-helpers.ts";

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

  it("teaches when the source is missing, doubled, or not a capture", async () => {
    expect((await client.call("import_design", {})).text).toContain("needs a source");
    expect((await client.call("import_design", { html: "<p>hi</p>", url: "http://localhost:3000" })).text).toContain("only one");
    const bad = await client.call("import_design", { capture: { format: "sonobe.design-capture", version: 1 } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("isn't valid");
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
