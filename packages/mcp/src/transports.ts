/**
 * Transports: a Node (req, res) handler for Streamable HTTP (mounts on the desktop app's
 * startMcpServer via setHandler, which already checks Host, Origin and the bearer token) and a
 * stdio entry. Both serve 2026-07-28 clients and 2025-era clients from one server factory. Node only.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMcpHandler,
  type McpHttpHandler,
  type Transport,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { SonobeHost } from "./host.ts";
import { createSonobeMcpServer, type SonobeMcpServerOptions } from "./server.ts";

export interface TransportOptions extends SonobeMcpServerOptions {
  /** Out-of-band transport errors (reporting only). */
  onError?: (error: Error) => void;
}

/** A Node request handler with a close() for shutdown. */
export type NodeMcpHandler = ((req: IncomingMessage, res: ServerResponse) => Promise<void>) & {
  close(): Promise<void>;
  /** Publishes list-changed and resource-updated events to subscribed 2026-era clients. */
  readonly notify: McpHttpHandler["notify"];
};

/**
 * Streamable HTTP handler: one fresh MCP server per request over the shared host. Performs no
 * Host/Origin/auth checks of its own; mount it behind a guard (the desktop startMcpServer).
 */
export function createHttpHandler(host: SonobeHost, options: TransportOptions): NodeMcpHandler {
  const handler = createMcpHandler(() => createSonobeMcpServer(host, options), {
    ...(options.onError ? { onerror: options.onError } : {}),
  });
  const node = toNodeHandler(handler, { ...(options.onError ? { onerror: options.onError } : {}) });
  const fn = (req: IncomingMessage, res: ServerResponse) => node(req, res);
  return Object.assign(fn, { close: () => handler.close(), notify: handler.notify });
}

export interface StdioOptions extends TransportOptions {
  /** Bring your own transport (tests); default: the process's stdin/stdout. */
  transport?: Transport;
}

export interface StdioHandle {
  close(): Promise<void>;
}

/** Serve MCP over stdio. Log to stderr only; stdout carries protocol messages. */
export function serveStdioHost(host: SonobeHost, options: StdioOptions): StdioHandle {
  return serveStdio(() => createSonobeMcpServer(host, options), {
    ...(options.transport ? { transport: options.transport } : {}),
    ...(options.onError ? { onerror: options.onError } : {}),
  });
}
