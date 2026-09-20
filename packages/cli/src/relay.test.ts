import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRelay, sessionFolder } from "./relay.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "sonobe-relay-"));
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ port: 1, url: "http://127.0.0.1:1/mcp", token: "t" }));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

type AppHandler = (message: Record<string, unknown>, signal: AbortSignal) => Promise<Response>;

/** What the fake app saw besides /health: every request's method, path, sonobe-client header and body. */
interface Seen {
  method: string;
  path: string;
  client: string | null;
  body: Record<string, unknown> | null;
}

interface RelayTestOptions {
  /** Answers /clients (default: 204). */
  clients?: (method: string) => Response | Promise<Response>;
  env?: Record<string, string | undefined>;
  cwd?: string;
  heartbeatMs?: number;
  stop?: AbortSignal;
}

/** The relay over a fake app: /health answers, /clients answers `clients`, /mcp POSTs go to `app`. */
function relay(app: AppHandler, options: RelayTestOptions = {}) {
  const stdin = new PassThrough();
  const lines: Record<string, unknown>[] = [];
  const seen: Seen[] = [];
  const errors: string[] = [];
  let buffer = "";
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/health") return Response.json({ ok: true, version: "9.9.9" });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const headers = new Headers(init?.headers);
    seen.push({ method: init?.method ?? "GET", path: url.pathname, client: headers.get("sonobe-client"), body });
    if (url.pathname.startsWith("/clients")) return options.clients?.(init?.method ?? "GET") ?? new Response(null, { status: 204 });
    return app(body!, init!.signal!);
  }) as typeof fetch;
  const done = runRelay({
    home,
    stdin,
    stdout: {
      write: (s: string) => {
        buffer += s;
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          lines.push(JSON.parse(buffer.slice(0, at)) as Record<string, unknown>);
          buffer = buffer.slice(at + 1);
        }
      },
    },
    stderr: { write: (s: string) => errors.push(s) },
    fetch: fetchImpl,
    env: options.env ?? {},
    cwd: options.cwd ?? "/",
    version: "0.1.0-test",
    randomId: () => "11111111-aaaa-4bbb-8ccc-000000000001",
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.stop ? { stop: options.stop } : {}),
  });
  const send = (message: Record<string, unknown>) => stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  return { stdin, lines, seen, errors, done, send };
}

const call = (id: number, name = "import_design") => ({ id, method: "tools/call", params: { name, arguments: {}, _meta: { progressToken: `p${id}` } } });

/** A response that never comes, rejecting like fetch when its signal aborts; `aborted` records that. */
function hanging(record: { aborted: boolean }): AppHandler {
  return (_message, signal) =>
    new Promise<Response>((_, reject) =>
      signal.addEventListener("abort", () => {
        record.aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }),
    );
}

async function until(condition: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
}

describe("sonobe mcp relay: long calls", () => {
  it("forwards SSE progress events in order, before the result", async () => {
    const r = relay(async (message) => {
      const events = [
        { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "p1", progress: 1, message: "Loading the page" } },
        { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "p1", progress: 2, message: "Downloading images: 1 of 1" } },
        { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "Imported" }] } },
      ];
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const event of events) {
            controller.enqueue(new TextEncoder().encode(`: keep-alive\n\ndata: ${JSON.stringify(event)}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    r.send(call(1));
    await until(() => r.lines.length === 3);
    r.stdin.end();
    await r.done;
    expect(r.lines.map((l) => (l.params as { message?: string } | undefined)?.message ?? l.id)).toEqual(["Loading the page", "Downloading images: 1 of 1", 1]);
  });

  // The relay reads stdin only after the connection file and /health, and a tool call waits for the
  // hello: wait until the app has the call rather than for a fixed time, which a loaded machine outlasts.
  const reachedApp = (r: ReturnType<typeof relay>, id: number) => until(() => r.seen.some((s) => s.body?.method === "tools/call" && s.body.id === id));

  it("turns a notifications/cancelled on stdin into an aborted request", async () => {
    const record = { aborted: false };
    const r = relay(hanging(record));
    r.send(call(3));
    await reachedApp(r, 3);
    r.send({ method: "notifications/cancelled", params: { requestId: 3, reason: "the person pressed Esc" } });
    await until(() => record.aborted);
    expect(record.aborted).toBe(true);
    r.stdin.end();
    await r.done;
    // The client cancelled it, so no answer follows.
    expect(r.lines).toEqual([]);
  });

  it("drops a call cancelled while it waits for the hello, without sending it", async () => {
    let answerHello!: (res: Response) => void;
    const hello = new Promise<Response>((resolve) => (answerHello = resolve));
    const r = relay(async () => Response.json({ jsonrpc: "2.0", id: 6, result: {} }), { clients: (method) => (method === "POST" ? hello : new Response(null, { status: 204 })) });
    r.send(call(6));
    await until(() => r.seen.some((s) => s.path === "/clients"));
    r.send({ method: "notifications/cancelled", params: { requestId: 6 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    answerHello(new Response(null, { status: 204 }));
    r.stdin.end();
    await r.done;
    expect(r.seen.filter((s) => s.path === "/mcp")).toEqual([]);
    expect(r.lines).toEqual([]);
  });

  it("ends the calls still running when stdin closes, instead of waiting for them", async () => {
    const record = { aborted: false };
    const r = relay(hanging(record));
    r.send(call(4));
    await reachedApp(r, 4);
    r.stdin.end();
    expect(await r.done).toBe(0);
    expect(record.aborted).toBe(true);
  });

  it("says the app didn't answer in time instead of calling it a lost connection", async () => {
    const r = relay(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
    });
    r.send(call(5));
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    const error = r.lines[0]!.error as { message: string };
    expect(r.lines[0]!.id).toBe(5);
    expect(error.message).toContain("didn't answer tools/call import_design within 5 minutes");
    expect(error.message).not.toContain("Lost connection");
  });
});

/** A fake app that answers requests with an empty result and notifications with 202. */
const answering: AppHandler = async (message) =>
  message.id === undefined
    ? new Response(null, { status: 202 })
    : Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "sonobe", version: "9.9.9" } } : {} });

const INITIALIZE = { id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "claude-code", title: "Claude Code", version: "2.1.278" } } };
const ID = "11111111-aaaa-4bbb-8ccc-000000000001";

describe("sonobe mcp relay: sessions", () => {
  it("names its session on every POST and says hello with the client and folder", async () => {
    const r = relay(answering, { env: { CLAUDE_PROJECT_DIR: "/Users/me/noddit" }, cwd: "/Users/me/noddit/src" });
    r.send(INITIALIZE);
    r.send({ method: "notifications/initialized" });
    r.send(call(1, "list_documents"));
    await until(() => r.lines.length === 2);
    r.stdin.end();
    await r.done;
    const mcp = r.seen.filter((s) => s.path === "/mcp");
    expect(mcp.map((s) => s.body?.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(mcp.every((s) => s.client === ID)).toBe(true);
    const hellos = r.seen.filter((s) => s.path === "/clients" && s.method === "POST");
    expect(hellos[0]!.body).toEqual({ id: ID, name: "claude-code", title: "Claude Code", version: "2.1.278", folder: "/Users/me/noddit", relay: { version: "0.1.0-test" } });
    // The hello goes out before the first tool call, so the app knows whose call it is.
    expect(r.seen.findIndex((s) => s.path === "/clients")).toBeLessThan(r.seen.findIndex((s) => s.body?.method === "tools/call"));
    // Goodbye when stdin closes.
    expect(r.seen.at(-1)).toMatchObject({ method: "DELETE", path: `/clients/${ID}` });
  });

  it("learns a 2026-07-28 client's name from its request metadata, and heartbeats", async () => {
    const r = relay(answering, { cwd: "/Users/me/app", heartbeatMs: 15 });
    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "2.2.0" } };
    r.send({ id: 1, method: "server/discover", params: { _meta: meta } });
    await until(() => r.seen.filter((s) => s.path === "/clients").length >= 3);
    r.stdin.end();
    await r.done;
    const hellos = r.seen.filter((s) => s.path === "/clients" && s.method === "POST");
    expect(hellos.length).toBeGreaterThanOrEqual(2);
    expect(hellos.every((h) => h.body?.name === "claude-code" && h.body?.version === "2.2.0" && h.body?.folder === "/Users/me/app")).toBe(true);
  });

  it("stops and says goodbye when asked to stop, as Claude Code does with SIGINT", async () => {
    const stop = new AbortController();
    const record = { aborted: false };
    const r = relay((message, signal) => (message.method === "tools/call" ? hanging(record)(message, signal) : answering(message, signal)), { stop: stop.signal });
    r.send(INITIALIZE);
    await until(() => r.lines.length === 1);
    r.send(call(7));
    await until(() => r.seen.some((s) => s.body?.method === "tools/call"));
    stop.abort();
    expect(await r.done).toBe(0);
    expect(record.aborted).toBe(true);
    expect(r.seen.at(-1)).toMatchObject({ method: "DELETE", path: `/clients/${ID}` });
  });

  it("keeps relaying for an older app without /clients, with one line on stderr", async () => {
    const notFound = () => Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Not found" } }, { status: 404 });
    const r = relay(answering, { clients: notFound, heartbeatMs: 10 });
    r.send(INITIALIZE);
    r.send(call(1, "list_documents"));
    await until(() => r.lines.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 40));
    r.stdin.end();
    await r.done;
    expect(r.lines.map((l) => l.id)).toEqual([0, 1]);
    // One hello, no heartbeats after the 404, and no goodbye.
    expect(r.seen.filter((s) => s.path.startsWith("/clients"))).toHaveLength(1);
    expect(r.errors.filter((e) => e.includes("doesn't list connected sessions"))).toHaveLength(1);
  });

  it("says why when the app turns the hello down", async () => {
    const rejected = () => Response.json({ jsonrpc: "2.0", id: null, error: { code: -32602, message: '"folder" must be an absolute path' } }, { status: 400 });
    const r = relay(answering, { clients: rejected });
    r.send(INITIALIZE);
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    expect(r.errors.join("")).toContain(`didn't accept this session's hello (HTTP 400: "folder" must be an absolute path)`);
  });
});

describe("sessionFolder", () => {
  it("prefers CLAUDE_PROJECT_DIR, then the working folder, but never / or home", () => {
    expect(sessionFolder({ CLAUDE_PROJECT_DIR: "/Users/me/noddit" }, "/tmp", "/Users/me")).toBe("/Users/me/noddit");
    expect(sessionFolder({}, "/Users/me/noddit/", "/Users/me")).toBe("/Users/me/noddit");
    expect(sessionFolder({ CLAUDE_PROJECT_DIR: " " }, "/Users/me/app", "/Users/me")).toBe("/Users/me/app");
    expect(sessionFolder({}, "/", "/Users/me")).toBeUndefined();
    expect(sessionFolder({}, "/Users/me", "/Users/me")).toBeUndefined();
    expect(sessionFolder({ CLAUDE_PROJECT_DIR: "relative" }, undefined, "/Users/me")).toBeUndefined();
  });
});
