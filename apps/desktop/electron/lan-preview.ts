/**
 * LAN preview server ("Preview on Phone", SONOBE_LAN=1). Serves the web player to devices on the
 * local network and streams the open document to them over WebSocket as it changes.
 *
 * Every URL lives under /p/<token>/ with a random 128-bit token (the QR code carries it), pages send
 * no Referer, sockets must come from the player's own origin, and the socket is one-way: nothing a
 * phone sends can change the document. Besides documents it carries one command, restart, sent when
 * the prototype restarts in Sonobe. Node only.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { WebSocketServer, type WebSocket } from "ws";

/** The document the player shows. */
export interface PreviewDocument {
  docId: string;
  name: string;
  revision: number;
  doc: unknown;
  /** The editor holds the project's scripts until the person trusts it; the player holds them too. */
  scriptsPaused?: boolean;
}

/** Messages sent to the player over the socket. */
export type PreviewMessage =
  | { type: "hello"; version: string }
  | { type: "document"; docId: string; name: string; revision: number; doc: unknown; scriptsPaused?: true }
  /** Start the prototype over from its first frame (Restart in Sonobe). */
  | { type: "restart" }
  | { type: "offline"; message: string };

export interface LanPreviewOptions {
  /** Directory with the built player (index.html, player.js, player.css). */
  playerRoot: string;
  /** The document to show, or null when nothing is open. */
  getDocument(): Promise<PreviewDocument | null>;
  /** Absolute path of a file under the current project's assets/ folder, or null. */
  resolveAsset?(file: string): Promise<string | null>;
  /** Default 0 (a free port). */
  port?: number | null;
  /** Bind address. Default "0.0.0.0" (every interface). */
  host?: string;
  /** URL token. Default: 16 random bytes, base64url. */
  token?: string;
  /** How often to look for a new revision while players are connected (polling mode). Default 400 ms. */
  pollMs?: number;
  /**
   * Start in push mode: no polling; the host calls poke() whenever the document changes (for example
   * from the editor's notifyDocumentChanged). Default false.
   */
  pushUpdates?: boolean;
  version?: string;
  /** Network interfaces (tests). */
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  /** Players connected or disconnected. */
  onClientsChange?(count: number): void;
  log?(level: "info" | "warn" | "error", message: string): void;
}

export interface LanPreviewHandle {
  readonly port: number;
  readonly token: string;
  /** The best player URL for a phone on the same network. */
  readonly url: string;
  /** One player URL per usable address, best first. */
  readonly urls: string[];
  /** False when no LAN address was found (only this computer can open the URL). */
  readonly lanReachable: boolean;
  clientCount(): number;
  /** Look for a new revision now (e.g. right after an edit). Does nothing while no player is connected. */
  poke(): void;
  /** Restart the prototype in every connected player, after sending any revision they don't have yet. */
  restart(): void;
  /** True when revisions arrive through poke() instead of polling. */
  readonly pushUpdates: boolean;
  /** Switch between polling and push mode. */
  setPushUpdates(on: boolean): void;
  /** Close every player's socket with code 1001 (up to 1 s for them to answer), then stop listening. */
  close(): Promise<void>;
}

export const OFFLINE_MESSAGE = "Open a prototype in Sonobe on your computer to preview it here.";

/** How long close() waits for players to answer its goodbye before cutting them off. */
const CLOSE_GRACE_MS = 1000;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/**
 * The player page's policy. Code comes only from the player's own origin (no inline or remote
 * scripts), nothing may frame it, and it posts no forms. Prototypes reach other hosts the way they do
 * in the editor's viewer: Network Request, JSON File and scripts fetch any http(s) URL (connect-src),
 * WebSocket Connection opens any ws(s) URL, and the images, videos and sounds those return (remote
 * URLs, or data: from Base64 Decode) load in layers and Sound Player (img-src, media-src). The
 * platform reads picked photos, captures and recordings (blob:) and data: files with fetch(), for
 * Base64 Encode and Network Request uploads, so connect-src takes blob: and data: too. Nothing else is
 * loosened.
 */
const PLAYER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "media-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss: blob: data:",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

/** Non-internal IPv4 addresses, Wi-Fi/Ethernet first and VPN/virtual interfaces last. */
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const info of list ?? []) {
      const family = info.family as string | number;
      if (info.internal || (family !== "IPv4" && family !== 4) || info.address.startsWith("169.254.")) continue;
      const rank = /^(en|eth|wl|wlan|wi-?fi|ethernet)/i.test(name) ? 0 : /^(utun|tun|tap|ppp|ipsec|vboxnet|vmnet|docker|br-|veth|awdl|llw|bridge|zt|tailscale)/i.test(name) ? 2 : 1;
      found.push({ address: info.address, rank });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  return [...new Set(found.map((f) => f.address))];
}

export function previewUrl(address: string, port: number, token: string): string {
  const host = address.includes(":") ? `[${address}]` : address;
  return `http://${host}:${port}/p/${token}/`;
}

/** The text of the app's own Preview on Phone dialog, for an editor that can't show its QR panel. */
export function phonePreviewDetail(url: string, lanReachable: boolean): string {
  return [
    lanReachable ? "Scan the code with a phone on the same Wi-Fi, or open this link:" : "No local network was found, so only this computer can open the preview:",
    url,
    "",
    ...(lanReachable ? ["On iPhone, scan the code in the Sonobe Viewer app to feel haptics. On the phone, a three-finger tap opens a menu with Restart; restarting in Sonobe restarts the phone too.", ""] : []),
    "The link includes a private code. Anyone with it can view this prototype while the preview is on.",
  ].join("\n");
}

function tokensMatch(candidate: string, token: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

/** Resolve a request path under /p/<token>/: the rest of the path, "redirect" for /p/<token>, or null. */
export function matchPreviewPath(rawUrl: string | undefined, token: string): { rest: string } | "redirect" | null {
  const pathname = (rawUrl ?? "/").split(/[?#]/)[0]!;
  const match = /^\/p\/([A-Za-z0-9_-]{1,128})(\/.*)?$/.exec(pathname);
  if (!match || !tokensMatch(match[1]!, token)) return null;
  if (match[2] === undefined) return "redirect";
  try {
    const rest = decodeURIComponent(match[2].slice(1));
    return rest.includes("\0") ? null : { rest };
  } catch {
    return null;
  }
}

/** A file under `root`, or null when `rel` escapes it. */
export function resolveUnder(root: string, rel: string): string | null {
  const file = path.resolve(root, rel);
  const relative = path.relative(root, file);
  return relative === "" || relative.startsWith("..") || path.isAbsolute(relative) ? null : file;
}

const baseHeaders = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" };

function sendText(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(Buffer.byteLength(text)), "Cache-Control": "no-store", ...headers });
  res.end(text);
}

/** Text files worth compressing: the player bundle is megabytes of JavaScript sent over Wi-Fi. */
const COMPRESSIBLE: ReadonlySet<string> = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".svg", ".txt"]);
const MIN_COMPRESS_BYTES = 1024;
const MAX_GZIP_CACHE = 32;
/** Gzipped bodies by file, for the file version (ETag) they were made from. */
const gzipCache = new Map<string, { etag: string; body: Buffer }>();

async function gzippedFile(file: string, etag: string): Promise<Buffer> {
  const cached = gzipCache.get(file);
  if (cached?.etag === etag) return cached.body;
  const body = gzipSync(await readFile(file));
  gzipCache.delete(file);
  if (gzipCache.size >= MAX_GZIP_CACHE) gzipCache.delete(gzipCache.keys().next().value!);
  gzipCache.set(file, { etag, body });
  return body;
}

/** True when an If-None-Match header lists `etag` (or "*"). */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  return String(header)
    .split(",")
    .some((tag) => tag.trim() === "*" || bare(tag) === bare(etag));
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cacheControl: string, extraHeaders: Record<string, string> = {}): Promise<void> {
  let size: number;
  let etag: string;
  let modified: string;
  try {
    const info = await stat(file);
    if (!info.isFile()) return sendText(res, 404, "Not found");
    size = info.size;
    etag = `W/"${size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    modified = info.mtime.toUTCString();
  } catch {
    return sendText(res, 404, "Not found");
  }
  const ext = path.extname(file).toLowerCase();
  const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const compressible = COMPRESSIBLE.has(ext);
  const headers: Record<string, string> = { ...baseHeaders, "Content-Type": type, "Cache-Control": cacheControl, "Accept-Ranges": "bytes", ETag: etag, "Last-Modified": modified, ...(compressible ? { Vary: "Accept-Encoding" } : {}), ...extraHeaders };
  // A phone reopening the player revalidates instead of downloading the bundle again.
  if (cacheControl !== "no-store" && etagMatches(req.headers["if-none-match"], etag)) {
    res.writeHead(304, { ...baseHeaders, "Cache-Control": cacheControl, ETag: etag, "Last-Modified": modified, ...(compressible ? { Vary: "Accept-Encoding" } : {}) });
    res.end();
    return;
  }
  if (compressible && size >= MIN_COMPRESS_BYTES && req.headers.range === undefined && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
    const body = await gzippedFile(file, etag);
    const { "Accept-Ranges": _ranges, ...rest } = headers;
    res.writeHead(200, { ...rest, "Content-Encoding": "gzip", "Content-Length": String(body.length) });
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }
  // Safari needs byte ranges for video.
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) return sendText(res, 416, "Range not satisfiable", { "Content-Range": `bytes */${size}` });
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  await new Promise<void>((resolve) => {
    const stream = createReadStream(file, { start, end });
    stream.on("error", () => {
      res.destroy();
      resolve();
    });
    stream.on("end", resolve);
    stream.pipe(res);
  });
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}

export async function startLanPreview(opts: LanPreviewOptions): Promise<LanPreviewHandle> {
  const log = opts.log ?? (() => undefined);
  const token = opts.token ?? randomBytes(16).toString("base64url");
  const pollMs = Math.max(50, opts.pollMs ?? 400);
  const playerRoot = path.resolve(opts.playerRoot);
  const hello = JSON.stringify({ type: "hello", version: opts.version ?? "0.0.0" } satisfies PreviewMessage);
  const RESTART = JSON.stringify({ type: "restart" } satisfies PreviewMessage);

  let lastKey: string | null = null;
  let lastPayload: string | null = null;
  let polling = false;
  let pollAgain = false;
  /** A restart waits for the poll in flight, so players restart on the newest revision. */
  let restartPending = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let pushUpdates = opts.pushUpdates === true;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, clientTracking: true });
  const alive = new WeakMap<WebSocket, boolean>();

  const broadcast = (payload: string) => {
    for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(payload);
  };

  const current = async (): Promise<{ key: string; payload: string }> => {
    const doc = await opts.getDocument();
    if (!doc) return { key: "offline", payload: JSON.stringify({ type: "offline", message: OFFLINE_MESSAGE } satisfies PreviewMessage) };
    const paused = doc.scriptsPaused === true;
    const message: PreviewMessage = { type: "document", docId: doc.docId, name: doc.name, revision: doc.revision, doc: doc.doc, ...(paused ? { scriptsPaused: true as const } : {}) };
    // Trusting the project changes no revision, so the key includes whether scripts wait.
    return { key: `${doc.docId}@${doc.revision}${paused ? ":paused" : ""}`, payload: JSON.stringify(message) };
  };

  const poll = async () => {
    if (closed) return;
    if (polling) {
      pollAgain = true;
      return;
    }
    polling = true;
    try {
      const next = await current();
      if (next.key !== lastKey) {
        lastKey = next.key;
        lastPayload = next.payload;
        broadcast(next.payload);
      }
    } catch (err) {
      log("warn", `Phone preview couldn't read the document: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      polling = false;
      if (pollAgain) {
        pollAgain = false;
        void poll();
      } else if (restartPending) {
        restartPending = false;
        broadcast(RESTART);
      }
    }
  };

  let reportedClients = 0;
  const syncPolling = () => {
    if (wss.clients.size !== reportedClients) {
      reportedClients = wss.clients.size;
      if (!closed) opts.onClientsChange?.(reportedClients);
    }
    const wantTimer = wss.clients.size > 0 && !pushUpdates && !closed;
    if (wantTimer && !pollTimer) {
      pollTimer = setInterval(() => void poll(), pollMs);
      pollTimer.unref?.();
    } else if (!wantTimer && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (wss.clients.size === 0) {
      lastKey = null;
      lastPayload = null;
    }
  };

  wss.on("connection", (ws: WebSocket) => {
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", (data) => {
      if (String(data) === '{"type":"ping"}') ws.send('{"type":"pong"}');
    });
    ws.on("close", syncPolling);
    ws.on("error", () => ws.terminate());
    ws.send(hello);
    if (lastPayload) ws.send(lastPayload);
    syncPolling();
    void poll();
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate();
        continue;
      }
      alive.set(client, false);
      client.ping();
    }
  }, 20_000);
  heartbeat.unref?.();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const route = matchPreviewPath(req.url, token);
    if (route === null) return sendText(res, 404, "Not found");
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
    if (route === "redirect") {
      res.writeHead(308, { ...baseHeaders, Location: `/p/${token}/`, "Cache-Control": "no-store", "Content-Length": "0" });
      res.end();
      return;
    }
    const rest = route.rest;
    if (rest === "" || rest === "index.html") {
      return sendFile(req, res, path.join(playerRoot, "index.html"), "no-store", { "Content-Security-Policy": PLAYER_CSP, "X-Frame-Options": "DENY" });
    }
    if (rest === "document.json") {
      const next = await current();
      const body = next.payload;
      res.writeHead(next.key === "offline" ? 503 : 200, { ...baseHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)), "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if (rest.startsWith("assets/")) {
      const name = rest.slice("assets/".length);
      if (!/^[A-Za-z0-9._-]{1,200}$/.test(name) || name.startsWith(".") || !opts.resolveAsset) return sendText(res, 404, "Not found");
      const file = await opts.resolveAsset(name);
      return file ? sendFile(req, res, file, "private, max-age=60") : sendText(res, 404, "Not found");
    }
    const file = resolveUnder(playerRoot, rest);
    if (!file) return sendText(res, 404, "Not found");
    return sendFile(req, res, file, "no-cache");
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      log("error", `Phone preview request failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      sendText(res, 500, "Internal error");
    });
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;

  server.on("upgrade", (req, socket, head) => {
    const route = matchPreviewPath(req.url, token);
    if (route === null || route === "redirect" || route.rest !== "sync" || !sameOrigin(req) || closed) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const bindHost = opts.host ?? "0.0.0.0";
  const requestedPort = opts.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(err.code === "EADDRINUSE" ? new Error(`Phone preview port ${requestedPort} is already in use. Set SONOBE_LAN_PORT to a free port or unset it.`) : err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port: requestedPort, host: bindHost });
  });
  server.on("error", (err) => log("error", `Phone preview server error: ${err.message}`));

  const port = (server.address() as AddressInfo).port;
  const wildcard = bindHost === "0.0.0.0" || bindHost === "::";
  const addresses = wildcard ? lanAddresses(opts.interfaces?.() ?? networkInterfaces()) : [bindHost];
  const lanReachable = addresses.some((a) => a !== "127.0.0.1" && a !== "localhost" && a !== "::1");
  const urls = (addresses.length ? addresses : ["127.0.0.1"]).map((a) => previewUrl(a, port, token));
  log("info", `Phone preview on ${urls[0]}${lanReachable ? "" : " (no local network found; only this computer can open it)"}`);

  return {
    port,
    token,
    url: urls[0]!,
    urls,
    lanReachable,
    clientCount: () => wss.clients.size,
    poke: () => {
      if (wss.clients.size > 0) void poll();
    },
    restart: () => {
      if (wss.clients.size === 0 || closed) return;
      restartPending = true;
      void poll();
    },
    get pushUpdates() {
      return pushUpdates;
    },
    setPushUpdates(on) {
      if (pushUpdates === on) return;
      pushUpdates = on;
      syncPolling();
      if (!on) void poll();
    },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      clearInterval(heartbeat);
      if (pollTimer) clearInterval(pollTimer);
      // Say goodbye and let each player answer before cutting off the ones that don't. A player closing
      // its own socket at that moment (a tab or window going away) would otherwise send its close
      // frame to a socket just destroyed, which Node throws as an uncaught RangeError from
      // TCP.onStreamRead: in the app, a JavaScript error dialog that stops the main process.
      const players = [...wss.clients];
      for (const client of players) client.close(1001, "The preview stopped");
      return new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(grace);
          for (const client of wss.clients) client.terminate();
          wss.close();
          server.close(() => resolve());
          server.closeAllConnections();
        };
        const grace = setTimeout(finish, CLOSE_GRACE_MS);
        let open = players.length;
        if (open === 0) finish();
        for (const client of players) client.once("close", () => --open === 0 && finish());
      });
    },
  };
}
