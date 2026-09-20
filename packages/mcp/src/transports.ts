/**
 * Transports: a Node (req, res) handler for Streamable HTTP (mounts on the desktop app's
 * startMcpServer via setHandler, which already checks Host, Origin and the bearer token) and a
 * stdio entry. Both serve 2026-07-28 clients and 2025-era clients from one server factory, and
 * publish resource notifications when documents change. Node only.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMcpHandler,
  isJsonContentType,
  type McpHttpHandler,
  type McpServer,
  type Transport,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { CLIENT_HEADER, isClientId } from "./clients.ts";
import type { DocumentChange, SonobeHost } from "./host.ts";
import type { CallScope } from "./progress.ts";
import {
  createSonobeMcpServer,
  subscribedResources,
  type SonobeMcpServerOptions,
} from "./server.ts";

export interface TransportOptions extends SonobeMcpServerOptions {
  /** Out-of-band transport errors (reporting only). */
  onError?: (error: Error) => void;
  /**
   * HTTP: SSE keep-alive interval (default 10 s). Every response streams from its first byte, so a
   * silent long call still gets its headers at once and a comment frame every interval.
   */
  keepAliveMs?: number;
}

/** Largest POST body createHttpHandler reads (the desktop guard rejects larger declared lengths first). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** The current HTTP request's call scope (see CallScope), set around each request. */
const httpCalls = new AsyncLocalStorage<CallScope>();

type BodyRead = { ok: true; value: unknown } | { ok: false; status: number; message: string };

async function readJsonBody(req: IncomingMessage): Promise<BodyRead> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413, message: "Request body too large" };
    chunks.push(buf);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return { ok: false, status: 400, message: "Parse error: Invalid JSON" };
  }
}

/** The publish side of resource notifications (the SDK handler's `notify` has this shape). */
export interface ResourceNotifier {
  resourcesChanged(): void;
  resourceUpdated(uri: string): void;
}

/** The resources that change with a document's revision. */
export function documentResourceUris(docId: string): string[] {
  return [`sonobe://documents/${docId}/outline`, `sonobe://documents/${docId}/diagnostics`];
}

/** Publish the resource notifications for one document change. */
export function publishDocumentChange(notifier: ResourceNotifier, change: DocumentChange): void {
  if (change.kind === "revision") {
    for (const uri of documentResourceUris(change.docId)) notifier.resourceUpdated(uri);
    return;
  }
  notifier.resourcesChanged();
}

/** A Node request handler with a close() for shutdown. */
export type NodeMcpHandler = ((req: IncomingMessage, res: ServerResponse) => Promise<void>) & {
  close(): Promise<void>;
  /** Publishes list-changed and resource-updated events to subscribed 2026-era clients. */
  readonly notify: McpHttpHandler["notify"];
  /**
   * Publish the resource notifications for a document change: the hook app hosts call when a
   * document gets a new revision, opens or closes. Hosts that implement onDocumentChange are
   * subscribed automatically, so calling this as well only repeats notifications.
   */
  documentChanged(change: DocumentChange): void;
};

/**
 * Streamable HTTP handler: one fresh MCP server per request over the shared host. Performs no
 * Host/Origin/auth checks of its own; mount it behind a guard (the desktop startMcpServer).
 * 2026-07-28 clients receive resource notifications on subscriptions/listen streams; 2025-era
 * HTTP traffic is stateless, so there's no session to push to.
 *
 * Cancellation (ARCHITECTURE §10, "Long calls"): the SDK's own disconnect abort follows a cloned web
 * Request's signal, which undici stops forwarding once the Request is garbage collected. So POST
 * bodies are parsed here (the SDK then never clones), each request holds its own AbortController
 * that fires when the response closes unfinished, and a 2025-era notifications/cancelled, which
 * arrives on a POST of its own, aborts the call it names when exactly one call in flight from the same
 * sender (the same `sonobe-client` header, or none) has that id.
 *
 * Sessions: the relay's `sonobe-client` header rides the same per-request scope, so with
 * `options.clients` every tool call counts toward that session's row (clients.ts).
 */
export function createHttpHandler(host: SonobeHost, options: TransportOptions): NodeMcpHandler {
  // Keyed by sender and request id: a relay session's calls by its sonobe-client id, the rest together.
  const inflight = new Map<string, Set<AbortController>>();
  const inflightKey = (clientId: string | undefined, requestId: string | number) => JSON.stringify([clientId ?? null, requestId]);
  const track = (id: string, controller: AbortController) => {
    const calls = inflight.get(id) ?? new Set<AbortController>();
    calls.add(controller);
    inflight.set(id, calls);
    return () => {
      calls.delete(controller);
      if (!calls.size && inflight.get(id) === calls) inflight.delete(id);
    };
  };
  const handler = createMcpHandler(
    (ctx) => {
      const legacy = ctx.era !== "modern";
      const server = createSonobeMcpServer(host, options, {
        era: ctx.era,
        // Only 2025-era calls are cancelled by id; 2026-07-28 clients close the stream instead.
        callScope: () => {
          const call = httpCalls.getStore();
          return legacy || !call?.signal ? call : { signal: call.signal, ...(call.clientId ? { clientId: call.clientId } : {}) };
        },
      });
      if (legacy) {
        // Request ids are only unique per client. A cancel reaches only calls from its own sender (the
        // same sonobe-client header, or none); clients without the relay can't be told apart, so an id
        // two of their calls share is ambiguous and the cancel is dropped. Only token holders can send one.
        server.server.setNotificationHandler("notifications/cancelled", (notification) => {
          const id = notification.params.requestId;
          const calls = id === undefined ? undefined : inflight.get(inflightKey(httpCalls.getStore()?.clientId, id));
          if (calls?.size !== 1) return;
          for (const controller of calls) controller.abort(new Error(notification.params.reason ?? "The client cancelled the call."));
        });
      }
      return server;
    },
    {
      ...(options.onError ? { onerror: options.onError } : {}),
      // Stream every modern response from the first byte: a silent call gets its headers at once and a
      // keep-alive every interval, instead of hitting clients' time-to-headers limits.
      responseMode: "sse",
      keepAliveMs: options.keepAliveMs ?? 10_000,
    },
  );
  const node = toNodeHandler(handler, { ...(options.onError ? { onerror: options.onError } : {}) });
  const documentChanged = (change: DocumentChange) => {
    try {
      publishDocumentChange(handler.notify, change);
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };
  const unsubscribe = host.onDocumentChange?.(documentChanged);
  const fn = async (req: IncomingMessage, res: ServerResponse) => {
    // Held by the listener's closure for as long as the response lives, so no GC can lose it.
    const connection = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) connection.abort(new Error("The MCP client disconnected."));
    });
    // The relay names its session on every POST (clients.ts); tool calls record it and name the author.
    const header = req.headers[CLIENT_HEADER];
    const clientId = isClientId(header) ? header : undefined;
    const scope: CallScope = {
      signal: connection.signal,
      track: (requestId, controller) => track(inflightKey(clientId, requestId), controller),
      ...(clientId ? { clientId } : {}),
    };
    if (req.method?.toUpperCase() !== "POST" || !isJsonContentType(req.headers["content-type"])) return httpCalls.run(scope, () => node(req, res));
    const body = await readJsonBody(req);
    if (!body.ok) {
      const payload = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: body.status === 400 ? -32700 : -32000, message: body.message } });
      res.writeHead(body.status, { "content-type": "application/json" }).end(payload);
      return;
    }
    return httpCalls.run(scope, () => node(req, res, body.value));
  };
  return Object.assign(fn, {
    close: async () => {
      unsubscribe?.();
      await handler.close();
    },
    notify: handler.notify,
    documentChanged,
  });
}

export interface StdioOptions extends TransportOptions {
  /** Bring your own transport (tests); default: the process's stdin/stdout. */
  transport?: Transport;
}

export interface StdioHandle {
  close(): Promise<void>;
  /** Publish the resource notifications for a document change (see NodeMcpHandler). */
  documentChanged(change: DocumentChange): void;
}

/** Serve MCP over stdio. Log to stderr only; stdout carries protocol messages. */
export function serveStdioHost(host: SonobeHost, options: StdioOptions): StdioHandle {
  const servers = new Set<{ server: McpServer; era: "legacy" | "modern" }>();
  const handle = serveStdio(
    (ctx) => {
      const server = createSonobeMcpServer(host, options, { era: ctx.era });
      servers.add({ server, era: ctx.era });
      return server;
    },
    {
      ...(options.transport ? { transport: options.transport } : {}),
      ...(options.onError ? { onerror: options.onError } : {}),
    },
  );
  const report = (err: unknown) =>
    options.onError?.(err instanceof Error ? err : new Error(String(err)));
  const connected = () => {
    for (const entry of servers) if (!entry.server.isConnected()) servers.delete(entry);
    return [...servers];
  };
  const documentChanged = (change: DocumentChange) => {
    for (const { server, era } of connected()) {
      // Modern connections: the stdio entry rewrites these onto subscriptions/listen streams
      // and filters by what each stream opted in to. Legacy connections get list_changed
      // unsolicited, and resources/updated only for URIs they subscribed to.
      publishDocumentChange(
        {
          resourcesChanged: () => server.sendResourceListChanged(),
          resourceUpdated: (uri) => {
            if (era === "legacy" && !subscribedResources(server).has(uri)) return;
            server.server.sendResourceUpdated({ uri }).catch(report);
          },
        },
        change,
      );
    }
  };
  const unsubscribe = host.onDocumentChange?.(documentChanged);
  return {
    close: async () => {
      unsubscribe?.();
      servers.clear();
      await handle.close();
    },
    documentChanged,
  };
}
