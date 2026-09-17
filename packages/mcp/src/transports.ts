/**
 * Transports: a Node (req, res) handler for Streamable HTTP (mounts on the desktop app's
 * startMcpServer via setHandler, which already checks Host, Origin and the bearer token) and a
 * stdio entry. Both serve 2026-07-28 clients and 2025-era clients from one server factory, and
 * publish resource notifications when documents change. Node only.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMcpHandler,
  type McpHttpHandler,
  type McpServer,
  type Transport,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { DocumentChange, SonobeHost } from "./host.ts";
import {
  createSonobeMcpServer,
  subscribedResources,
  type SonobeMcpServerOptions,
} from "./server.ts";

export interface TransportOptions extends SonobeMcpServerOptions {
  /** Out-of-band transport errors (reporting only). */
  onError?: (error: Error) => void;
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
 */
export function createHttpHandler(host: SonobeHost, options: TransportOptions): NodeMcpHandler {
  const handler = createMcpHandler(
    (ctx) => createSonobeMcpServer(host, options, { era: ctx.era }),
    { ...(options.onError ? { onerror: options.onError } : {}) },
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
  const fn = (req: IncomingMessage, res: ServerResponse) => node(req, res);
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
