import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createHeadlessHost,
  createHttpHandler,
  TOOL_NAMES,
  type HeadlessHost,
  type NodeMcpHandler,
} from "@sonobe/mcp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.ts";
import { encodeHeaderValue } from "./relay.ts";

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(
  args: string[],
  extra: { env?: Record<string, string>; stdin?: PassThrough } = {},
) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    cwd: dir,
    env: { ...extra.env },
    stdout: { write: (s: string) => (stdout += s) },
    stderr: { write: (s: string) => (stderr += s) },
    ...(extra.stdin ? { stdin: extra.stdin } : {}),
  });
  return { code, stdout, stderr };
}

const childEnv = (extra: Record<string, string> = {}) =>
  Object.fromEntries(
    Object.entries({ ...process.env, ...extra }).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );

describe("sonobe CLI commands", () => {
  it("prints friendly help and rejects unknown commands", async () => {
    const help = await run([]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: sonobe <command>");
    expect(help.stdout).toContain("mcp --headless <dir>");
    const sub = await run(["sim", "--help"]);
    expect(sub.stdout).toContain("--trace");
    const unknown = await run(["validat"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Did you mean "validate"');
    const version = await run(["--version"]);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
    const badFlag = await run(["outline", "x", "--nope"]);
    expect(badFlag.code).toBe(2);
    expect(badFlag.stderr).toContain("Usage: sonobe outline");
  });

  it("creates, validates, outlines and describes projects", async () => {
    const created = await run(["new", "Photo Zoom.sonobe", "--template", "photo-zoom"]);
    expect(created.code, created.stderr).toBe(0);
    expect(created.stdout).toContain('Created "Photo Zoom"');
    expect(await readFile(path.join(dir, "Photo Zoom.sonobe", "project.json"), "utf8")).toContain(
      '"name": "Photo Zoom"',
    );

    const again = await run(["new", "Photo Zoom.sonobe"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("already holds a Sonobe project");

    const valid = await run(["validate", "Photo Zoom.sonobe"]);
    expect(valid.code).toBe(0);
    expect(valid.stdout).toContain("0 errors, 0 warnings");

    const outline = await run(["outline", "Photo Zoom.sonobe", "--detail", "compact"]);
    expect(outline.stdout).toContain('patch zoomed switch "Zoomed" flip←tap_photo.tap');

    const describe = await run(["describe", "popAnimation"]);
    expect(describe.stdout).toContain("bounciness: number = 5");
    const layer = await run(["describe", "rectangle"]);
    expect(layer.stdout).toContain("cornerRadius");
    const typo = await run(["describe", "popAnimaton"]);
    expect(typo.code).toBe(1);
    expect(typo.stderr).toContain('Did you mean "popAnimation"');
    const jsonDescribe = await run(["describe", "switch", "--json"]);
    expect(JSON.parse(jsonDescribe.stdout)).toMatchObject({
      type: "switch",
      inputs: expect.any(Array),
    });
  });

  it("fails validation on errors and on folders that aren't projects", async () => {
    await run(["new", "Broken.sonobe", "--template", "photo-zoom"]);
    const file = path.join(dir, "Broken.sonobe", "components", "main.json");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        '"link": "zoom_scale.output"',
        '"link": "zoom_scal.output"',
      ),
    );
    const r = await run(["validate", "Broken.sonobe"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("dangling_link");
    expect(r.stdout).toContain("1 error");
    const json = await run(["validate", "Broken.sonobe", "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, totals: { errors: 1 } });

    await mkdir(path.join(dir, "Empty"));
    const empty = await run(["validate", "Empty"]);
    expect(empty.code).toBe(1);
    expect(empty.stderr).toContain("project.json is missing");
    const outline = await run(["outline", "Empty"]);
    expect(outline.stderr).toContain('sonobe new "Empty"');
  });

  it("formats files canonically", async () => {
    await run(["new", "Fmt.sonobe", "--template", "photo-zoom"]);
    const file = path.join(dir, "Fmt.sonobe", "components", "main.json");
    await writeFile(file, JSON.stringify(JSON.parse(await readFile(file, "utf8"))));
    const check = await run(["fmt", "Fmt.sonobe", "--check"]);
    expect(check.code).toBe(1);
    expect(check.stdout).toContain("components/main.json");
    const fix = await run(["fmt", "Fmt.sonobe"]);
    expect(fix.code).toBe(0);
    expect(fix.stdout).toContain("Formatted:");
    expect((await run(["fmt", "Fmt.sonobe", "--check"])).stdout).toContain("Already formatted.");
  });

  it("opens, formats and keeps projects with folders and other files in scripts/", async () => {
    await run(["new", "Helpers.sonobe"]);
    const scripts = path.join(dir, "Helpers.sonobe", "scripts");
    await mkdir(path.join(scripts, "lib"), { recursive: true });
    await writeFile(path.join(scripts, "lib", "math.js"), "export const x = 1;\n");
    await writeFile(path.join(scripts, ".eslintrc.json"), "{}\n");
    await writeFile(path.join(scripts, "my helper.js"), "// spaces\n");

    const valid = await run(["validate", "Helpers.sonobe"]);
    expect(valid.code, valid.stderr).toBe(0);
    expect((await run(["outline", "Helpers.sonobe"])).code).toBe(0);
    expect((await run(["fmt", "Helpers.sonobe", "--check"])).stdout).toContain("Already formatted.");
    const fmt = await run(["fmt", "Helpers.sonobe"]);
    expect(fmt.code, fmt.stderr).toBe(0);
    expect(fmt.stdout).not.toContain("Removed");
    expect(await readFile(path.join(scripts, "lib", "math.js"), "utf8")).toContain("x = 1");
    expect(await readFile(path.join(scripts, "my helper.js"), "utf8")).toContain("spaces");
  });

  it("reports layers nested too deep as a format error", async () => {
    await run(["new", "Deep.sonobe"]);
    const file = path.join(dir, "Deep.sonobe", "components", "main.json");
    const main = JSON.parse(await readFile(file, "utf8")) as { layers: unknown };
    // 5000 nested groups, written as text: JSON.stringify itself recurses and runs out of stack this deep.
    const depth = 5000;
    let layers = "";
    for (let i = 1; i <= depth; i++) layers += `{"id":"l${i}","type":"group","name":"L","props":{}${i < depth ? ',"children":[' : "}"}`;
    layers += "]}".repeat(depth - 1);
    main.layers = "LAYERS";
    await writeFile(file, JSON.stringify(main).replace('"LAYERS"', `[${layers}]`));
    const json = await run(["validate", "Deep.sonobe", "--json"]);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, formatError: { code: "invalidFormat", message: expect.stringContaining("nested more than 256 levels") } });
  });

  it("simulates events and prints a trace with summaries", async () => {
    await run(["new", "Sim.sonobe", "--template", "photo-zoom"]);
    await writeFile(
      path.join(dir, "tap.json"),
      JSON.stringify([{ kind: "tap", target: "@photo", atMs: 100 }]),
    );
    const r = await run([
      "sim",
      "Sim.sonobe",
      "--events",
      "tap.json",
      "--trace",
      "@photo.scale,zoomed.on",
      "--duration",
      "900",
      "--rows",
      "10",
    ]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/t_ms\s+@photo\.scale\s+zoomed\.on/);
    expect(r.stdout).toContain("Summaries:");
    expect(r.stdout).toMatch(/@photo\.scale: start 1 → end 1\.2\d*, settled by \d+ ms/);
    const json = await run([
      "sim",
      "Sim.sonobe",
      "--trace",
      "@photo.scale",
      "--duration",
      "100",
      "--json",
    ]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      targets: ["@photo.scale"],
      times: expect.any(Array),
    });

    await writeFile(
      path.join(dir, "bad.json"),
      JSON.stringify([{ kind: "tapp", target: "@photo" }]),
    );
    const bad = await run(["sim", "Sim.sonobe", "--events", "bad.json", "--trace", "@photo.scale"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("invalid events");
    const missingTrace = await run(["sim", "Sim.sonobe"]);
    expect(missingTrace.code).toBe(2);
    const badTarget = await run(["sim", "Sim.sonobe", "--trace", "@photo.scal"]);
    expect(badTarget.code).toBe(1);
    expect(badTarget.stderr).toContain('Did you mean "scale"');
  });
});

describe("sonobe mcp relay", () => {
  it("explains how to start the app when it isn't running", async () => {
    const r = await run(["mcp"], {
      env: { SONOBE_HOME: path.join(dir, "home") },
      stdin: new PassThrough(),
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("the Sonobe app isn't running");
    expect(r.stderr).toContain("sonobe mcp --headless");
  });

  it("encodes non-ASCII header values with the base64 sentinel", () => {
    expect(encodeHeaderValue("get_outline")).toBe("get_outline");
    expect(encodeHeaderValue("sonobe://guides/café")).toBe(
      `=?base64?${Buffer.from("sonobe://guides/café").toString("base64")}?=`,
    );
  });
});

describe("sonobe main.ts end to end", () => {
  let project: string;
  let host: HeadlessHost;
  let handler: NodeMcpHandler;
  let server: Server;
  let home: string;
  const token = "test-token-abc";

  beforeAll(async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sonobe-cli-e2e-"));
    project = path.join(base, "App.sonobe");
    home = path.join(base, "home");
    host = createHeadlessHost();
    await host.createDocument({ path: project, template: "photo-zoom" });
    handler = createHttpHandler(host, { version: "9.9.9" });
    server = createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res
          .writeHead(401, { "content-type": "application/json" })
          .end('{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"Unauthorized"}}');
        return;
      }
      if (req.url === "/health") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end('{"ok":true,"version":"9.9.9"}');
        return;
      }
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as { port: number }).port;
    await mkdir(home, { recursive: true });
    await writeFile(
      path.join(home, "mcp.json"),
      JSON.stringify({
        port,
        url: `http://127.0.0.1:${port}/mcp`,
        token,
        pid: process.pid,
        version: "9.9.9",
      }),
    );
  });

  afterAll(async () => {
    await handler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await host.close();
    await rm(path.dirname(project), { recursive: true, force: true });
  });

  it("runs as a script", async () => {
    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [MAIN, "--help"], { env: childEnv() });
      let text = "";
      child.stdout.on("data", (d: Buffer) => (text += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve(text) : reject(new Error(`exit ${code}`))));
    });
    expect(out).toContain("Usage: sonobe <command>");
  });

  it("serves a project headless over stdio", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN, "mcp", "--headless", project, "--no-autosave"],
      env: childEnv(),
      stderr: "pipe",
    });
    const client = new Client({ name: "claude-code", version: "2.1.273" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOL_NAMES.length);
    const outline = await client.callTool({
      name: "get_outline",
      arguments: { detail: "compact" },
    });
    expect(JSON.stringify(outline.content)).toContain("patch zoom_spring popAnimation");
    const info = await client.callTool({ name: "get_document_info", arguments: {} });
    expect(JSON.stringify(info.content)).toContain("call save_document");
    await client.close();
  });

  it("relays 2025-era MCP to the app with the bearer token", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MAIN, "mcp"],
      env: childEnv({ SONOBE_HOME: home }),
      stderr: "pipe",
    });
    const client = new Client({ name: "claude-ai", version: "2.110.0" });
    await client.connect(transport);
    expect(client.getServerVersion()).toMatchObject({ name: "sonobe", version: "9.9.9" });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(TOOL_NAMES.length);
    const r = await client.callTool({
      name: "add_layers",
      arguments: { layers: [{ type: "oval", name: "Relayed Dot" }] },
    });
    expect(r.isError).toBeFalsy();
    expect((await host.getDocument()).doc.components.main!.layers.map((l) => l.id)).toContain(
      "relayed_dot",
    );
    await client.close();
  });

  it("relays 2026-07-28 requests with Mcp-* headers", async () => {
    const meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { name: "claude-code", version: "2.1.273" },
    };
    const responses = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const child = spawn(process.execPath, [MAIN, "mcp"], {
        env: childEnv({ SONOBE_HOME: home }),
      });
      const got: Record<string, unknown>[] = [];
      let buffer = "";
      child.stdout.on("data", (d: Buffer) => {
        buffer += d.toString();
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          got.push(JSON.parse(buffer.slice(0, at)) as Record<string, unknown>);
          buffer = buffer.slice(at + 1);
          if (got.length === 2) child.stdin.end();
        }
      });
      child.on("error", reject);
      child.on("close", () => resolve(got));
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: meta } })}\n`,
      );
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_guide", arguments: { topic: "loops" }, _meta: meta } })}\n`,
      );
    });
    const byId = new Map(responses.map((r) => [r.id, r]));
    expect(byId.get(1)!.result).toMatchObject({
      supportedVersions: expect.arrayContaining(["2026-07-28"]),
    });
    expect(byId.get(2)!.result).toMatchObject({
      structuredContent: { topic: "loops" },
      resultType: "complete",
    });
  });

  it("reports a stale token clearly", async () => {
    const stale = path.join(path.dirname(project), "stale-home");
    await mkdir(stale, { recursive: true });
    const original = JSON.parse(await readFile(path.join(home, "mcp.json"), "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      path.join(stale, "mcp.json"),
      JSON.stringify({ ...original, token: "old-token" }),
    );
    const r = await run(["mcp"], { env: { SONOBE_HOME: stale }, stdin: new PassThrough() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("rejected the token");
  });
});
