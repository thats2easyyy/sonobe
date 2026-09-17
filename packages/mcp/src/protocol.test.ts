import { createServer, request, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOL_NAMES } from "./server.ts";
import { modernMeta, rawSession, tempProject, type TempProject } from "./test-helpers.ts";
import { createHttpHandler, type NodeMcpHandler } from "./transports.ts";

let project: TempProject;

beforeAll(async () => {
  project = await tempProject({ template: "photo-zoom" });
});

afterAll(async () => {
  await project.cleanup();
});

describe("stdio protocol negotiation", () => {
  for (const version of ["2025-06-18", "2025-11-25"]) {
    it(`serves a ${version} client`, async () => {
      const s = await rawSession(project.host);
      const init = await s.request("initialize", {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: "claude-ai", version: "2.110.0" },
      });
      expect(init.result).toMatchObject({
        protocolVersion: version,
        serverInfo: { name: "sonobe", version: "0.1.0-test" },
        capabilities: { tools: {}, resources: {}, prompts: {} },
      });
      expect((init.result as { instructions: string }).instructions).toContain("start-here");
      await s.notify("notifications/initialized");
      const list = await s.request("tools/list", {});
      expect((list.result as { tools: unknown[] }).tools).toHaveLength(TOOL_NAMES.length);
      const call = await s.request("tools/call", {
        name: "get_outline",
        arguments: { detail: "compact" },
      });
      expect((call.result as { content: { text: string }[] }).content[0]!.text).toContain(
        "patch zoomed switch",
      );
      await s.close();
    });
  }

  it("serves a 2026-07-28 client with per-request envelopes", async () => {
    const s = await rawSession(project.host);
    const discover = await s.request("server/discover", { _meta: modernMeta() });
    expect(discover.result).toMatchObject({
      supportedVersions: expect.arrayContaining(["2026-07-28"]),
      capabilities: { tools: {} },
      resultType: "complete",
    });
    expect((discover.result as { instructions: string }).instructions).toContain(
      "get_document_info",
    );
    const call = await s.request("tools/call", {
      name: "add_layers",
      arguments: { layers: [{ type: "oval", name: "Badge" }] },
      _meta: modernMeta("claude-code"),
    });
    expect(call.result).toMatchObject({
      resultType: "complete",
      structuredContent: { ok: true, created: ["badge"] },
    });
    const history = await s.request("tools/call", {
      name: "list_history",
      arguments: {},
      _meta: modernMeta(),
    });
    expect((history.result as { content: { text: string }[] }).content[0]!.text).toContain(
      "Claude: added 1 layer",
    );
    const undo = await s.request("tools/call", {
      name: "undo",
      arguments: {},
      _meta: modernMeta(),
    });
    expect((undo.result as { isError?: boolean }).isError).toBeUndefined();
    await s.close();
  });

  it("rejects unsupported modern revisions clearly", async () => {
    const s = await rawSession(project.host);
    const r = await s.request("server/discover", {
      _meta: { ...modernMeta(), "io.modelcontextprotocol/protocolVersion": "2099-01-01" },
    });
    expect(r.error).toBeDefined();
    await s.close();
  });
});

async function listen(handler: NodeMcpHandler): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  return { server, url: `http://127.0.0.1:${port}/mcp` };
}

async function readJsonOrSse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    return JSON.parse(data.at(-1)!) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe("Streamable HTTP", () => {
  let handler: NodeMcpHandler;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    handler = createHttpHandler(project.host, { version: "0.1.0-test" });
    ({ server, url } = await listen(handler));
  });

  afterAll(async () => {
    await handler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves the v1 SDK client (2025-11-25)", async () => {
    const client = new Client({ name: "claude-code", version: "2.1.273" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    expect(client.getServerVersion()).toMatchObject({ name: "sonobe" });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOL_NAMES.length);
    const info = await client.callTool({ name: "get_document_info", arguments: {} });
    expect(info.structuredContent).toMatchObject({ docId: "test" });
    await client.close();
  });

  it("serves a raw 2025-06-18 initialize", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "old", version: "1" },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect((await readJsonOrSse(res)).result).toMatchObject({ protocolVersion: "2025-06-18" });
  });

  it("serves 2026-07-28 requests with standard headers", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "get_guide",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "get_guide", arguments: { topic: "simulation" }, _meta: modernMeta() },
      }),
    });
    expect(res.status).toBe(200);
    const body = await readJsonOrSse(res);
    expect(body.result).toMatchObject({
      resultType: "complete",
      structuredContent: { topic: "simulation" },
    });
  });

  it("mounts on the desktop app's startMcpServer via setHandler", async () => {
    let startMcpServer: typeof import("../../../apps/desktop/electron/mcp-server.ts").startMcpServer;
    try {
      ({ startMcpServer } = await import("../../../apps/desktop/electron/mcp-server.ts"));
    } catch (err) {
      console.warn(
        `Skipping desktop compatibility check: couldn't import startMcpServer (${err instanceof Error ? err.message : String(err)}).`,
      );
      return;
    }
    const home = await mkdtemp(path.join(tmpdir(), "sonobe-mcp-home-"));
    const desktop = await startMcpServer({ version: "9.9.9", configDir: home, port: 0 });
    const mounted = createHttpHandler(project.host, { version: "9.9.9" });
    desktop.setHandler(mounted);
    try {
      const client = new Client({ name: "claude-code", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(desktop.url), {
          requestInit: { headers: { authorization: `Bearer ${desktop.token}` } },
        }),
      );
      const r = await client.callTool({ name: "get_outline", arguments: { detail: "compact" } });
      expect(JSON.stringify(r.content)).toContain("patch tap_photo interaction");
      await client.close();
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port: desktop.port,
            method: "POST",
            path: "/mcp",
            headers: { host: `127.0.0.1:${desktop.port}`, "content-type": "application/json" },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end("{}");
      });
      expect(status).toBe(401);
    } finally {
      await mounted.close();
      await desktop.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
