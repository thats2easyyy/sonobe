/**
 * Connected MCP clients: which Claude sessions (or other MCP clients) are talking to the app right
 * now, with their name, project folder and last activity. The desktop's Connect Claude button and
 * dialog list them (ARCHITECTURE §10, "Sessions").
 *
 * Fed two ways: `sonobe mcp` says hello on /clients when its client starts, again every 30 s, and
 * goodbye when stdin closes; and every tool call that carries its `sonobe-client` header counts as
 * activity. Clients without the relay send no id, so they share one anonymous row. Deterministic:
 * time comes from `now`. Browser-safe.
 */

/** The request header `sonobe mcp` sends with every POST, carrying its per-process client id. */
export const CLIENT_HEADER = "sonobe-client";

/** The registry id of the shared row for clients that send no `sonobe-client` header. */
export const ANONYMOUS_CLIENT = "http";

export type McpClientVia = "relay" | "http";
/** connected: heard from recently. idle: a client without the relay, quiet for a while. gone: said goodbye or stopped heartbeating. */
export type McpClientState = "connected" | "idle" | "gone";

/** What `sonobe mcp` announces on POST /clients. */
export interface McpClientHello {
  /** The relay's per-process id (a UUID), also sent in the sonobe-client header. */
  id: string;
  /** The MCP client's clientInfo (initialize, or 2026-07-28 request metadata). */
  name?: string;
  title?: string;
  version?: string;
  /** The session's project folder: CLAUDE_PROJECT_DIR, or the relay's working folder. Absolute. */
  folder?: string;
  /** The relay's own version, to spot a stale install. */
  relay?: { version?: string };
}

export interface McpClientStatus {
  id: string;
  /** "Claude Code", "Claude Desktop", the client's own name, or "Unidentified MCP client". */
  label: string;
  name: string | null;
  title: string | null;
  version: string | null;
  folder: string | null;
  via: McpClientVia;
  state: McpClientState;
  connectedAt: number;
  lastSeenAt: number;
  /** The last tool call (heartbeats don't count). */
  lastActivityAt: number | null;
  lastTool: string | null;
  toolCalls: number;
  relayVersion: string | null;
}

export interface ClientRegistryOptions {
  now?: () => number;
  /** A relay that hasn't said hello for this long is gone (it heartbeats every 30 s). Default 75 s. */
  staleAfterMs?: number;
  /** A client without the relay counts as connected this long after its last call. Default 120 s. */
  httpActiveMs?: number;
  /** Gone clients (and idle ones without the relay) drop off the list after this long. Default 10 min. */
  forgetAfterMs?: number;
  /** At most this many rows; the longest-quiet ones go first. Default 32. */
  maxClients?: number;
}

export interface ClientRegistry {
  /** A relay's hello or heartbeat. */
  hello(hello: McpClientHello): void;
  /** A relay's goodbye (its client closed stdin). */
  bye(id: string): void;
  /** A tool call. `id` is the sonobe-client header, or null for clients without the relay. */
  toolCall(id: string | null, tool: string, clientInfo?: { name?: string; title?: string; version?: string }): void;
  get(id: string): McpClientStatus | undefined;
  /** Every client, most recently active first. */
  list(): McpClientStatus[];
  /** Called when a row appears, changes what it shows, or goes away (not for heartbeats alone). */
  subscribe(listener: () => void): () => void;
}

const KNOWN_CLIENTS: Record<string, string> = { "claude-code": "Claude Code", "claude-ai": "Claude Desktop" };

/** "Claude Code" for claude-code, "Claude Desktop" for claude-ai, else the title or a prettified name. */
export function clientLabel(info: { name?: string | null; title?: string | null }): string {
  const name = info.name?.trim();
  if (name && KNOWN_CLIENTS[name]) return KNOWN_CLIENTS[name];
  if (info.title?.trim()) return info.title.trim().slice(0, 60);
  if (!name) return "MCP client";
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
}

/** A client id the relay could have sent (a UUID or similar). Anything else counts as no id. */
export function isClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);
}

interface Entry {
  id: string;
  via: McpClientVia;
  name?: string;
  title?: string;
  version?: string;
  folder?: string;
  relayVersion?: string;
  connectedAt: number;
  lastSeenAt: number;
  lastActivityAt: number | null;
  lastTool: string | null;
  toolCalls: number;
  goneAt: number | null;
}

export function createClientRegistry(options: ClientRegistryOptions = {}): ClientRegistry {
  const now = options.now ?? (() => Date.now());
  const staleAfter = options.staleAfterMs ?? 75_000;
  const httpActive = options.httpActiveMs ?? 120_000;
  const forgetAfter = options.forgetAfterMs ?? 600_000;
  const maxClients = Math.max(1, options.maxClients ?? 32);
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };

  const stateOf = (e: Entry, t: number): McpClientState => {
    if (e.goneAt !== null) return "gone";
    if (e.via === "relay") return t - e.lastSeenAt <= staleAfter ? "connected" : "gone";
    return e.lastActivityAt !== null && t - e.lastActivityAt <= httpActive ? "connected" : "idle";
  };
  /** When the row stops being worth listing. */
  const forgetAt = (e: Entry): number => {
    if (e.via === "http") return (e.lastActivityAt ?? e.lastSeenAt) + forgetAfter;
    return (e.goneAt ?? e.lastSeenAt + staleAfter) + forgetAfter;
  };

  const status = (e: Entry, t: number): McpClientStatus => ({
    id: e.id,
    label: e.via === "http" && !e.name && !e.title ? "Unidentified MCP client" : clientLabel(e),
    name: e.name ?? null,
    title: e.title ?? null,
    version: e.version ?? null,
    folder: e.folder ?? null,
    via: e.via,
    state: stateOf(e, t),
    connectedAt: e.connectedAt,
    lastSeenAt: e.lastSeenAt,
    lastActivityAt: e.lastActivityAt,
    lastTool: e.lastTool,
    toolCalls: e.toolCalls,
    relayVersion: e.relayVersion ?? null,
  });
  /** What a row shows, without the heartbeat time. */
  const visible = (e: Entry | undefined, t: number) => {
    if (!e) return "";
    const { lastSeenAt: _seen, ...rest } = status(e, t);
    return JSON.stringify(rest);
  };

  const entry = (id: string, via: McpClientVia, t: number): Entry => {
    let e = entries.get(id);
    if (!e) {
      e = { id, via, connectedAt: t, lastSeenAt: t, lastActivityAt: null, lastTool: null, toolCalls: 0, goneAt: null };
      entries.set(id, e);
    } else if (e.goneAt !== null || stateOf(e, t) === "gone") {
      // Back after a goodbye or a long silence (a laptop that slept): a new connection.
      e.connectedAt = t;
      e.goneAt = null;
    }
    return e;
  };

  /** Drop rows past forgetAfter, then the longest-quiet ones beyond maxClients. */
  const prune = (t: number) => {
    for (const [id, e] of entries) if (t > forgetAt(e)) entries.delete(id);
    if (entries.size <= maxClients) return;
    const quietFirst = [...entries.values()].sort((a, b) => {
      const gone = Number(stateOf(b, t) === "gone") - Number(stateOf(a, t) === "gone");
      return gone || Math.max(a.lastSeenAt, a.lastActivityAt ?? 0) - Math.max(b.lastSeenAt, b.lastActivityAt ?? 0);
    });
    for (const e of quietFirst.slice(0, entries.size - maxClients)) entries.delete(e.id);
  };

  return {
    hello(h) {
      const t = now();
      const before = visible(entries.get(h.id), t);
      const e = entry(h.id, "relay", t);
      if (h.name !== undefined) e.name = h.name;
      if (h.title !== undefined) e.title = h.title;
      if (h.version !== undefined) e.version = h.version;
      if (h.folder !== undefined) e.folder = h.folder;
      if (h.relay?.version !== undefined) e.relayVersion = h.relay.version;
      e.lastSeenAt = t;
      prune(t);
      if (visible(e, t) !== before) changed();
    },
    bye(id) {
      const e = entries.get(id);
      if (!e || e.goneAt !== null) return;
      e.goneAt = now();
      changed();
    },
    toolCall(id, tool, clientInfo) {
      const t = now();
      const relay = isClientId(id);
      const e = entry(relay ? id : ANONYMOUS_CLIENT, relay ? "relay" : "http", t);
      // A relay's hello names its client; clients without the relay may name themselves per request.
      if (clientInfo?.name && (!relay || !e.name)) e.name = clientInfo.name;
      if (clientInfo?.title && (!relay || !e.title)) e.title = clientInfo.title;
      if (clientInfo?.version && (!relay || !e.version)) e.version = clientInfo.version;
      e.lastSeenAt = t;
      e.lastActivityAt = t;
      e.lastTool = tool;
      e.toolCalls++;
      prune(t);
      changed();
    },
    get(id) {
      const e = entries.get(id);
      return e ? status(e, now()) : undefined;
    },
    list() {
      const t = now();
      prune(t);
      return [...entries.values()]
        .map((e) => status(e, t))
        .sort((a, b) => Math.max(b.lastActivityAt ?? 0, b.connectedAt) - Math.max(a.lastActivityAt ?? 0, a.connectedAt));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// --- The hello body (POST /clients, behind the desktop's Host/Origin/bearer guard) ---------------

const clean = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text ? text.slice(0, max) : undefined;
};

const isAbsoluteFolder = (folder: string) => folder.startsWith("/") || /^[A-Za-z]:[\\/]/.test(folder) || folder.startsWith("\\\\");

/** Validate a hello body. Returns the hello, or a teaching message when it's unusable. */
export function parseHello(value: unknown): McpClientHello | string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return 'Send a JSON object like {"id":"<uuid>","name":"claude-code","folder":"/absolute/path"}.';
  const v = value as Record<string, unknown>;
  if (!isClientId(v.id)) return '"id" must be 8 to 64 letters, digits or dashes; the relay sends a UUID, the same one as its sonobe-client header.';
  const hello: McpClientHello = { id: v.id };
  for (const key of ["name", "title", "version"] as const) {
    if (v[key] === undefined) continue;
    const text = clean(v[key], 120);
    if (text === undefined) return `"${key}" must be a non-empty string when present.`;
    hello[key] = text;
  }
  if (v.folder !== undefined) {
    const folder = typeof v.folder === "string" ? v.folder.trim() : "";
    if (!folder || /[\u0000-\u001f\u007f]/.test(folder) || folder.length > 1024 || !isAbsoluteFolder(folder))
      return '"folder" must be an absolute path of at most 1024 characters, like "/Users/me/project". Leave it out when the session has no folder.';
    hello.folder = folder;
  }
  if (v.relay !== undefined) {
    if (!v.relay || typeof v.relay !== "object") return '"relay" must be an object like {"version":"0.1.0"}.';
    const version = clean((v.relay as Record<string, unknown>).version, 40);
    hello.relay = version ? { version } : {};
  }
  return hello;
}
