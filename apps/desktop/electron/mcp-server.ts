/**
 * Localhost HTTP endpoint for MCP (ARCHITECTURE.md §10).
 *
 * Binds 127.0.0.1 only, validates Host and Origin (DNS-rebinding guard), requires a per-launch
 * 256-bit bearer token, and advertises { port, url, token, pid, version } in ~/.sonobe/mcp.json
 * (0600). Routes /mcp to a pluggable handler so a later stage can mount the MCP SDK transport,
 * e.g. `setHandler(toNodeHandler(createMcpHandler(buildServer)))`, and /clients to the connected-
 * sessions registry: `sonobe mcp` says hello there (POST) and goodbye (DELETE /clients/<id>).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isClientId, parseHello, type ClientRegistry } from "@sonobe/mcp";
import { atomicWriteFileSync } from "./fs-utils.ts";

export type McpRequestHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export interface McpConnectionFile {
  port: number;
  url: string;
  token: string;
  pid: number;
  version: string;
}

export interface StartMcpServerOptions {
  /** Handles /mcp requests (already authenticated). Defaults to a 501 "not yet wired" JSON-RPC error. */
  onRequest?: McpRequestHandler;
  /** App version reported by /health and mcp.json. */
  version: string;
  /** Fixed port; defaults to SONOBE_MCP_PORT or a random free port. */
  port?: number | null;
  /** Directory for mcp.json; defaults to SONOBE_HOME or ~/.sonobe. */
  configDir?: string;
  /** Inject a token (tests). Defaults to 32 random bytes, base64url. */
  token?: string;
  /** Requests declaring a larger Content-Length are rejected with 413. Default 8 MiB. */
  maxBodyBytes?: number;
  /** Connected sessions: /clients takes the relay's hello, heartbeat and goodbye. Without it, /clients is 404. */
  clients?: ClientRegistry;
  log?(level: "info" | "warn" | "error", message: string): void;
}

/** Largest /clients hello. */
const MAX_HELLO_BYTES = 16 * 1024;

export interface McpServerHandle {
  readonly port: number;
  readonly url: string;
  readonly token: string;
  readonly tokenFile: string;
  readonly version: string;
  readonly running: boolean;
  /** Swap the /mcp handler without restarting (null restores the 501 placeholder). */
  setHandler(handler: McpRequestHandler | null): void;
  /** Remove mcp.json if this process wrote it. Synchronous for quit paths. */
  removeTokenFile(): void;
  /** Stop listening, drop open connections, and remove mcp.json. */
  close(): Promise<void>;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** ~/.sonobe, or SONOBE_HOME when set. */
export function defaultSonobeHome(env: Record<string, string | undefined> = process.env): string {
  return env.SONOBE_HOME?.trim() || path.join(homedir(), ".sonobe");
}

/** Host must name a loopback address with the exact port we're bound to. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const match = /^(\[::1\]|[^:]+):(\d+)$/.exec(host.trim().toLowerCase());
  if (!match) return false;
  return LOOPBACK_HOSTNAMES.has(match[1]!) && Number(match[2]) === port;
}

/** Origin may be absent (native clients) or a loopback http(s) origin. "null" is rejected. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Constant-time bearer comparison (hashes first so lengths don't leak). */
export function bearerMatches(authorization: string | undefined, token: string): boolean {
  if (!authorization) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  if (!match) return false;
  const a = createHash("sha256").update(match[1]!).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload)),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string, id: unknown = null, headers?: Record<string, string>): void {
  sendJson(res, status, { jsonrpc: "2.0", id, error: { code, message } }, headers);
}

async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > limit) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Placeholder /mcp handler: echoes the request id with a 501 JSON-RPC error. */
export function createNotWiredHandler(maxBodyBytes = 8 * 1024 * 1024): McpRequestHandler {
  return async (req, res) => {
    let id: unknown = null;
    if (req.method === "POST") {
      const body = await readBody(req, maxBodyBytes);
      if (body === null) return jsonRpcError(res, 413, -32000, "Request body too large");
      try {
        const parsed = JSON.parse(body) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const candidate = (parsed as Record<string, unknown>).id;
          if (typeof candidate === "string" || typeof candidate === "number") id = candidate;
        }
      } catch {
        return jsonRpcError(res, 400, -32700, "Parse error: body must be JSON");
      }
    }
    jsonRpcError(res, 501, -32001, "MCP tools not yet wired", id);
  };
}

/** POST /clients: a relay's hello or heartbeat. DELETE /clients/<id>: its goodbye. Both answer 204. */
function serveClients(clients: ClientRegistry, pathname: string, req: IncomingMessage, res: ServerResponse): void {
  if (req.method === "DELETE" && pathname.startsWith("/clients/")) {
    // Relay ids need no decoding, so the segment is checked as it is (a malformed escape can't throw).
    const id = pathname.slice("/clients/".length);
    if (!isClientId(id)) return jsonRpcError(res, 400, -32602, "The id after /clients/ must be 8 to 64 letters, digits or dashes: the one the hello sent.");
    clients.bye(id);
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || pathname !== "/clients") return jsonRpcError(res, 405, -32000, "Method not allowed: POST /clients says hello, DELETE /clients/<id> says goodbye", null, { Allow: "POST, DELETE" });
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_HELLO_BYTES) return jsonRpcError(res, 413, -32000, "Request body too large");
  void readBody(req, MAX_HELLO_BYTES).then(
    (body) => {
      if (body === null) return jsonRpcError(res, 413, -32000, "Request body too large");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return jsonRpcError(res, 400, -32700, "Parse error: body must be JSON");
      }
      const hello = parseHello(parsed);
      if (typeof hello === "string") return jsonRpcError(res, 400, -32602, hello);
      clients.hello(hello);
      res.writeHead(204).end();
    },
    () => res.destroy(),
  );
}

function writeConnectionFile(file: string, data: McpConnectionFile): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Not fatal (e.g. a shared SONOBE_HOME we don't own); the file itself stays 0600.
  }
  atomicWriteFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export async function startMcpServer(opts: StartMcpServerOptions): Promise<McpServerHandle> {
  const log = opts.log ?? (() => undefined);
  const maxBodyBytes = opts.maxBodyBytes ?? 8 * 1024 * 1024;
  const token = opts.token ?? randomBytes(32).toString("base64url");
  const tokenFile = path.join(opts.configDir ?? defaultSonobeHome(), "mcp.json");
  const envPort = process.env.SONOBE_MCP_PORT ? Number(process.env.SONOBE_MCP_PORT) : null;
  const requestedPort = opts.port ?? (envPort !== null && Number.isInteger(envPort) && envPort > 0 && envPort < 65536 ? envPort : 0);

  const notWired = createNotWiredHandler(maxBodyBytes);
  let handler: McpRequestHandler = opts.onRequest ?? notWired;
  let port = 0;
  let running = false;
  let wroteFile = false;

  const server: Server = createServer((req, res) => {
    if (!isAllowedHost(req.headers.host, port)) return jsonRpcError(res, 403, -32000, "Forbidden: invalid Host header");
    if (!isAllowedOrigin(req.headers.origin)) return jsonRpcError(res, 403, -32000, "Forbidden: invalid Origin header");
    if (!bearerMatches(req.headers.authorization, token)) {
      return jsonRpcError(res, 401, -32000, "Unauthorized: send Authorization: Bearer <token> from ~/.sonobe/mcp.json", null, { "WWW-Authenticate": 'Bearer realm="sonobe"' });
    }

    const pathname = (req.url ?? "/").split("?")[0];
    if (pathname === "/health") {
      if (req.method !== "GET" && req.method !== "HEAD") return jsonRpcError(res, 405, -32000, "Method not allowed", null, { Allow: "GET, HEAD" });
      return sendJson(res, 200, { ok: true, version: opts.version });
    }
    if (pathname === "/mcp") {
      if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") return jsonRpcError(res, 405, -32000, "Method not allowed", null, { Allow: "GET, POST, DELETE" });
      const declared = Number(req.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > maxBodyBytes) return jsonRpcError(res, 413, -32000, "Request body too large");
      Promise.resolve()
        .then(() => handler(req, res))
        .catch((err: unknown) => {
          log("error", `MCP handler failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
          jsonRpcError(res, 500, -32603, "Internal error");
        });
      return;
    }
    if (opts.clients && (pathname === "/clients" || pathname?.startsWith("/clients/"))) return serveClients(opts.clients, pathname, req, res);
    jsonRpcError(res, 404, -32000, "Not found");
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 0; // /mcp may hold long-lived SSE responses.

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(err.code === "EADDRINUSE" ? new Error(`MCP port ${requestedPort} is already in use. Set SONOBE_MCP_PORT to a free port or unset it.`) : err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port: requestedPort, host: "127.0.0.1", exclusive: true });
  });

  port = (server.address() as AddressInfo).port;
  running = true;
  const url = `http://127.0.0.1:${port}/mcp`;
  server.on("error", (err) => log("error", `MCP server error: ${err.message}`));

  try {
    writeConnectionFile(tokenFile, { port, url, token, pid: process.pid, version: opts.version });
    wroteFile = true;
  } catch (err) {
    server.close();
    running = false;
    throw new Error(`Couldn't write ${tokenFile}: ${err instanceof Error ? err.message : String(err)}`);
  }
  log("info", `MCP endpoint listening on ${url}`);

  const removeTokenFile = () => {
    if (!wroteFile) return;
    try {
      const current = JSON.parse(readFileSync(tokenFile, "utf8")) as Partial<McpConnectionFile>;
      if (current.pid === process.pid && current.token === token) rmSync(tokenFile, { force: true });
    } catch {
      // Already gone or replaced by another instance; leave it alone.
    }
    wroteFile = false;
  };

  return {
    get port() {
      return port;
    },
    url,
    token,
    tokenFile,
    version: opts.version,
    get running() {
      return running;
    },
    setHandler(next) {
      handler = next ?? notWired;
    },
    removeTokenFile,
    close() {
      removeTokenFile();
      if (!running) return Promise.resolve();
      running = false;
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
