/**
 * preview_design and import_design's preview source over HeadlessHost: drafts grow call by call, are
 * kept per session, go idle, and reach the canvas through a fake showDesignPreview; import_design
 * imports the draft's html through a fake captureDesign (no browser in tests).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRAFT_IDLE_MS } from "./designPreviews.ts";
import type { HeadlessHost } from "./headless.ts";
import { HostError, type CapturedDesign, type DesignCaptureRequest, type DesignPreviewUpdate } from "./host.ts";
import { createSonobeMcpServer, serverInstructions } from "./server.ts";
import { tempProject, type CallResult, type TempProject, type TestClient } from "./test-helpers.ts";
import { IMPORT_META_KEY, type ImportResultMeta } from "./tools/import.ts";

let project: TempProject;
let clock: number;
let updates: DesignPreviewUpdate[];
let requests: DesignCaptureRequest[];
/** The fake canvas and browser fail while these are set. */
let canvasFails: boolean;
let captureFails: boolean;
/** The fake canvas holds this session's updates until the promise settles (a window that's slow to answer). */
let slowFor: { key: string; until: Promise<void> } | null;
let open: TestClient[];

const PLACEMARK = "11111111-aaaa-4bbb-8ccc-000000000001";
const SONOBE = "22222222-aaaa-4bbb-8ccc-000000000002";

/** A checkout screen as the capture window would read it. */
const CHECKOUT = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "html", title: "Page" },
  viewport: { width: 402, height: 874 },
  root: {
    kind: "frame",
    name: "Page",
    box: [0, 0, 402, 874],
    fill: "#F5F5F7FF",
    children: [{ kind: "frame", name: "Pay Button", nameRank: 5, box: [16, 780, 370, 52], fill: "#277FFFFF", radii: [14, 14, 14, 14], children: [] }],
  },
  images: {},
};

/** The project's host with a canvas (like the app's) and a browser, both fakes. */
function withCanvas(host: HeadlessHost): HeadlessHost {
  const wrapped = Object.create(host) as HeadlessHost;
  Object.defineProperty(wrapped, "capabilities", { value: { ...host.capabilities, designPreview: true } });
  Object.defineProperty(wrapped, "showDesignPreview", {
    value: async (update: DesignPreviewUpdate) => {
      if (canvasFails) throw new HostError("editor_timeout", "The editor didn't answer design.preview in time.", { hint: "It may be busy." });
      if (slowFor?.key === update.key) await slowFor.until;
      updates.push(structuredClone(update));
    },
  });
  Object.defineProperty(wrapped, "captureDesign", {
    value: async (request: DesignCaptureRequest): Promise<CapturedDesign> => {
      requests.push(request);
      if (captureFails) throw new HostError("capture_failed", "The page didn't load.");
      return { capture: CHECKOUT as never, images: new Map() };
    },
  });
  return wrapped;
}

/** A client of its own server over `host`, as one session: a relay client id, or none. */
async function session(host: HeadlessHost, clientId?: string): Promise<TestClient> {
  const server = createSonobeMcpServer(host, { version: "0.1.0-test", now: () => clock }, clientId ? { callScope: () => ({ clientId }) } : {});
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "claude-code", version: "2.1.278" });
  await client.connect(clientSide as never);
  const c: TestClient = {
    client,
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const content = (r.content ?? []) as CallResult["content"];
      return { text: content.map((x) => x.text ?? "").join("\n"), structured: (r.structuredContent ?? {}) as Record<string, unknown>, isError: r.isError === true, content };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
  open.push(c);
  return c;
}

/** import_design's result with its _meta. */
async function importPreview(c: TestClient, args: Record<string, unknown>) {
  const r = await c.client.callTool({ name: "import_design", arguments: { preview: true, ...args } });
  const content = (r.content ?? []) as { type: string; text?: string }[];
  return { text: content.map((x) => x.text ?? "").join("\n"), isError: r.isError === true, meta: (r._meta as Record<string, unknown> | undefined)?.[IMPORT_META_KEY] as ImportResultMeta | undefined };
}

const statuses = () => updates.map((u) => `${u.status} ${u.revision}`);

beforeEach(async () => {
  project = await tempProject();
  clock = 1_000_000;
  updates = [];
  requests = [];
  canvasFails = false;
  captureFails = false;
  slowFor = null;
  open = [];
});

afterEach(async () => {
  for (const c of open) await c.close();
  await project.cleanup();
});

describe("preview_design", () => {
  it("starts a draft with html and adds to it with append, one revision per call", async () => {
    const c = await session(withCanvas(project.host));
    const first = await c.call("preview_design", { name: "Checkout", html: "<head><style>body{margin:0}</style></head><body><header>Checkout</header>" });
    expect(first.isError, first.text).toBe(false);
    expect(first.text).toBe('Showing “Checkout” on the canvas (1 KB so far). Add the next part with append, then import it with import_design and "preview": true.');
    await c.call("preview_design", { append: "<main>Items</main>" });
    const third = await c.call("preview_design", { append: "<footer>Pay</footer></body>" });
    const html = "<head><style>body{margin:0}</style></head><body><header>Checkout</header><main>Items</main><footer>Pay</footer></body>";
    expect(third.structured).toEqual({ text: third.text, docId: "test", name: "Checkout", bytes: html.length, revision: 0, draftRevision: 3 });
    expect(updates.map((u) => [u.revision, u.status, u.html])).toEqual([
      [1, "writing", "<head><style>body{margin:0}</style></head><body><header>Checkout</header>"],
      [2, "writing", "<head><style>body{margin:0}</style></head><body><header>Checkout</header><main>Items</main>"],
      [3, "writing", html],
    ]);
    expect(updates[2]).toEqual({ docId: "test", key: "Claude", author: { kind: "agent", name: "Claude" }, name: "Checkout", component: null, replace: null, width: null, height: null, position: null, html, status: "writing", revision: 3 });
    // html again starts the draft over, and the count goes on.
    await c.call("preview_design", { html: "<body>Again</body>" });
    expect(updates.at(-1)).toMatchObject({ html: "<body>Again</body>", name: "Checkout", revision: 4 });
  });

  it("updates the fields a call passes and keeps the rest", async () => {
    const c = await session(withCanvas(project.host));
    expect((await c.call("import_design", { capture: CHECKOUT, name: "Home" })).isError).toBe(false);
    await c.call("preview_design", { name: "Home v2", replace: "home", width: 390, html: "<body>" });
    await c.call("preview_design", { height: 844, position: [0, 20], append: "<p>Hi</p>" });
    await c.call("preview_design", { name: "Home v3", append: "</body>" });
    expect(updates.at(-1)).toMatchObject({ name: "Home v3", component: null, replace: "home", width: 390, height: 844, position: [0, 20], html: "<body><p>Hi</p></body>" });
    // A replace the component doesn't have teaches, and changes nothing.
    const bad = await c.call("preview_design", { replace: "nope", append: "<p>more</p>" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('There\'s no layer "nope" to replace in main.');
    expect(updates).toHaveLength(3);
    const component = await c.call("preview_design", { component: "nowhere", append: "<p>more</p>" });
    expect(component.structured.error).toMatchObject({ code: "unknown_component" });
  });

  it("teaches when the call names no single part, adds to no draft, or grows past the limit", async () => {
    const c = await session(withCanvas(project.host));
    for (const args of [{}, { html: "<p>a</p>", append: "<p>b</p>" }, { html: "<p>a</p>", clear: true }, { clear: false }]) {
      const r = await c.call("preview_design", args);
      expect(r.structured.error, JSON.stringify(args)).toMatchObject({ code: "invalid_source", message: "Pass exactly one of html (start the draft), append (add to it) or clear (remove it)." });
    }
    const none = await c.call("preview_design", { append: "<p>b</p>" });
    expect(none.structured.error).toMatchObject({ code: "no_draft", message: "There's no draft to add to. Start it with html first." });
    expect((await c.call("preview_design", { html: "x".repeat(1_000_000) })).isError).toBe(false);
    const big = await c.call("preview_design", { append: "x".repeat(500_001) });
    expect(big.structured.error).toMatchObject({ code: "html_too_large", message: "The draft is over 1,500,000 characters. Keep the page lean: inline SVG icons instead of big data: images." });
    expect(big.text).toContain("Nothing changed.");
    // The draft is as it was.
    expect((await c.call("preview_design", { append: "y" })).structured).toMatchObject({ bytes: 1_000_001, draftRevision: 2 });
    expect(updates).toHaveLength(2);
  });

  it("clear takes the draft off the canvas", async () => {
    const c = await session(withCanvas(project.host));
    await c.call("preview_design", { name: "Checkout", html: "<body>" });
    const cleared = await c.call("preview_design", { clear: true });
    expect(cleared.text).toBe("Removed the draft “Checkout” from the canvas. Nothing changed.");
    expect(updates.at(-1)).toMatchObject({ status: "cleared", html: null, name: "Checkout", revision: 2 });
    expect((await c.call("preview_design", { append: "<p>" })).structured.error).toMatchObject({ code: "no_draft" });
    expect((await c.call("preview_design", { clear: true })).text).toBe("There's no draft to remove, so nothing changed.");
    expect(updates).toHaveLength(2);
    // The session's next draft continues the count, so the canvas can tell it's newer.
    await c.call("preview_design", { html: "<body>new</body>" });
    expect(updates.at(-1)).toMatchObject({ status: "writing", revision: 3, name: null });
  });

  it("keeps each session's draft apart", async () => {
    const host = withCanvas(project.host);
    const placemark = await session(host, PLACEMARK);
    const sonobe = await session(host, SONOBE);
    await placemark.call("preview_design", { name: "Checkout", html: "<body>checkout" });
    await sonobe.call("preview_design", { name: "Inbox", html: "<body>inbox" });
    await placemark.call("preview_design", { append: "</body>" });
    expect(updates.map((u) => [u.key, u.client?.id, u.name, u.html, u.revision])).toEqual([
      [PLACEMARK, PLACEMARK, "Checkout", "<body>checkout", 1],
      [SONOBE, SONOBE, "Inbox", "<body>inbox", 1],
      [PLACEMARK, PLACEMARK, "Checkout", "<body>checkout</body>", 2],
    ]);
    expect(updates[0]!.client).toMatchObject({ label: "Claude Code" });
    // A session without the relay is its author's.
    const plain = await session(host);
    expect((await plain.call("preview_design", { append: "<p>" })).structured.error).toMatchObject({ code: "no_draft" });
    await sonobe.call("preview_design", { clear: true });
    expect((await placemark.call("preview_design", { append: "<p>still here</p>" })).isError).toBe(false);
  });

  it("doesn't hold one session's draft up behind a window that's slow to show another's", async () => {
    const host = withCanvas(project.host);
    const placemark = await session(host, PLACEMARK);
    const sonobe = await session(host, SONOBE);
    let release!: () => void;
    slowFor = { key: PLACEMARK, until: new Promise<void>((resolve) => (release = resolve)) };
    const slow = placemark.call("preview_design", { name: "Checkout", html: "<body>checkout" });
    const quick = await sonobe.call("preview_design", { name: "Inbox", html: "<body>inbox" });
    expect(quick.isError, quick.text).toBe(false);
    expect(updates.map((u) => u.key)).toEqual([SONOBE]);
    // The slow draft's own calls still take turns, so its updates reach the canvas in order.
    const next = placemark.call("preview_design", { append: "</body>" });
    release();
    await Promise.all([slow, next]);
    expect(updates.map((u) => [u.key, u.revision, u.html])).toEqual([
      [SONOBE, 1, "<body>inbox"],
      [PLACEMARK, 1, "<body>checkout"],
      [PLACEMARK, 2, "<body>checkout</body>"],
    ]);
  });

  it("reports the document's revision, which import_design's expectedRevision takes", async () => {
    const c = await session(withCanvas(project.host));
    for (const name of ["Card", "Badge"]) expect((await c.call("add_layers", { layers: [{ type: "rectangle", name }] })).isError).toBe(false);
    const { revision } = (await c.call("get_document_info")).structured;
    expect(revision).toBe(2);
    await c.call("preview_design", { name: "Checkout", html: "<body>" });
    const last = await c.call("preview_design", { append: "</body>" });
    expect(last.structured).toMatchObject({ revision: 2, draftRevision: 2 });
    const r = await importPreview(c, { expectedRevision: last.structured.revision });
    expect(r.isError, r.text).toBe(false);
  });

  it("drops a draft left alone for 15 minutes, and clears it from the canvas", async () => {
    const host = withCanvas(project.host);
    const placemark = await session(host, PLACEMARK);
    const sonobe = await session(host, SONOBE);
    await placemark.call("preview_design", { name: "Checkout", html: "<body>" });
    clock += DRAFT_IDLE_MS;
    await sonobe.call("preview_design", { html: "<body>" });
    expect(statuses()).toEqual(["writing 1", "writing 1"]);
    // Checked whenever the host's drafts are used: here by another session.
    clock += 1;
    await sonobe.call("preview_design", { append: "<p>" });
    expect(updates.slice(2).map((u) => [u.key, u.status, u.html])).toEqual([
      [PLACEMARK, "cleared", null],
      [SONOBE, "writing", "<body><p>"],
    ]);
    expect((await placemark.call("preview_design", { append: "</body>" })).structured.error).toMatchObject({ code: "no_draft" });
  });

  it("is taught in the instructions of a host with a canvas", () => {
    const line = "   To design a new screen, show it on the canvas as you write with preview_design. Start it within your first few steps with the page's head, theme and first section instead of planning the whole page first, append section by section, then import it with import_design (preview: true).";
    expect(serverInstructions(withCanvas(project.host)).split("\n")).toContain(line);
    expect(serverInstructions(project.host)).not.toContain("preview_design");
  });

  it("keeps the draft in headless mode, and notes a canvas that didn't take it", async () => {
    const headless = await session(project.host);
    const kept = await headless.call("preview_design", { name: "Checkout", html: "<body>" });
    expect(kept.text).toBe('Kept the draft “Checkout” (1 KB). This is headless mode with no canvas, so nobody sees it; import it with import_design and "preview": true.');
    expect((await headless.call("preview_design", { append: "</body>" })).structured).toMatchObject({ draftRevision: 2 });

    const c = await session(withCanvas(project.host), PLACEMARK);
    canvasFails = true;
    const shown = await c.call("preview_design", { html: "<body>" });
    expect(shown.isError).toBe(false);
    expect(shown.text).toContain("Note: The canvas didn't show the draft: The editor didn't answer design.preview in time. It may be busy.");
    canvasFails = false;
    expect((await c.call("preview_design", { append: "</body>" })).structured).toMatchObject({ bytes: 13, draftRevision: 2 });
  });
});

describe("import_design with preview", () => {
  it("imports the draft's html with its name and replace, shows it being added, then takes it off the canvas", async () => {
    const host = withCanvas(project.host);
    const c = await session(host, PLACEMARK);
    expect((await c.call("import_design", { capture: CHECKOUT, name: "Checkout" })).isError).toBe(false);
    const html = '<!doctype html><body data-name="Checkout"><button data-name="Pay Button">Pay</button></body>';
    await c.call("preview_design", { name: "Checkout v2", replace: "checkout", width: 390, html: html.slice(0, 40) });
    await c.call("preview_design", { append: html.slice(40) });
    const r = await importPreview(c, {});
    expect(r.isError, r.text).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ html, width: 390, height: 874 });
    expect(r.text).toContain('Re-imported "Checkout v2" as layer checkout');
    expect(r.meta).toMatchObject({ docId: "test", dryRun: false, screenId: "checkout", screenName: "Checkout v2", replaced: "checkout" });
    expect(r.meta!.txnId).toBeTruthy();
    expect(statuses()).toEqual(["writing 1", "writing 2", "adding 3", "cleared 4"]);
    expect(updates[2]).toMatchObject({ html, name: "Checkout v2", replace: "checkout" });
    expect(updates[3]).toMatchObject({ html: null, status: "cleared" });
    // The draft is gone once it's layers.
    expect((await importPreview(c, {})).text).toContain("There's no design preview to import for this session. Show one with preview_design first, or pass html.");
  });

  it("names the layer the draft replaces, teaches once it's gone, and makes a new screen with replace: null", async () => {
    const c = await session(withCanvas(project.host));
    expect((await c.call("import_design", { capture: CHECKOUT, name: "Checkout" })).isError).toBe(false);
    const first = await c.call("preview_design", { name: "Checkout v2", replace: "checkout", html: "<body>" });
    expect(first.text).toBe('Showing “Checkout v2” on the canvas over “Checkout”, which it replaces (1 KB so far). Add the next part with append, then import it with import_design and "preview": true.');
    expect((await c.call("delete_items", { ids: ["checkout"] })).isError).toBe(false);
    const gone = { code: "not_found", message: 'The draft replaces "checkout", which isn\'t in main now.', hint: 'Pass "replace": null to make it a new screen, or the id of the layer it replaces (get_outline shows it).' };
    expect((await c.call("preview_design", { append: "<p>Pay</p>" })).structured.error).toMatchObject(gone);
    expect((await c.call("preview_design", { html: "<body>again" })).structured.error).toMatchObject(gone);
    // import_design says so before it renders the page, and leaves the draft as it was.
    const failed = await importPreview(c, {});
    expect(failed.text).toContain(`Error not_found: ${gone.message}`);
    expect(requests).toEqual([]);
    expect(statuses()).toEqual(["writing 1"]);
    const fresh = await c.call("preview_design", { replace: null, append: "<p>Pay</p></body>" });
    expect(fresh.text).toMatch(/^Showing “Checkout v2” on the canvas \(1 KB so far\)\./);
    expect(updates.at(-1)).toMatchObject({ replace: null, html: "<body><p>Pay</p></body>" });
    const r = await importPreview(c, {});
    expect(r.isError, r.text).toBe(false);
    expect(r.meta).toMatchObject({ screenName: "Checkout v2", replaced: null });
  });

  it("imports a new screen with replace: null, keeping the screen the draft would replace", async () => {
    const c = await session(withCanvas(project.host));
    expect((await c.call("import_design", { capture: CHECKOUT, name: "Checkout" })).isError).toBe(false);
    await c.call("preview_design", { name: "Checkout B", replace: "checkout", html: "<body>Pay</body>" });
    const r = await importPreview(c, { replace: null });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain('Imported "Checkout B" as layer checkout_b');
    expect(r.meta).toMatchObject({ screenId: "checkout_b", replaced: null });
    const outline = (await c.call("get_outline")).text;
    expect(outline).toContain('layer checkout group "Checkout"');
    expect(outline).toContain('layer checkout_b group "Checkout B"');
  });

  it("lets the call's own fields win over the draft's", async () => {
    const c = await session(withCanvas(project.host));
    await c.call("preview_design", { name: "Checkout", width: 390, html: "<body>Pay</body>" });
    const r = await importPreview(c, { name: "Pay Sheet", height: 600 });
    expect(r.isError, r.text).toBe(false);
    expect(requests[0]).toMatchObject({ html: "<body>Pay</body>", width: 390, height: 600 });
    expect(r.meta).toMatchObject({ screenName: "Pay Sheet", replaced: null });
  });

  it("keeps the draft, writing again, when the import fails", async () => {
    const c = await session(withCanvas(project.host));
    await c.call("preview_design", { name: "Checkout", html: "<body>Pay</body>" });
    captureFails = true;
    const failed = await importPreview(c, {});
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain("The page didn't load.");
    expect(statuses()).toEqual(["writing 1", "adding 2", "writing 3"]);
    expect(updates.at(-1)).toMatchObject({ html: "<body>Pay</body>", name: "Checkout" });
    // Claude fixes the page and tries again.
    captureFails = false;
    await c.call("preview_design", { html: "<body>Pay now</body>" });
    expect((await importPreview(c, {})).isError).toBe(false);
    expect(requests.at(-1)).toMatchObject({ html: "<body>Pay now</body>" });
    expect(statuses().slice(3)).toEqual(["writing 4", "adding 5", "cleared 6"]);
  });

  it("plans a dry run from the draft and keeps it", async () => {
    const c = await session(withCanvas(project.host));
    await c.call("preview_design", { name: "Checkout", html: "<body>Pay</body>" });
    const dry = await importPreview(c, { dryRun: true });
    expect(dry.isError, dry.text).toBe(false);
    expect(dry.text).toContain("Dry run: importing would add “Checkout”");
    expect(dry.meta).toMatchObject({ dryRun: true, screenId: null, screenName: "Checkout" });
    expect(requests[0]).toMatchObject({ html: "<body>Pay</body>" });
    expect(statuses()).toEqual(["writing 1"]);
    expect((await c.call("preview_design", { append: "<p>" })).structured).toMatchObject({ draftRevision: 2 });
  });

  it("teaches without a draft, and counts preview as a source", async () => {
    const c = await session(withCanvas(project.host));
    const none = await importPreview(c, {});
    expect(none.isError).toBe(true);
    expect(none.text).toContain("Error no_draft: There's no design preview to import for this session. Show one with preview_design first, or pass html.");
    const both = await importPreview(c, { html: "<p>hi</p>" });
    expect(both.text).toContain("Pass only one of url, html, capture or preview.");
    expect((await c.call("import_design", { preview: false })).text).toContain("import_design needs a source: url, html, capture or preview.");
    expect(requests).toEqual([]);
  });
});
