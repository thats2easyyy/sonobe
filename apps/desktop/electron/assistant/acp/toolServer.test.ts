/**
 * The subscription engine's per-chat MCP endpoint over real HTTP: a 2026-era client
 * (@modelcontextprotocol/client) and a 2025-era one (@modelcontextprotocol/sdk, the protocol Claude
 * Code speaks) list the chat's tools and call them, with Claude Code's tool_use id in _meta.
 */

import { request as httpRequest } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IMPORT_META_KEY } from "@sonobe/mcp";
import type { AssistantToolInfo, ToolCallResult } from "../toolBridge.ts";
import { startAssistantToolServer, TOOL_USE_ID_META, type AssistantToolServer, type ToolServerCallOptions, type ToolServerHandler } from "./toolServer.ts";

const TOOLS: AssistantToolInfo[] = [
  { name: "get_outline", title: "Get outline", description: "Outline of the document.", inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { detail: { type: "string", enum: ["compact", "styles"] } } }, readOnly: true },
  { name: "import_design", title: "Import design", description: "Import a design.", inputSchema: { type: "object", properties: { html: { type: "string" }, preview: { type: "boolean" } } }, readOnly: false },
  { name: "read_code_file", title: "read_code_file", description: "Read a file from the linked code folder.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, readOnly: true },
];

interface Seen {
  name: string;
  args: Record<string, unknown>;
  toolUseId: string | null;
  signal: AbortSignal;
}

/** A chat's handler that records its calls and answers from `answer`. */
function chat(answer: (name: string, args: Record<string, unknown>, options: ToolServerCallOptions) => ToolCallResult | Promise<ToolCallResult> = () => ({ content: [{ type: "text", text: "ok" }] })) {
  const calls: Seen[] = [];
  const handler: ToolServerHandler = {
    tools: async () => TOOLS,
    call: async (name, args, options) => {
      calls.push({ name, args, toolUseId: options.toolUseId, signal: options.signal });
      return answer(name, args, options);
    },
  };
  return { handler, calls };
}

let server: AssistantToolServer;
const cleanups: (() => Promise<unknown>)[] = [];

beforeEach(async () => {
  server = await startAssistantToolServer({ version: "0.1.0-test" });
});

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn().catch(() => undefined);
  await server.close();
});

async function connect(endpoint: { url: string; token: string }): Promise<Client> {
  const client = new Client({ name: "claude-code", version: "2.1.274" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } } }));
  cleanups.push(() => client.close());
  return client;
}

async function connectLegacy(endpoint: { url: string; token: string }): Promise<LegacyClient> {
  const client = new LegacyClient({ name: "claude-code", version: "2.1.274" });
  await client.connect(new LegacyTransport(new URL(endpoint.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.token}` } } }));
  cleanups.push(() => client.close());
  return client;
}

/** A raw POST, with headers fetch won't let us set (Host). */
function post(url: string, headers: Record<string, string>, body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", reject);
    // The server may answer (413) and close before the whole body is written.
    req.on("socket", (socket) => socket.on("error", () => undefined));
    req.end(body);
  });
}

const waitFor = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5));
  return check();
};

describe("the Assistant's tool endpoint", () => {
  it("lists the chat's tools with their JSON Schema as it is, titles first, and read-only hints", async () => {
    const endpoint = server.register("7", chat().handler);
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/c\/[A-Za-z0-9_-]{24}\/mcp$/);
    expect(Buffer.from(endpoint.token, "base64url")).toHaveLength(32);
    const { tools } = await (await connect(endpoint)).listTools();
    expect(tools.map((t) => t.name)).toEqual(["get_outline", "import_design", "read_code_file"]);
    expect(tools[0]).toMatchObject({ title: "Get outline", description: "Get outline. Outline of the document.", inputSchema: TOOLS[0]!.inputSchema, annotations: { readOnlyHint: true } });
    expect(tools[1]!.annotations).toMatchObject({ readOnlyHint: false });
    // A tool whose title is its name isn't described twice.
    expect(tools[2]!.description).toBe("Read a file from the linked code folder.");
  });

  it("hands each call to the chat's handler with Claude Code's tool_use id, and returns its result", async () => {
    const importResult: ToolCallResult = {
      content: [{ type: "text", text: "Imported “Checkout”" }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
      meta: { [IMPORT_META_KEY]: { docId: "noddit", screenId: "checkout" } },
    };
    const { handler, calls } = chat((name) => (name === "import_design" ? importResult : { content: [{ type: "text", text: "Error not_found: no such layer" }], structuredContent: { ok: false }, isError: true }));
    const client = await connect(server.register("7", handler));
    const imported = await client.callTool({ name: "import_design", arguments: { preview: true }, _meta: { [TOOL_USE_ID_META]: "toolu_01" } });
    expect(imported).toMatchObject({ content: [{ type: "text", text: "Imported “Checkout”" }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }], _meta: { [IMPORT_META_KEY]: { docId: "noddit", screenId: "checkout" } } });
    expect(imported.isError).toBeFalsy();
    const failed = await client.callTool({ name: "get_outline", arguments: {} });
    expect(failed).toMatchObject({ isError: true, content: [{ type: "text", text: "Error not_found: no such layer" }], structuredContent: { ok: false } });
    expect(calls.map(({ name, args, toolUseId }) => ({ name, args, toolUseId }))).toEqual([
      { name: "import_design", args: { preview: true }, toolUseId: "toolu_01" },
      { name: "get_outline", args: {}, toolUseId: null },
    ]);
  });

  it("serves Claude Code's 2025-era protocol too, tool_use id included", async () => {
    const { handler, calls } = chat(() => ({ content: [{ type: "text", text: "component main" }] }));
    const client = await connectLegacy(server.register("7", handler));
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["get_outline", "import_design", "read_code_file"]);
    const result = await client.callTool({ name: "get_outline", arguments: { detail: "compact" }, _meta: { [TOOL_USE_ID_META]: "toolu_02" } });
    expect(result.content).toEqual([{ type: "text", text: "component main" }]);
    expect(calls.map((c) => [c.args, c.toolUseId])).toEqual([[{ detail: "compact" }, "toolu_02"]]);
  });

  it("sends no MCP instructions: the tool guide is in the session's system prompt, and Claude Code would add them to the first message too", async () => {
    const client = await connectLegacy(server.register("7", chat().handler));
    expect(client.getServerVersion()).toMatchObject({ name: "sonobe", version: "0.1.0-test" });
    expect(client.getInstructions()).toBeUndefined();
  });

  it("forwards the handler's progress to the call's progress token", async () => {
    const { handler } = chat(async (_name, _args, options) => {
      options.onProgress("Rendering the HTML");
      options.onProgress("Waiting for your answer in Sonobe");
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { content: [{ type: "text", text: "Imported" }] };
    });
    const endpoint = server.register("7", handler);
    const modern: string[] = [];
    await (await connect(endpoint)).callTool({ name: "import_design", arguments: {} }, { onprogress: (p) => void modern.push(p.message ?? "") });
    const legacy: string[] = [];
    await (await connectLegacy(endpoint)).callTool({ name: "import_design", arguments: {} }, undefined, { onprogress: (p) => void legacy.push(p.message ?? "") });
    expect([modern, legacy]).toEqual([
      ["Rendering the HTML", "Waiting for your answer in Sonobe"],
      ["Rendering the HTML", "Waiting for your answer in Sonobe"],
    ]);
  });

  it("cancels a call when its client cancels it, over either protocol", async () => {
    const { handler, calls } = chat((_name, _args, options) => new Promise((resolve) => options.signal.addEventListener("abort", () => resolve({ content: [{ type: "text", text: "Stopped" }], isError: true }))));
    const endpoint = server.register("7", handler);
    const modern = await connect(endpoint);
    const legacy = await connectLegacy(endpoint);
    const calling = [
      (signal: AbortSignal) => modern.callTool({ name: "import_design", arguments: {} }, { signal }),
      (signal: AbortSignal) => legacy.callTool({ name: "import_design", arguments: {} }, undefined, { signal }),
    ];
    for (const [index, callTool] of calling.entries()) {
      const controller = new AbortController();
      const call = callTool(controller.signal);
      expect(await waitFor(() => calls.length === index + 1)).toBe(true);
      controller.abort();
      await expect(call).rejects.toThrow();
      expect(await waitFor(() => calls[index]!.signal.aborted)).toBe(true);
    }
  });

  it("refuses a bad token, an unknown or revoked chat, and a foreign Host or Origin", async () => {
    const endpoint = server.register("7", chat().handler);
    const port = new URL(endpoint.url).port;
    const bearer = { authorization: `Bearer ${endpoint.token}` };
    expect((await post(endpoint.url, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await post(endpoint.url, {})).status).toBe(401);
    expect((await post(endpoint.url, { ...bearer, host: `evil.example:${port}` })).status).toBe(403);
    expect((await post(endpoint.url, { ...bearer, origin: "https://evil.example" })).status).toBe(403);
    expect((await post(`http://127.0.0.1:${port}/c/${"x".repeat(24)}/mcp`, bearer)).status).toBe(404);
    expect((await post(`http://127.0.0.1:${port}/mcp`, bearer)).status).toBe(404);
    const unauthorized = await post(endpoint.url, { authorization: "Bearer nope" });
    expect(JSON.parse(unauthorized.body)).toMatchObject({ jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" } });

    // Another chat's token doesn't open this one.
    const other = server.register("8", chat().handler);
    expect((await post(endpoint.url, { authorization: `Bearer ${other.token}` })).status).toBe(401);

    // New chat: the old URL and token stop working, and the new ones do.
    const fresh = server.register("7", chat().handler);
    expect(fresh.url).not.toBe(endpoint.url);
    expect((await post(endpoint.url, bearer)).status).toBe(404);
    expect((await (await connect(fresh)).listTools()).tools).toHaveLength(3);
    server.unregister("7");
    expect((await post(fresh.url, { authorization: `Bearer ${fresh.token}` })).status).toBe(404);
  });

  it("refuses a body over 8 MiB", async () => {
    const endpoint = server.register("7", chat().handler);
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "import_design", arguments: { html: "x".repeat(8 * 1024 * 1024 + 1) } } });
    expect((await post(endpoint.url, { authorization: `Bearer ${endpoint.token}` }, big)).status).toBe(413);
    // Also when it doesn't say how long it is.
    expect((await post(endpoint.url, { authorization: `Bearer ${endpoint.token}`, "transfer-encoding": "chunked" }, big)).status).toBe(413);
  });
});
