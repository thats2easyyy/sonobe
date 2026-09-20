/**
 * Sonobe's tools for the subscription engine's Claude: a loopback MCP endpoint in the main process,
 * one URL and one 256-bit bearer token per window's chat (POST /c/<key>/mcp), which Claude's agent
 * adapter gets in session/new. It lists the Assistant's tools (the in-process bridge's, preview_design
 * included, then the code folder's) and sends every call to the chat's handler, which runs it through
 * the shared tool runner (../toolRunner.ts) with that chat's current reply.
 *
 * Like the app's own MCP endpoint (../../mcp-server.ts): 127.0.0.1 on a random port, Host and Origin
 * checked, the token compared in constant time. Like its HTTP transport (@sonobe/mcp transports.ts):
 * a fresh server per request, bodies parsed here, and a call cancelled when its response closes
 * before it finished, or (2025-era clients, like Claude Code) by a notifications/cancelled naming it,
 * which arrives on a POST of its own. Stop in Sonobe cancels the chat's calls itself, through its
 * handler.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, isJsonContentType, Server, type CallToolResult, type Tool } from "@modelcontextprotocol/server";
import { bearerMatches, isAllowedHost, isAllowedOrigin } from "../../mcp-server.ts";
import { toolResultContent, type AssistantToolInfo, type ToolCallResult } from "../toolBridge.ts";

/** The key Claude Code puts in a tools/call's _meta: the tool_use id, which is also the ACP toolCallId. */
export const TOOL_USE_ID_META = "claudecode/toolUseId";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface ToolServerCallOptions {
  /** The call's tool_use id from its _meta, or null when the client didn't send one. */
  toolUseId: string | null;
  /** Aborts when the client cancels the call or its request closes. */
  signal: AbortSignal;
  /** Sent to the client as notifications/progress when it asked for progress. */
  onProgress(message: string): void;
}

/** One chat's side of the endpoint. */
export interface ToolServerHandler {
  tools(): Promise<readonly AssistantToolInfo[]>;
  call(name: string, args: Record<string, unknown>, options: ToolServerCallOptions): Promise<ToolCallResult>;
}

export interface AssistantToolServer {
  /** A fresh URL and token for the chat (any earlier ones stop working). */
  register(conversationId: string, handler: ToolServerHandler): { url: string; token: string };
  /** Revoke the chat's URL and token. */
  unregister(conversationId: string): void;
  close(): Promise<void>;
}

export interface AssistantToolServerOptions {
  /** Sonobe's version, for serverInfo. */
  version?: string;
  log?(level: "info" | "warn" | "error", message: string): void;
  /** SSE keep-alive interval. Default 10 s. */
  keepAliveMs?: number;
}

interface Endpoint {
  key: string;
  conversationId: string;
  token: string;
  handler: ToolServerHandler;
  /** Calls in flight by JSON-RPC id (one client per chat, so an id names one call). */
  inflight: Map<string, Set<AbortController>>;
}

interface RequestScope {
  endpoint: Endpoint;
  /** Aborts when the response closes before it finished. */
  signal: AbortSignal;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A tool as MCP lists it: its JSON Schema input as it is, its title leading its description (as toAnthropicTools does). */
export function listedTool(info: AssistantToolInfo): Tool {
  const description = info.title && info.title !== info.name ? `${info.title}. ${info.description}` : info.description;
  return {
    name: info.name,
    ...(info.title ? { title: info.title } : {}),
    description,
    inputSchema: { ...info.inputSchema, type: "object" } as Tool["inputSchema"],
    annotations: { ...(info.title ? { title: info.title } : {}), readOnlyHint: info.readOnly },
  };
}

/** A tool result as MCP returns it: the same text (cut the same way) and screenshots as the API path's tool_result, plus structuredContent and _meta. */
export function callToolResult(result: ToolCallResult): CallToolResult {
  const content = toolResultContent(result).map((block) => (block.type === "text" ? { type: "text" as const, text: block.text } : { type: "image" as const, data: (block.source as { data: string }).data, mimeType: (block.source as { media_type: string }).media_type }));
  return {
    content,
    ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    ...(result.isError ? { isError: true } : {}),
    ...(result.meta ? { _meta: result.meta } : {}),
  };
}

function sendError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const payload = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } });
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(payload)), "Cache-Control": "no-store", ...headers });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; status: number; code: number; message: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413, code: -32000, message: "Request body too large" };
    chunks.push(buf);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return { ok: false, status: 400, code: -32700, message: "Parse error: Invalid JSON" };
  }
}

export async function startAssistantToolServer(options: AssistantToolServerOptions = {}): Promise<AssistantToolServer> {
  const log = options.log ?? (() => undefined);
  const byKey = new Map<string, Endpoint>();
  const byConversation = new Map<string, Endpoint>();
  const requests = new AsyncLocalStorage<RequestScope>();
  let port = 0;

  /** One server per request, for the chat whose URL it came to. */
  const serverFor = (scope: RequestScope, era: "legacy" | "modern"): Server => {
    const { endpoint } = scope;
    const server = new Server({ name: "sonobe", title: "Sonobe", version: options.version ?? "0.0.0" }, { capabilities: { tools: {} } });
    if (era === "legacy") {
      server.setNotificationHandler("notifications/cancelled", (notification) => {
        const id = notification.params.requestId;
        const calls = id === undefined ? undefined : endpoint.inflight.get(JSON.stringify(id));
        if (calls?.size !== 1) return;
        for (const call of calls) call.abort(new Error(notification.params.reason ?? "The client cancelled the call."));
      });
    }
    server.setRequestHandler("tools/list", async () => ({ tools: (await endpoint.handler.tools()).map(listedTool) }));
    server.setRequestHandler("tools/call", async (request, ctx) => {
      const { name } = request.params;
      const args = request.params.arguments ?? {};
      const meta = (ctx.mcpReq._meta ?? request.params._meta ?? {}) as Record<string, unknown>;
      const toolUseId = typeof meta[TOOL_USE_ID_META] === "string" ? (meta[TOOL_USE_ID_META] as string) : null;
      const routed = new AbortController();
      const id = JSON.stringify(ctx.mcpReq.id);
      const calls = endpoint.inflight.get(id) ?? new Set<AbortController>();
      calls.add(routed);
      endpoint.inflight.set(id, calls);
      const signal = AbortSignal.any([ctx.mcpReq.signal, scope.signal, routed.signal]);
      const progressToken = ctx.mcpReq._meta?.progressToken;
      let progress = 0;
      const onProgress = (message: string) => {
        if (progressToken === undefined || signal.aborted) return;
        void ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken, progress: ++progress, message } }).catch(() => undefined);
      };
      let result: ToolCallResult;
      try {
        result = await endpoint.handler.call(name, args, { toolUseId, signal, onProgress });
      } catch (err) {
        log("warn", `Assistant tool ${name} failed: ${errorMessage(err)}`);
        result = { content: [{ type: "text", text: `The ${name} tool failed: ${errorMessage(err)}` }], isError: true };
      } finally {
        calls.delete(routed);
        if (!calls.size && endpoint.inflight.get(id) === calls) endpoint.inflight.delete(id);
      }
      return server.projectCallToolResult(callToolResult(result), undefined);
    });
    return server;
  };

  const handler = createMcpHandler(
    (ctx) => {
      const scope = requests.getStore();
      if (!scope) throw new Error("No chat for this request");
      return serverFor(scope, ctx.era);
    },
    { onerror: (err) => log("warn", `Assistant tool endpoint: ${err.message}`), responseMode: "sse", keepAliveMs: options.keepAliveMs ?? 10_000 },
  );
  const node = toNodeHandler(handler, { onerror: (err) => log("warn", `Assistant tool endpoint: ${err.message}`) });

  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isAllowedHost(req.headers.host, port)) return sendError(res, 403, -32000, "Forbidden: invalid Host header");
    if (!isAllowedOrigin(req.headers.origin)) return sendError(res, 403, -32000, "Forbidden: invalid Origin header");
    const match = /^\/c\/([A-Za-z0-9_-]{16,64})\/mcp$/.exec((req.url ?? "/").split("?")[0]!);
    const endpoint = match ? byKey.get(match[1]!) : undefined;
    if (!endpoint) return sendError(res, 404, -32000, "Not found: this chat's tools are gone. Start a new message in Sonobe.");
    if (!bearerMatches(req.headers.authorization, endpoint.token)) return sendError(res, 401, -32000, "Unauthorized", { "WWW-Authenticate": 'Bearer realm="sonobe-assistant"' });
    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return sendError(res, 413, -32000, "Request body too large");

    // Held by the listener's closure for as long as the response lives, so no GC can lose it.
    const connection = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) connection.abort(new Error("The MCP client disconnected."));
    });
    const scope: RequestScope = { endpoint, signal: connection.signal };
    if (req.method?.toUpperCase() !== "POST" || !isJsonContentType(req.headers["content-type"])) return requests.run(scope, () => node(req, res));
    const body = await readJsonBody(req);
    if (!body.ok) return sendError(res, body.status, body.code, body.message);
    return requests.run(scope, () => node(req, res, body.value));
  };

  const http = createServer((req, res) => {
    serve(req, res).catch((err: unknown) => {
      log("error", `Assistant tool endpoint failed: ${errorMessage(err)}`);
      sendError(res, 500, -32603, "Internal error");
    });
  });
  http.headersTimeout = 30_000;
  // Calls wait on the person (a confirmation) and stream progress, so there's no request timeout.
  http.requestTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen({ port: 0, host: "127.0.0.1", exclusive: true }, () => {
      http.off("error", reject);
      resolve();
    });
  });
  port = (http.address() as AddressInfo).port;
  http.on("error", (err) => log("error", `Assistant tool endpoint error: ${err.message}`));

  const unregister = (conversationId: string) => {
    const endpoint = byConversation.get(conversationId);
    if (!endpoint) return;
    byConversation.delete(conversationId);
    byKey.delete(endpoint.key);
  };

  return {
    register(conversationId, toolHandler) {
      unregister(conversationId);
      const endpoint: Endpoint = { key: randomBytes(18).toString("base64url"), conversationId, token: randomBytes(32).toString("base64url"), handler: toolHandler, inflight: new Map() };
      byKey.set(endpoint.key, endpoint);
      byConversation.set(conversationId, endpoint);
      return { url: `http://127.0.0.1:${port}/c/${endpoint.key}/mcp`, token: endpoint.token };
    },
    unregister,
    async close() {
      byKey.clear();
      byConversation.clear();
      await handler.close().catch(() => undefined);
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
