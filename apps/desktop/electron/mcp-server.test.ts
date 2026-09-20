import { request } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClientRegistry } from "@sonobe/mcp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearerMatches, isAllowedHost, isAllowedOrigin, startMcpServer, type McpConnectionFile, type McpServerHandle } from "./mcp-server.ts";

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(port: number, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path ?? "/health", headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe("request guards", () => {
  it("accepts only loopback hosts on the bound port", () => {
    expect(isAllowedHost("127.0.0.1:4000", 4000)).toBe(true);
    expect(isAllowedHost("localhost:4000", 4000)).toBe(true);
    expect(isAllowedHost("LOCALHOST:4000", 4000)).toBe(true);
    expect(isAllowedHost("[::1]:4000", 4000)).toBe(true);
    expect(isAllowedHost("127.0.0.1:4001", 4000)).toBe(false);
    expect(isAllowedHost("127.0.0.1", 4000)).toBe(false);
    expect(isAllowedHost("evil.example:4000", 4000)).toBe(false);
    expect(isAllowedHost("localhost.evil.example:4000", 4000)).toBe(false);
    expect(isAllowedHost(undefined, 4000)).toBe(false);
  });

  it("accepts absent or loopback origins only", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5199")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin("file://")).toBe(false);
  });

  it("compares bearer tokens exactly", () => {
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    expect(bearerMatches("bearer abc", "abc")).toBe(true);
    expect(bearerMatches("Bearer abcd", "abc")).toBe(false);
    expect(bearerMatches("Basic abc", "abc")).toBe(false);
    expect(bearerMatches(undefined, "abc")).toBe(false);
  });
});

describe("startMcpServer", () => {
  let dir: string;
  let server: McpServerHandle | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sonobe-mcp-"));
  });

  afterEach(async () => {
    await server?.close();
    server = null;
    await rm(dir, { recursive: true, force: true });
  });

  const start = async (extra: Partial<Parameters<typeof startMcpServer>[0]> = {}) => {
    server = await startMcpServer({ version: "9.9.9", configDir: path.join(dir, "home"), port: 0, ...extra });
    return server;
  };

  it("binds loopback, writes a 0600 connection file, and removes it on close", async () => {
    const s = await start();
    expect(s.port).toBeGreaterThan(0);
    expect(s.url).toBe(`http://127.0.0.1:${s.port}/mcp`);
    expect(Buffer.from(s.token, "base64url")).toHaveLength(32);

    const file = JSON.parse(await readFile(s.tokenFile, "utf8")) as McpConnectionFile;
    expect(file).toEqual({ port: s.port, url: s.url, token: s.token, pid: process.pid, version: "9.9.9" });
    if (process.platform !== "win32") {
      expect((await stat(s.tokenFile)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(s.tokenFile))).mode & 0o777).toBe(0o700);
    }

    await s.close();
    server = null;
    expect(existsSync(s.tokenFile)).toBe(false);
  });

  it("serves /health to authenticated callers", async () => {
    const s = await start();
    const ok = await send(s.port, { headers: { authorization: `Bearer ${s.token}` } });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true, version: "9.9.9" });
    expect(ok.headers["access-control-allow-origin"]).toBeUndefined();
    expect(ok.headers["cache-control"]).toBe("no-store");

    const anon = await send(s.port, {});
    expect(anon.status).toBe(401);
    expect(anon.headers["www-authenticate"]).toContain("Bearer");
    expect((await send(s.port, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("rejects DNS-rebinding Hosts and foreign Origins before auth", async () => {
    const s = await start();
    const auth = { authorization: `Bearer ${s.token}` };
    expect((await send(s.port, { headers: { ...auth, host: `evil.example:${s.port}` } })).status).toBe(403);
    expect((await send(s.port, { headers: { ...auth, host: "127.0.0.1:1" } })).status).toBe(403);
    expect((await send(s.port, { headers: { ...auth, origin: "https://evil.example" } })).status).toBe(403);
    expect((await send(s.port, { headers: { ...auth, origin: `http://localhost:${s.port}` } })).status).toBe(200);
    expect((await send(s.port, { headers: { ...auth, host: `localhost:${s.port}` } })).status).toBe(200);
  });

  it("answers /mcp with a 501 JSON-RPC error until tools are wired", async () => {
    const s = await start();
    const res = await send(s.port, {
      method: "POST",
      path: "/mcp",
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/list" }),
    });
    expect(res.status).toBe(501);
    expect(JSON.parse(res.body)).toEqual({ jsonrpc: "2.0", id: 42, error: { code: -32001, message: "MCP tools not yet wired" } });

    const get = await send(s.port, { path: "/mcp", headers: { authorization: `Bearer ${s.token}` } });
    expect(get.status).toBe(501);
    const bad = await send(s.port, { method: "POST", path: "/mcp", headers: { authorization: `Bearer ${s.token}` }, body: "{nope" });
    expect(bad.status).toBe(400);
  });

  it("routes unknown paths and methods", async () => {
    const s = await start();
    const auth = { authorization: `Bearer ${s.token}` };
    expect((await send(s.port, { path: "/elsewhere", headers: auth })).status).toBe(404);
    const put = await send(s.port, { method: "PUT", path: "/mcp", headers: auth });
    expect(put.status).toBe(405);
    expect(put.headers.allow).toBe("GET, POST, DELETE");
  });

  it("takes the relay's hello and goodbye on /clients, behind the token", async () => {
    const clients = createClientRegistry();
    const s = await start({ clients });
    const auth = { authorization: `Bearer ${s.token}`, "content-type": "application/json" };
    const id = "11111111-aaaa-4bbb-8ccc-000000000001";
    const hello = JSON.stringify({ id, name: "claude-code", title: "Claude Code", folder: "/Users/me/placemark" });
    expect((await send(s.port, { method: "POST", path: "/clients", headers: { "content-type": "application/json" }, body: hello })).status).toBe(401);
    expect(clients.list()).toEqual([]);

    expect((await send(s.port, { method: "POST", path: "/clients", headers: auth, body: hello })).status).toBe(204);
    expect(clients.get(id)).toMatchObject({ label: "Claude Code", folder: "/Users/me/placemark", state: "connected" });

    const relative = await send(s.port, { method: "POST", path: "/clients", headers: auth, body: JSON.stringify({ id, folder: "placemark" }) });
    expect(relative.status).toBe(400);
    expect((JSON.parse(relative.body) as { error: { message: string } }).error.message).toContain('"folder" must be an absolute path');
    expect((await send(s.port, { method: "POST", path: "/clients", headers: auth, body: "{nope" })).status).toBe(400);
    expect((await send(s.port, { method: "POST", path: "/clients", headers: auth, body: JSON.stringify({ id, name: "x".repeat(20_000) }) })).status).toBe(413);
    expect((await send(s.port, { method: "GET", path: "/clients", headers: auth })).status).toBe(405);

    expect((await send(s.port, { method: "DELETE", path: `/clients/${id}`, headers: auth })).status).toBe(204);
    expect(clients.get(id)?.state).toBe("gone");
  });

  it("answers /clients with 404 without a registry, like apps from before sessions", async () => {
    const s = await start();
    const res = await send(s.port, { method: "POST", path: "/clients", headers: { authorization: `Bearer ${s.token}` }, body: "{}" });
    expect(res.status).toBe(404);
  });

  it("rejects declared bodies over the limit", async () => {
    const s = await start({ maxBodyBytes: 16 });
    const res = await send(s.port, { method: "POST", path: "/mcp", headers: { authorization: `Bearer ${s.token}` }, body: "x".repeat(64) });
    expect(res.status).toBe(413);
  });

  it("delegates /mcp to a pluggable handler and contains handler crashes", async () => {
    const s = await start({
      onRequest: (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"jsonrpc":"2.0","id":1,"result":{}}');
      },
    });
    const auth = { authorization: `Bearer ${s.token}` };
    expect((await send(s.port, { method: "POST", path: "/mcp", headers: auth, body: "{}" })).status).toBe(200);

    s.setHandler(async () => {
      throw new Error("kaboom");
    });
    const crashed = await send(s.port, { method: "POST", path: "/mcp", headers: auth, body: "{}" });
    expect(crashed.status).toBe(500);
    expect(crashed.body).not.toContain("kaboom");

    s.setHandler(null);
    expect((await send(s.port, { method: "POST", path: "/mcp", headers: auth, body: "{}" })).status).toBe(501);
  });

  it("fails clearly when a fixed port is taken", async () => {
    const first = await start();
    await expect(startMcpServer({ version: "1", configDir: path.join(dir, "other"), port: first.port })).rejects.toThrow(/already in use/);
  });

  it("leaves another instance's connection file alone", async () => {
    const s = await start();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(s.tokenFile, JSON.stringify({ port: 1, url: "x", token: "other", pid: 999999, version: "1" }));
    s.removeTokenFile();
    expect(existsSync(s.tokenFile)).toBe(true);
  });
});
