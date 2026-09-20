import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("teaches when the source is missing, doubled, or not a capture", async () => {
    expect((await client.call("import_design", {})).text).toContain("needs a source");
    expect((await client.call("import_design", { html: "<p>hi</p>", url: "http://localhost:3000" })).text).toContain("only one");
    const bad = await client.call("import_design", { capture: { format: "sonobe.design-capture", version: 1 } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("isn't valid");
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
});
