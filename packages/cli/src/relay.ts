/**
 * `sonobe mcp`: a stdio relay to the running Sonobe app. Reads ~/.sonobe/mcp.json (SONOBE_HOME
 * overrides), checks /health, then forwards each newline-delimited JSON-RPC message from stdin
 * as its own POST to the app's Streamable HTTP endpoint with the bearer token, writing JSON or
 * SSE responses back to stdout. Speaks 2026-07-28 (per-request envelope + Mcp-* headers) and
 * 2025-era traffic byte-for-byte. Node only.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

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
}

const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
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
  // stdin closing is how a client shuts the server down (the MCP stdio spec). Nobody reads the
  // answers any more, so end the calls still running; the app sees their streams close.
  for (const controller of inflight.values()) controller.abort();
  await Promise.all([...pending]);
  return 0;
}
