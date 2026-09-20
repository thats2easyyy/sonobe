import { createServer, type Server } from "node:http";
import v8 from "node:v8";
import vm from "node:vm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ANONYMOUS_CLIENT, createClientRegistry, type ClientRegistry } from "./clients.ts";
import type { HeadlessHost } from "./headless.ts";
import type { CapturedDesign, DesignCaptureRequest, HostCallControl } from "./host.ts";
import { modernMeta, tempProject, type TempProject } from "./test-helpers.ts";
import { createHttpHandler, type NodeMcpHandler } from "./transports.ts";

// A real gc() without restarting vitest under --expose-gc.
v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CAPTURE = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "html", title: "Slow" },
  viewport: { width: 402, height: 874 },
  root: { kind: "frame", name: "Slow", box: [0, 0, 402, 874], fill: "#FFFFFFFF", children: [] },
  images: {},
};

/** captureDesign calls as the host saw them: when each started and when its signal aborted. */
interface CaptureCall {
  started: number;
  aborted?: number;
}

let project: TempProject;
let calls: CaptureCall[];
let capture: (control: HostCallControl, call: CaptureCall) => Promise<CapturedDesign>;
let host: HeadlessHost;
const servers: { handler: NodeMcpHandler; server: Server }[] = [];
let url: string;

/** Serve the host over createHttpHandler on a free port. */
async function serve(keepAliveMs: number): Promise<string> {
  const handler = createHttpHandler(host, { version: "0.1.0-test", keepAliveMs });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push({ handler, server });
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
}

beforeAll(async () => {
  project = await tempProject();
  host = Object.create(project.host) as HeadlessHost;
  Object.defineProperty(host, "captureDesign", {
    value: (_request: DesignCaptureRequest, control: HostCallControl = {}) => {
      const call: CaptureCall = { started: Date.now() };
      calls.push(call);
      control.signal?.addEventListener("abort", () => (call.aborted = Date.now()), { once: true });
      return capture(control, call);
    },
  });
  // Keep-alives also reveal a closed connection (the next write fails), so they're slow here: the
  // disconnect test must see the abort without one.
  url = await serve(60_000);
});

afterAll(async () => {
  for (const { handler, server } of servers) {
    await handler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await project.cleanup();
});

beforeEach(() => {
  calls = [];
  capture = () => new Promise<never>(() => undefined);
});

afterEach(async () => {
  // Let aborted calls finish before the next test counts calls.
  await sleep(20);
});

const LEGACY = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" };

function postTool(id: number, meta: Record<string, unknown> = {}, init: { signal?: AbortSignal; modern?: boolean; url?: string; client?: string } = {}) {
  const headers: Record<string, string> = init.modern
    ? { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "import_design" }
    : { ...LEGACY, ...(init.client ? { "sonobe-client": init.client } : {}) };
  return fetch(init.url ?? url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "import_design", arguments: { html: "<p>slow</p>" }, _meta: { ...meta, ...(init.modern ? modernMeta() : {}) } } }),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

/** The JSON-RPC messages of an SSE body, in order. */
async function sseMessages(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split(/\r?\n\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n"),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

async function until(condition: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await sleep(10);
}

describe("createHttpHandler: long calls", () => {
  it("streams progress notifications before the result (2025-era)", async () => {
    capture = async (control) => {
      control.progress?.({ message: "Reading the page's layers" });
      await sleep(300);
      return { capture: CAPTURE as never, images: new Map() };
    };
    const res = await postTool(1, { progressToken: "p1" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const messages = await sseMessages(res);
    const progress = messages.filter((m) => m.method === "notifications/progress");
    expect(progress.map((m) => (m.params as { message: string }).message)).toEqual(expect.arrayContaining(["Rendering the HTML", "Reading the page's layers"]));
    expect(progress.every((m) => (m.params as { progressToken: string }).progressToken === "p1")).toBe(true);
    const resultAt = messages.findIndex((m) => m.id === 1);
    expect(resultAt).toBeGreaterThan(messages.indexOf(progress[0]!));
    expect(JSON.stringify(messages[resultAt])).toContain('Imported \\"Slow\\"');
  });

  it("aborts the call when the client disconnects, even after a garbage collection", async () => {
    const before = (await project.host.getDocument()).revision;
    const controller = new AbortController();
    const res = postTool(2, {}, { signal: controller.signal }).catch(() => undefined);
    await until(() => calls.length === 1);
    for (let i = 0; i < 3; i++) {
      gc();
      await sleep(10);
    }
    const disconnected = Date.now();
    controller.abort();
    await res;
    await until(() => calls[0]?.aborted !== undefined, 1_000);
    expect(calls[0]!.aborted).toBeDefined();
    expect(calls[0]!.aborted! - disconnected).toBeLessThan(500);
    expect((await project.host.getDocument()).revision).toBe(before);
  });

  it("routes notifications/cancelled to the call it names, and ignores an ambiguous id", async () => {
    const cancel = (requestId: number) =>
      fetch(url, { method: "POST", headers: LEGACY, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId, reason: "the person pressed Esc" } }) });

    const one = postTool(5);
    await until(() => calls.length === 1);
    expect((await cancel(5)).status).toBe(202);
    await until(() => calls[0]?.aborted !== undefined, 1_000);
    expect(calls[0]!.aborted).toBeDefined();
    await one;

    // Two clients that happen to use the same id: the cancel can't tell them apart, so it's dropped.
    const controllers = [new AbortController(), new AbortController()];
    const both = controllers.map((c) => postTool(9, {}, { signal: c.signal }).catch(() => undefined));
    await until(() => calls.length === 3);
    await cancel(9);
    await sleep(300);
    expect(calls.slice(1).map((c) => c.aborted)).toEqual([undefined, undefined]);
    for (const c of controllers) c.abort();
    await Promise.all(both);
  });

  it("keeps a relay session's calls out of other clients' cancels", async () => {
    const RELAY = "11111111-aaaa-4bbb-8ccc-000000000001";
    const cancel = (requestId: number, client?: string) =>
      fetch(url, {
        method: "POST",
        headers: { ...LEGACY, ...(client ? { "sonobe-client": client } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId } }),
      });
    const relayed = postTool(11, {}, { client: RELAY });
    await until(() => calls.length === 1);
    // Another client's late cancel of its own id 11 (its call already answered) isn't the relay's to take.
    expect((await cancel(11)).status).toBe(202);
    await sleep(300);
    expect(calls[0]!.aborted).toBeUndefined();
    // The same session's cancel still reaches it.
    await cancel(11, RELAY);
    await until(() => calls[0]?.aborted !== undefined, 1_000);
    expect(calls[0]!.aborted).toBeDefined();
    await relayed;
  });

  it("sends a silent 2026-07-28 call's headers at once, then keep-alives", async () => {
    capture = async () => (await sleep(1_000), { capture: CAPTURE as never, images: new Map() });
    const quick = await serve(200);
    const started = Date.now();
    const res = await postTool(7, {}, { modern: true, url: quick });
    expect(Date.now() - started).toBeLessThan(700);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toMatch(/^:/m);
    expect(text).toContain('"resultType":"complete"');
  });

  it("answers a body that isn't JSON like the SDK does", async () => {
    const res = await fetch(url, { method: "POST", headers: LEGACY, body: "{not json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700 } });
  });
});

describe("createHttpHandler: sessions", () => {
  const A = "11111111-aaaa-4bbb-8ccc-000000000001";
  const B = "22222222-aaaa-4bbb-8ccc-000000000002";
  let clients: ClientRegistry;
  let sessionUrl: string;
  let sessions: TempProject;

  beforeAll(async () => {
    sessions = await tempProject();
    clients = createClientRegistry();
    const handler = createHttpHandler(sessions.host, { version: "0.1.0-test", clients });
    const server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    servers.push({ handler, server });
    sessionUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  });

  afterAll(async () => {
    await sessions.cleanup();
  });

  /** One tools/call over stateless HTTP; returns the result's text. */
  async function callAs(client: string | null, name: string, args: Record<string, unknown> = {}, modern = false): Promise<string> {
    const headers: Record<string, string> = modern
      ? { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": name }
      : { ...LEGACY };
    if (client) headers["sonobe-client"] = client;
    const res = await fetch(sessionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, ...(modern ? { _meta: modernMeta("cursor-agent") } : {}) } }),
    });
    const result = (await sseMessages(res)).find((m) => m.id === 1)?.result as { content?: { text?: string }[] } | undefined;
    return result?.content?.map((c) => c.text ?? "").join("\n") ?? "";
  }

  it("counts tool calls per relay session, and puts clients without the relay in one row", async () => {
    clients.hello({ id: A, name: "claude-code", title: "Claude Code", folder: "/Users/me/noddit" });
    await callAs(A, "list_documents");
    await callAs(A, "get_outline");
    await callAs(null, "list_documents");
    expect(clients.get(A)).toMatchObject({ label: "Claude Code", folder: "/Users/me/noddit", toolCalls: 2, lastTool: "get_outline", state: "connected" });
    expect(clients.get(ANONYMOUS_CLIENT)).toMatchObject({ via: "http", label: "Unidentified MCP client", toolCalls: 1 });
    // A 2026-07-28 client names itself on every request, relay or not.
    await callAs(null, "list_documents", {}, true);
    expect(clients.get(ANONYMOUS_CLIENT)).toMatchObject({ label: "Cursor Agent", toolCalls: 2 });
  });

  it("attributes a relay session's edits by the name its hello announced", async () => {
    clients.hello({ id: B, name: "cursor-agent" });
    expect(await callAs(B, "add_layers", { layers: [{ type: "oval", name: "Session Dot" }] })).toContain("session_dot");
    const [latest] = await sessions.host.history.list({ limit: 1 });
    expect(latest?.author).toEqual({ kind: "agent", name: "Cursor Agent" });
  });

  it("keeps each session's working badge, so one finish_work doesn't clear the other", async () => {
    clients.hello({ id: A, name: "claude-code", title: "Claude Code", folder: "/Users/me/noddit" });
    clients.hello({ id: B, name: "claude-code", title: "Claude Code", folder: "/Users/me/sonobe" });
    await callAs(A, "begin_work", { intent: "Tuning the deck" });
    await callAs(B, "begin_work", { intent: "Adding a tab bar" });
    expect((await sessions.host.presence()).map((w) => [w.intent, w.client?.folder])).toEqual([
      ["Tuning the deck", "/Users/me/noddit"],
      ["Adding a tab bar", "/Users/me/sonobe"],
    ]);
    expect(await callAs(A, "get_document_info")).toContain("Working: Claude (Claude Code in /Users/me/noddit) — Tuning the deck; Claude (Claude Code in /Users/me/sonobe) — Adding a tab bar");
    await callAs(A, "finish_work");
    expect((await sessions.host.presence()).map((w) => w.intent)).toEqual(["Adding a tab bar"]);
    await callAs(B, "finish_work");
    expect(await sessions.host.presence()).toEqual([]);
  });
});
