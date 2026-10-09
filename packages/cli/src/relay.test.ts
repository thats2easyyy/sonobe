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

type AppHandler = (message: Record<string, unknown>, signal: AbortSignal, token: string) => Promise<Response>;

/** What the fake app saw besides /health: every request's method, path, sonobe-client header, bearer token and body. */
interface Seen {
  method: string;
  path: string;
  client: string | null;
  token: string;
  body: Record<string, unknown> | null;
}

interface RelayTestOptions {
  /** Answers /clients (default: 204). */
  clients?: (method: string, token: string) => Response | Promise<Response>;
  /** Answers /health for a token (default: ok). */
  health?: (token: string) => Response | Promise<Response>;
  reconnectMs?: number;
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
    const headers = new Headers(init?.headers);
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (url.pathname === "/health") return options.health?.(token) ?? Response.json({ ok: true, version: "9.9.9" });
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    seen.push({ method: init?.method ?? "GET", path: url.pathname, client: headers.get("sonobe-client"), token, body });
    if (url.pathname.startsWith("/clients")) return options.clients?.(init?.method ?? "GET", token) ?? new Response(null, { status: 204 });
    return app(body!, init!.signal!, token);
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
    reconnectMs: options.reconnectMs ?? 2000,
    reconnectPollMs: 5,
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
    const r = relay(answering, { env: { CLAUDE_PROJECT_DIR: "/Users/me/placemark" }, cwd: "/Users/me/placemark/src" });
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
    expect(hellos[0]!.body).toEqual({ id: ID, name: "claude-code", title: "Claude Code", version: "2.1.278", folder: "/Users/me/placemark", relay: { version: "0.1.0-test" } });
    // The hello goes out before the first tool call, so the app knows whose call it is.
    expect(r.seen.findIndex((s) => s.path === "/clients")).toBeLessThan(r.seen.findIndex((s) => s.body?.method === "tools/call"));
    // Goodbye when stdin closes.
    expect(r.seen.at(-1)).toMatchObject({ method: "DELETE", path: `/clients/${ID}` });
  });

  it("leaves out clientInfo fields the client sent blank", async () => {
    const r = relay(answering);
    r.send({ ...INITIALIZE, params: { ...INITIALIZE.params, clientInfo: { name: " my-agent ", title: "  ", version: "" } } });
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    const hellos = r.seen.filter((s) => s.path === "/clients" && s.method === "POST");
    expect(hellos[0]!.body).toEqual({ id: ID, name: "my-agent", relay: { version: "0.1.0-test" } });
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
    const r = relay((message, signal, token) => (message.method === "tools/call" ? hanging(record)(message, signal, token) : answering(message, signal, token)), { stop: stop.signal });
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

describe("sonobe mcp relay: the app restarts under a session", () => {
  const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  const reset = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  /** A new launch, once the relay is up and talking to the first: another port and token in mcp.json. */
  const relaunch = async (r: ReturnType<typeof relay>) => {
    await until(() => r.errors.some((e) => e.includes("relaying to Sonobe")));
    await writeFile(path.join(home, "mcp.json"), JSON.stringify({ port: 2, url: "http://127.0.0.1:2/mcp", token: "t2", pid: 222 }));
  };
  /** An app whose first launch (token "t") stopped listening, and whose second (token "t2") answers. */
  const restarted: AppHandler = (message, signal, token) => (token === "t" ? Promise.reject(refused()) : answering(message, signal, token));
  /** /health of that app: the first launch answered when the relay started and is gone afterwards. */
  const restartedHealth = () => {
    let asked = 0;
    return (token: string) => (token === "t2" || asked++ === 0 ? Response.json({ ok: true, version: "9.9.9" }) : Promise.reject(refused()));
  };
  const read = (id: number) => ({ id, method: "resources/read", params: { uri: "sonobe://documents/like_toggle/outline" } });

  it("finds the new launch after a refused connection, says hello to it, and sends a read again", async () => {
    const r = relay(restarted, { health: restartedHealth() });
    r.send(INITIALIZE);
    await until(() => r.errors.some((e) => e.includes("request failed")));
    await relaunch(r);
    await until(() => r.lines.length === 1);
    r.send(read(1));
    await until(() => r.lines.length === 2);
    r.stdin.end();
    await r.done;
    expect(r.lines.map((l) => l.id)).toEqual([0, 1]);
    // The request went to the old launch once and to the new one once.
    expect(r.seen.filter((s) => s.body?.method === "initialize").map((s) => s.token)).toEqual(["t", "t2"]);
    expect(r.seen.filter((s) => s.body?.method === "resources/read").map((s) => s.token)).toEqual(["t2"]);
    // The new launch never heard of this session: it gets a hello, and the goodbye.
    expect(r.seen.filter((s) => s.path === "/clients" && s.method === "POST" && s.token === "t2").length).toBeGreaterThanOrEqual(1);
    expect(r.seen.at(-1)).toMatchObject({ method: "DELETE", path: `/clients/${ID}`, token: "t2" });
    expect(r.errors.filter((e) => e.includes("Sonobe restarted. Relaying to it again at http://127.0.0.1:2/mcp"))).toHaveLength(1);
  });

  it("does the same when the app turns the token down", async () => {
    const unauthorized: AppHandler = (message, signal, token) => (token === "t" ? Promise.resolve(new Response("{}", { status: 401 })) : answering(message, signal, token));
    let asked = 0;
    const r = relay(unauthorized, { health: (token) => (token === "t2" || asked++ === 0 ? Response.json({ ok: true }) : new Response(null, { status: 401 })) });
    await relaunch(r);
    r.send(read(1));
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    expect(r.lines).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    expect(r.seen.filter((s) => s.path === "/mcp").map((s) => s.token)).toEqual(["t", "t2"]);
  });

  it("never sends a tool call into a launch it wasn't meant for: it says Sonobe restarted, and the next call works", async () => {
    const r = relay(restarted, { health: restartedHealth() });
    await relaunch(r);
    r.send(call(1, "add_layers"));
    await until(() => r.lines.length === 1);
    r.send(call(2, "list_documents"));
    await until(() => r.lines.length === 2);
    r.stdin.end();
    await r.done;
    const error = r.lines[0]!.error as { message: string };
    expect(r.lines[0]!.id).toBe(1);
    expect(error.message).toBe("Sonobe restarted before this call reached it, so it wasn't run. The relay has found Sonobe again: check what's open (list_documents), then try again.");
    // The new launch may have another document in front: it never saw add_layers.
    expect(r.seen.filter((s) => s.body?.method === "tools/call").map((s) => [(s.body!.params as { name: string }).name, s.token])).toEqual([["add_layers", "t"], ["list_documents", "t2"]]);
    expect(r.lines[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  it("doesn't repeat a tool call that was cut off mid-flight, says it may have been applied, and carries on", async () => {
    const cutOff: AppHandler = (message, signal, token) => (token === "t" ? Promise.reject(reset()) : answering(message, signal, token));
    const r = relay(cutOff, { health: restartedHealth() });
    await relaunch(r);
    r.send(call(1, "apply_ops"));
    await until(() => r.lines.length === 1);
    r.send(call(2, "list_history"));
    await until(() => r.lines.length === 2);
    r.stdin.end();
    await r.done;
    expect((r.lines[0]!.error as { message: string }).message).toBe(
      "Sonobe restarted while this call was running, so it may or may not have been applied. The relay has found Sonobe again: check what's open and what changed (list_documents, list_history) before trying again.",
    );
    expect(r.seen.filter((s) => (s.body?.params as { name?: string } | undefined)?.name === "apply_ops")).toHaveLength(1);
    expect(r.lines[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  it("repeats a read that was cut off mid-flight", async () => {
    let cuts = 0;
    const r = relay((message, signal, token) => (message.method === "resources/read" && cuts++ === 0 ? Promise.reject(reset()) : answering(message, signal, token)));
    r.send(read(1));
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    expect(r.lines).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    expect(r.seen.filter((s) => s.body?.method === "resources/read")).toHaveLength(2);
  });

  it("retries after a blip with the same launch, tool calls that never arrived included, without a second hello", async () => {
    let refusals = 0;
    const r = relay((message, signal, token) => (message.method === "tools/call" && refusals++ === 0 ? Promise.reject(refused()) : answering(message, signal, token)));
    r.send(INITIALIZE);
    await until(() => r.lines.length === 1);
    r.send(call(1, "add_layers"));
    await until(() => r.lines.length === 2);
    r.stdin.end();
    await r.done;
    expect(r.lines[1]).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(r.seen.filter((s) => s.body?.method === "tools/call")).toHaveLength(2);
    expect(r.seen.filter((s) => s.path === "/clients" && s.method === "POST")).toHaveLength(1);
    expect(r.errors.join("")).not.toContain("Sonobe restarted");
  });

  it("says a cut-off tool call may have been applied when the same launch is still there", async () => {
    let cuts = 0;
    const r = relay((message, signal, token) => (message.method === "tools/call" && cuts++ === 0 ? Promise.reject(reset()) : answering(message, signal, token)));
    r.send(call(1, "apply_ops"));
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    expect((r.lines[0]!.error as { message: string }).message).toContain("The connection to Sonobe broke while this call was running, so it may or may not have been applied. Sonobe is still there");
    expect(r.seen.filter((s) => s.body?.method === "tools/call")).toHaveLength(1);
  });

  it("says the connection is lost when the app doesn't come back in time, and to open Sonobe and try again", async () => {
    let asked = 0;
    const r = relay(() => Promise.reject(refused()), { health: () => (asked++ === 0 ? Response.json({ ok: true }) : Promise.reject(refused())), reconnectMs: 40 });
    r.send(call(1, "list_documents"));
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    expect((r.lines[0]!.error as { message: string }).message).toBe("Lost connection to the Sonobe app (ECONNREFUSED). Open Sonobe and try again; or use `sonobe mcp --headless <project>` to work without the app.");
    expect(r.seen.filter((s) => s.path === "/mcp")).toHaveLength(1);
  });

  it("waits once for an app that was quit: the next calls fail at once, and the first one after Sonobe is opened again finds it", async () => {
    let gone = false;
    let looks = 0;
    const r = relay((message, signal, token) => (token === "t" ? Promise.reject(refused()) : answering(message, signal, token)), {
      health: (token) => (token === "t2" || !gone ? Response.json({ ok: true }) : (looks++, Promise.reject(refused()))),
      reconnectMs: 400,
    });
    await until(() => r.errors.some((e) => e.includes("relaying to Sonobe")));
    gone = true;
    let began = Date.now();
    r.send(read(1));
    await until(() => r.lines.length === 1);
    // The first failure waits the whole time, in case this is a restart.
    expect(Date.now() - began).toBeGreaterThanOrEqual(380);
    const looksWhileWaiting = looks;
    began = Date.now();
    r.send(read(2));
    await until(() => r.lines.length === 2);
    r.send(call(3, "list_documents"));
    await until(() => r.lines.length === 3);
    // The next ones look once each and fail at once: Sonobe was quit, not restarted.
    expect(Date.now() - began).toBeLessThan(300);
    expect(looks).toBe(looksWhileWaiting + 2);
    for (const line of r.lines) expect((line.error as { message: string }).message).toContain("Lost connection to the Sonobe app (ECONNREFUSED). Open Sonobe and try again");

    // Sonobe is opened again: the next read goes through with no reconnect, and waiting is back for the next restart.
    await writeFile(path.join(home, "mcp.json"), JSON.stringify({ port: 2, url: "http://127.0.0.1:2/mcp", token: "t2", pid: 222 }));
    r.send(read(4));
    await until(() => r.lines.length === 4);
    r.stdin.end();
    await r.done;
    expect(r.lines[3]).toEqual({ jsonrpc: "2.0", id: 4, result: {} });
    expect(r.errors.filter((e) => e.includes("Sonobe restarted"))).toHaveLength(1);
  });

  it("keeps waiting for a restart when a heartbeat's single look came up empty meanwhile", async () => {
    // The heartbeat looks once every 10 ms and finds nothing; the call's own wait is not cut short by joining one of those looks.
    const r = relay(restarted, { heartbeatMs: 10, health: restartedHealth(), clients: (_method, token) => (token === "t" ? Promise.reject(refused()) : new Response(null, { status: 204 })) });
    r.send(INITIALIZE);
    await until(() => r.errors.some((e) => e.includes("request failed")));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(r.lines).toEqual([]);
    await relaunch(r);
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    expect(r.lines.map((l) => l.id)).toEqual([0]);
  });

  it("never sends a tool call on to a launch a heartbeat found first", async () => {
    // The old launch refuses the call only after the heartbeat has adopted the new one: by then the relay's own
    // look finds the launch it already knows, and the call still wasn't meant for it.
    let refuse!: () => void;
    const held = new Promise<void>((resolve) => (refuse = resolve));
    const r = relay((message, signal, token) => (token === "t" ? held.then(() => Promise.reject(refused())) : answering(message, signal, token)), {
      heartbeatMs: 10,
      health: restartedHealth(),
      clients: (_method, token) => (token === "t" ? Promise.reject(refused()) : new Response(null, { status: 204 })),
    });
    r.send(call(1, "add_layers"));
    await until(() => r.seen.some((s) => s.body?.method === "tools/call"));
    await relaunch(r);
    await until(() => r.errors.some((e) => e.includes("Sonobe restarted")));
    refuse();
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    expect((r.lines[0]!.error as { message: string }).message).toContain("Sonobe restarted before this call reached it, so it wasn't run.");
    expect(r.seen.filter((s) => s.body?.method === "tools/call").map((s) => s.token)).toEqual(["t"]);
  });

  it("doesn't send a batch with a tool call in it twice either, and answers each request in it", async () => {
    const stdin = (r: ReturnType<typeof relay>, batch: unknown[]) => r.stdin.write(`${JSON.stringify(batch)}\n`);
    const batchSeen = (r: ReturnType<typeof relay>) => r.seen.filter((s) => s.path === "/mcp" && Array.isArray(s.body));
    const cutOffOnce = () => {
      let cuts = 0;
      return ((message, signal, token) => (Array.isArray(message) && cuts++ === 0 ? Promise.reject(reset()) : Array.isArray(message) ? Promise.resolve(Response.json(message.filter((m) => m.id !== undefined).map((m) => ({ jsonrpc: "2.0", id: m.id, result: {} })))) : answering(message, signal, token))) as AppHandler;
    };
    const withCall = relay(cutOffOnce());
    stdin(withCall, [{ jsonrpc: "2.0", ...read(1) }, { jsonrpc: "2.0", ...call(2, "apply_ops") }, { jsonrpc: "2.0", method: "notifications/progress", params: {} }]);
    await until(() => withCall.lines.length === 2);
    withCall.stdin.end();
    await withCall.done;
    expect(batchSeen(withCall)).toHaveLength(1);
    expect(withCall.lines.map((l) => l.id)).toEqual([1, 2]);
    for (const line of withCall.lines) expect((line.error as { message: string }).message).toContain("may or may not have been applied");

    // A batch of reads alone is sent again, like a read.
    const reads = relay(cutOffOnce());
    stdin(reads, [{ jsonrpc: "2.0", ...read(1) }, { jsonrpc: "2.0", ...read(2) }]);
    await until(() => reads.lines.length === 2);
    reads.stdin.end();
    await reads.done;
    expect(batchSeen(reads)).toHaveLength(2);
    expect(reads.lines).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }, { jsonrpc: "2.0", id: 2, result: {} }]);
  });

  it("finds a restarted app from a heartbeat too, so an idle session is listed again", async () => {
    const r = relay(answering, { heartbeatMs: 10, health: restartedHealth(), clients: (_method, token) => (token === "t" ? Promise.reject(refused()) : new Response(null, { status: 204 })) });
    r.send(INITIALIZE);
    await until(() => r.seen.some((s) => s.path === "/clients"));
    await relaunch(r);
    await until(() => r.seen.some((s) => s.path === "/clients" && s.token === "t2"));
    r.stdin.end();
    await r.done;
    expect(r.seen.some((s) => s.path === "/clients" && s.method === "POST" && s.token === "t2")).toBe(true);
    expect(r.errors.filter((e) => e.includes("Sonobe restarted"))).toHaveLength(1);
    expect(r.errors.join("")).not.toContain("didn't accept this session's hello");
  });
});

describe("sessionFolder", () => {
  it("prefers CLAUDE_PROJECT_DIR, then the working folder, but never / or home", () => {
    expect(sessionFolder({ CLAUDE_PROJECT_DIR: "/Users/me/placemark" }, "/tmp", "/Users/me")).toBe("/Users/me/placemark");
    expect(sessionFolder({}, "/Users/me/placemark/", "/Users/me")).toBe("/Users/me/placemark");
    expect(sessionFolder({ CLAUDE_PROJECT_DIR: " " }, "/Users/me/app", "/Users/me")).toBe("/Users/me/app");
    expect(sessionFolder({}, "/", "/Users/me")).toBeUndefined();
    expect(sessionFolder({}, "/Users/me", "/Users/me")).toBeUndefined();
    expect(sessionFolder({ CLAUDE_PROJECT_DIR: "relative" }, undefined, "/Users/me")).toBeUndefined();
  });
});
