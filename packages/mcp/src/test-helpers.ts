/** Shared test helpers: temp projects, in-process MCP clients, and raw JSON-RPC sessions. Node only; not exported from the package. */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { EngineRegistry } from "@sonobe/engine";
import { createHeadlessHost, type HeadlessHost } from "./headless.ts";
import { serveStdioHost, type StdioOptions } from "./transports.ts";

export interface TempProject {
  dir: string;
  project: string;
  host: HeadlessHost;
  cleanup(): Promise<void>;
}

/** A HeadlessHost with a fresh project folder (blank unless a template is given). */
export async function tempProject(
  options: { template?: string; autosave?: boolean; registry?: EngineRegistry; name?: string } = {},
): Promise<TempProject> {
  const dir = await mkdtemp(path.join(tmpdir(), "sonobe-mcp-test-"));
  const project = path.join(dir, `${options.name ?? "Test"}.sonobe`);
  const host = createHeadlessHost({
    ...(options.autosave !== undefined ? { autosave: options.autosave } : {}),
    ...(options.registry ? { registry: options.registry } : {}),
  });
  await host.createDocument({
    path: project,
    ...(options.template ? { template: options.template } : {}),
  });
  return {
    dir,
    project,
    host,
    async cleanup() {
      await host.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface CallResult {
  text: string;
  structured: Record<string, unknown>;
  isError: boolean;
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
}

export interface TestClient {
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<CallResult>;
  close(): Promise<void>;
}

/** A v1 SDK client (2025-11-25) connected to createSonobeMcpServer over an in-memory stdio pair. */
export async function connectClient(
  host: HeadlessHost,
  clientName = "claude-code",
  server: Omit<StdioOptions, "version" | "transport"> = {},
): Promise<TestClient> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const handle = serveStdioHost(host, { version: "0.1.0-test", transport: serverSide, ...server });
  const client = new Client({ name: clientName, version: "1.0.0" });
  await client.connect(clientSide as never);
  return {
    client,
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const content = (r.content ?? []) as CallResult["content"];
      return {
        text: content.map((c) => c.text ?? "").join("\n"),
        structured: (r.structuredContent ?? {}) as Record<string, unknown>,
        isError: r.isError === true,
        content,
      };
    },
    async close() {
      await client.close();
      await handle.close();
    },
  };
}

export interface RawSession {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

/** Raw JSON-RPC over an in-memory stdio pair, for protocol-level tests. */
export async function rawSession(host: HeadlessHost): Promise<RawSession> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number | string, (m: Record<string, unknown>) => void>();
  clientSide.onmessage = (message) => {
    const m = message as Record<string, unknown>;
    const id = m.id as number | string | undefined;
    if (id !== undefined && waiting.has(id)) {
      waiting.get(id)!(m);
      waiting.delete(id);
    }
  };
  await clientSide.start();
  const handle = serveStdioHost(host, { version: "0.1.0-test", transport: serverSide });
  let next = 1;
  return {
    request(method, params) {
      const id = next++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No answer to ${method}`)), 10_000);
        waiting.set(id, (m) => {
          clearTimeout(timer);
          resolve(m);
        });
        void clientSide.send({
          jsonrpc: "2.0",
          id,
          method,
          ...(params ? { params } : {}),
        } as never);
      });
    },
    async notify(method, params) {
      await clientSide.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) } as never);
    },
    async close() {
      await handle.close();
    },
  };
}

/** The per-request envelope a 2026-07-28 client sends. */
export function modernMeta(clientName = "claude-code"): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: clientName, version: "2.1.273" },
  };
}

/** The tap-to-grow card built through the MCP tools (ISAT with real patch types). */
export async function buildGrowCard(client: TestClient): Promise<void> {
  const layers = await client.call("add_layers", {
    layers: [
      {
        type: "rectangle",
        name: "Card",
        props: { position: [22, 300], size: [358, 220], cornerRadius: 24, color: "#FFFFFFFF" },
      },
    ],
  });
  if (layers.isError) throw new Error(layers.text);
  const patches = await client.call("add_patches", {
    patches: [
      { ref: "tap", type: "interaction", name: "Tap Card", inputs: { layer: { layer: "card" } } },
      { ref: "grown", type: "switch", name: "Card Grown", inputs: { flip: { link: "$tap.tap" } } },
      {
        ref: "spring",
        type: "popAnimation",
        name: "Grow Spring",
        inputs: { number: { link: "$grown.on" }, bounciness: 5, speed: 12 },
      },
      {
        ref: "scale",
        type: "transition",
        name: "Card Scale",
        inputs: { progress: { link: "$spring.output" }, start: 1, end: 1.08 },
      },
    ],
    connections: [{ from: "$scale.output", to: "@card.scale" }],
    label: "tap to grow the card",
  });
  if (patches.isError) throw new Error(patches.text);
}
