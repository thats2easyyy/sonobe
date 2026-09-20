/**
 * `sonobe mcp`: a stdio relay to the running Sonobe app. Reads ~/.sonobe/mcp.json (SONOBE_HOME
 * overrides), checks /health, then forwards each newline-delimited JSON-RPC message from stdin
 * as its own POST to the app's Streamable HTTP endpoint with the bearer token, writing JSON or
 * SSE responses back to stdout. Speaks 2026-07-28 (per-request envelope + Mcp-* headers) and
 * 2025-era traffic byte-for-byte.
 *
 * It also tells the app which session it is, so Connect Claude can list connected sessions: every
 * POST carries a per-process `sonobe-client` id, and /clients gets a hello with the client's name and
 * the session's folder, a heartbeat every 30 s, and a goodbye when stdin closes or `stop` aborts
 * (the CLI aborts it on SIGINT and SIGTERM). Node only.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { CLIENT_HEADER, type McpClientHello } from "@sonobe/mcp";

export interface ConnectionFile {
  port: number;
  url: string;
  token: string;
  pid?: number;
  version?: string;
}

export interface TextSink {
  write(text: string): unknown;
}

export interface RelayOptions {
  home: string;
  stdin: Readable;
  stdout: TextSink;
  stderr: TextSink;
  fetch?: typeof fetch;
  /** For the session's folder: CLAUDE_PROJECT_DIR. */
  env?: Record<string, string | undefined>;
  /** The folder the client started the relay in. */
  cwd?: string;
  /** The relay's version, sent in its hello. */
  version?: string;
  /** How often the relay says it's still there. Default 30 s. */
  heartbeatMs?: number;
  /** The session id (default: a random UUID per process). */
  randomId?: () => string;
  /**
   * Aborts when the process is asked to stop (SIGINT, SIGTERM). Claude Code ends a stdio server with
   * SIGINT rather than by closing stdin; the relay then stops like on stdin end, goodbye included.
   */
  stop?: AbortSignal;
}

/**
 * The session's project folder: CLAUDE_PROJECT_DIR (Claude Code sets it), else the folder the client
 * started the relay in. None for the file system root or the home folder, where apps like Claude
 * Desktop start servers.
 */
export function sessionFolder(env: Record<string, string | undefined>, cwd: string | undefined, home = homedir()): string | undefined {
  const dir = env.CLAUDE_PROJECT_DIR?.trim() || cwd;
  if (!dir || !path.isAbsolute(dir)) return undefined;
  const resolved = path.resolve(dir);
  return resolved === path.parse(resolved).root || resolved === path.resolve(home) ? undefined : resolved;
}

const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const NAME_SOURCES: Record<string, string> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

/** SONOBE_HOME, or ~/.sonobe. */
export function sonobeHome(env: Record<string, string | undefined>): string {
  return env.SONOBE_HOME?.trim() || path.join(homedir(), ".sonobe");
}

export const NOT_RUNNING_HELP = [
  "Start the Sonobe app (it writes the connection file on launch), then reconnect this MCP server.",
  "  In Claude Code: /mcp, pick sonobe, Reconnect. In Claude Desktop: restart the Sonobe extension.",
  "Or work on a project folder without the app:",
  "  sonobe mcp --headless <project.sonobe>",
].join("\n");

/** Read and sanity-check the connection file; null when missing. */
export async function readConnectionFile(home: string): Promise<ConnectionFile | null> {
  let text: string;
  try {
    text = await readFile(path.join(home, "mcp.json"), "utf8");
  } catch {
    return null;
  }
  const json = JSON.parse(text) as Partial<ConnectionFile>;
  if (typeof json.url !== "string" || typeof json.token !== "string")
    throw new Error(`${path.join(home, "mcp.json")} is missing "url" or "token".`);
  return {
    port: Number(json.port ?? new URL(json.url).port),
    url: json.url,
    token: json.token,
    ...(json.pid !== undefined ? { pid: json.pid } : {}),
    ...(json.version !== undefined ? { version: json.version } : {}),
  };
}

/** GET /health with the bearer token. */
export async function checkHealth(
  conn: ConnectionFile,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; version?: string } | { ok: false; reason: string }> {
  const url = new URL("/health", conn.url);
  try {
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${conn.token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 401)
      return {
        ok: false,
        reason: "the app rejected the token in mcp.json (it belongs to an older launch)",
      };
    if (!res.ok) return { ok: false, reason: `the app answered /health with HTTP ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { version?: unknown };
    return typeof body.version === "string" ? { ok: true, version: body.version } : { ok: true };
  } catch (err) {
    const cause =
      (err as { cause?: { code?: string } }).cause?.code ??
      (err instanceof Error ? err.message : String(err));
    return { ok: false, reason: `nothing answered at ${url.origin} (${cause})` };
  }
}

/** Header-safe Mcp-Name value (base64 sentinel for anything outside printable ASCII). */
export function encodeHeaderValue(value: string): string {
  return /^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/.test(value)
    ? value
    : `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};

/** Split an SSE body into data payloads. */
export async function* sseMessages(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let at: number;
    while ((at = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, at);
      buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) yield data;
    }
  }
  const tail = buffer
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""))
    .join("\n");
  if (tail) yield tail;
}

/** Run the relay until stdin closes. Returns the exit code. */
export async function runRelay(options: RelayOptions): Promise<number> {
  const fetchImpl = options.fetch ?? fetch;
  const { stdout, stderr } = options;
  let conn: ConnectionFile | null;
  try {
    conn = await readConnectionFile(options.home);
  } catch (err) {
    stderr.write(
      `sonobe mcp: couldn't read the connection file: ${err instanceof Error ? err.message : String(err)}\n${NOT_RUNNING_HELP}\n`,
    );
    return 1;
  }
  if (!conn) {
    stderr.write(
      `sonobe mcp: the Sonobe app isn't running (no ${path.join(options.home, "mcp.json")}).\n${NOT_RUNNING_HELP}\n`,
    );
    return 1;
  }
  const health = await checkHealth(conn, fetchImpl);
  if (!health.ok) {
    stderr.write(
      `sonobe mcp: couldn't reach the Sonobe app: ${health.reason}.\n${NOT_RUNNING_HELP}\n`,
    );
    return 1;
  }
  stderr.write(
    `sonobe mcp: relaying to Sonobe${health.version ? ` ${health.version}` : ""} at ${conn.url}\n`,
  );

  const connection = conn;
  let legacyVersion: string | undefined;
  const initializeIds = new Set<string | number>();
  const inflight = new Map<string | number, AbortController>();
  const pending = new Set<Promise<void>>();

  // Which session this is (Connect Claude lists it): a hello on the client's first message and again
  // once it names itself, a heartbeat, and a goodbye at the end. Older apps don't have /clients;
  // relaying goes on.
  const clientId = (options.randomId ?? randomUUID)();
  const folder = sessionFolder(options.env ?? {}, options.cwd);
  let clientInfo: Pick<McpClientHello, "name" | "title" | "version"> = {};
  let announcing = true;
  let announced = false;
  let hello: Promise<void> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const announce = async () => {
    if (!announcing) return;
    const body: McpClientHello = { id: clientId, ...clientInfo, ...(folder ? { folder } : {}), relay: options.version ? { version: options.version } : {} };
    try {
      const res = await fetchImpl(new URL("/clients", connection.url), {
        method: "POST",
        headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        announced = true;
        return;
      }
      // 5xx: the app is busy; the next heartbeat tries again. 4xx: it won't list this session.
      if (res.status >= 500 && res.status !== 501) return;
      announcing = false;
      const text = await res.text().catch(() => "");
      const reason = (() => {
        try {
          return (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
        } catch {
          return undefined;
        }
      })();
      stderr.write(
        res.status === 404 || res.status === 405 || res.status === 501
          ? "sonobe mcp: this Sonobe app doesn't list connected sessions. Update Sonobe to see this session in Connect Claude.\n"
          : `sonobe mcp: the app didn't accept this session's hello (HTTP ${res.status}${typeof reason === "string" ? `: ${reason}` : ""}), so Connect Claude won't list it.\n`,
      );
    } catch {
      // Not answering right now; the next heartbeat tries again.
    }
  };
  /** Say hello on the client's first message, and again once it names itself (initialize, or 2026-07-28 metadata). */
  const noticeClient = (message: JsonRpcMessage) => {
    const meta = message.params?._meta as Record<string, unknown> | undefined;
    const info = (message.method === "initialize" ? message.params?.clientInfo : meta?.[CLIENT_INFO_KEY]) as Record<string, unknown> | undefined;
    // Blank fields stay out (clientInfo's version is required, so some clients send ""): older apps refuse a hello with one.
    const named = Object.fromEntries(
      (["name", "title", "version"] as const)
        .map((key) => [key, typeof info?.[key] === "string" ? (info[key] as string).trim() : ""] as const)
        .filter(([, value]) => value),
    );
    const learned = Object.keys(named).length > 0 && JSON.stringify(named) !== JSON.stringify(clientInfo);
    if (learned) clientInfo = named;
    if (hello && !learned) return;
    hello = announce();
    heartbeat ??= setInterval(() => void announce(), options.heartbeatMs ?? 30_000);
    heartbeat.unref?.();
  };

  const emit = (message: unknown) => {
    const m = message as JsonRpcMessage;
    if (m && m.id !== undefined && m.id !== null && initializeIds.has(m.id)) {
      initializeIds.delete(m.id);
      const version = (m.result as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      if (typeof version === "string") legacyVersion = version;
    }
    stdout.write(`${JSON.stringify(message)}\n`);
  };

  const fail = (id: string | number | null | undefined, message: string, code = -32000) => {
    if (id === undefined || id === null) return;
    emit({ jsonrpc: "2.0", id, error: { code, message } });
  };

  const forward = async (message: JsonRpcMessage | JsonRpcMessage[]) => {
    const single = Array.isArray(message) ? undefined : message;
    const headers: Record<string, string> = {
      authorization: `Bearer ${connection.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      [CLIENT_HEADER]: clientId,
    };
    const claim =
      single?.params?._meta && typeof single.params._meta === "object"
        ? (single.params._meta as Record<string, unknown>)[PROTOCOL_VERSION_KEY]
        : undefined;
    const field = single?.method ? NAME_SOURCES[single.method] : undefined;
    const name = field ? single?.params?.[field] : undefined;
    if (single?.method && typeof claim === "string") {
      headers["mcp-protocol-version"] = claim;
      headers["mcp-method"] = single.method;
      if (typeof name === "string") headers["mcp-name"] = encodeHeaderValue(name);
    } else if (legacyVersion && single?.method !== "initialize") {
      headers["mcp-protocol-version"] = legacyVersion;
    }
    const id = single?.id ?? undefined;
    const controller = new AbortController();
    if (id !== undefined && id !== null) inflight.set(id, controller);
    try {
      // Tool calls wait for the hello (at most its 3 s timeout), so the app knows whose call it is.
      if (single?.method === "tools/call" && hello) await hello;
      if (controller.signal.aborted) return;
      const res = await fetchImpl(connection.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (res.status === 202 || res.status === 204) return;
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("text/event-stream") && res.body) {
        for await (const data of sseMessages(res.body)) {
          try {
            emit(JSON.parse(data));
          } catch {
            stderr.write(`sonobe mcp: skipped a malformed event from the app\n`);
          }
        }
        return;
      }
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const m = item as JsonRpcMessage;
          if (m.id === null && id !== undefined && id !== null && m.error) emit({ ...m, id });
          else emit(item);
        }
        return;
      }
      fail(
        id,
        `The Sonobe app answered HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}.`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const code = (err as { cause?: { code?: unknown } }).cause?.code ?? (err as { code?: unknown }).code;
      const reason = typeof code === "string" ? code : err instanceof Error ? err.message : String(err);
      stderr.write(`sonobe mcp: request failed: ${reason}\n`);
      // Node's fetch gives up after 5 minutes without response headers or body bytes. The app is
      // still there; it just hasn't answered this call.
      if (reason === "UND_ERR_HEADERS_TIMEOUT" || reason === "UND_ERR_BODY_TIMEOUT") {
        fail(
          id,
          `The Sonobe app didn't answer ${single?.method ?? "the request"}${typeof name === "string" ? ` ${name}` : ""} within 5 minutes, so the relay stopped waiting. The call may still be running in the app: check what changed (list_history, get_outline) before trying again.`,
        );
        return;
      }
      fail(
        id,
        `Lost connection to the Sonobe app (${reason}). Reopen Sonobe, then reconnect this MCP server; or use \`sonobe mcp --headless <project>\` to work without the app.`,
      );
    } finally {
      if (id !== undefined && id !== null) inflight.delete(id);
    }
  };

  const lines = createInterface({ input: options.stdin, crlfDelay: Infinity });
  const stopReading = () => lines.close();
  if (options.stop?.aborted) stopReading();
  else options.stop?.addEventListener("abort", stopReading, { once: true });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: JsonRpcMessage | JsonRpcMessage[];
    try {
      message = JSON.parse(line) as JsonRpcMessage | JsonRpcMessage[];
    } catch {
      emit({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error: each stdin line must be one JSON-RPC message.",
        },
      });
      continue;
    }
    if (!Array.isArray(message) && message.method === "notifications/cancelled") {
      const requestId = message.params?.requestId as string | number | undefined;
      if (requestId !== undefined) inflight.get(requestId)?.abort();
      continue;
    }
    if (!Array.isArray(message) && message.method) noticeClient(message);
    if (
      !Array.isArray(message) &&
      message.method === "initialize" &&
      message.id !== undefined &&
      message.id !== null
    )
      initializeIds.add(message.id);
    const task = forward(message).finally(() => pending.delete(task));
    pending.add(task);
  }
  // stdin closing (or a stop signal) is how a client shuts the server down (the MCP stdio spec).
  // Nobody reads the answers any more, so end the calls still running; the app sees their streams close.
  options.stop?.removeEventListener("abort", stopReading);
  clearInterval(heartbeat);
  for (const controller of inflight.values()) controller.abort();
  await Promise.all([...pending]);
  // Goodbye, so Connect Claude marks the session gone now rather than after 75 s without a heartbeat.
  await hello;
  if (announced && announcing)
    await fetchImpl(new URL(`/clients/${clientId}`, connection.url), {
      method: "DELETE",
      headers: { authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(1000),
    }).catch(() => undefined);
  return 0;
}
