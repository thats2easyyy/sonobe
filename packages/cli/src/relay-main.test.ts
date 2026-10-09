/**
 * `sonobe mcp` has two entries: main.ts, which loads relay-main.ts for exactly `mcp` and the CLI for
 * everything else, and the CLI's own mcp command. Both run runRelayCommand, and a Claude session must
 * not be able to tell them apart. The relay's entry also has to stay small: one runs per session.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli, VERSION } from "./cli.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(here, "main.ts");
const read = (file: string) => readFile(path.join(here, file), "utf8");
const imports = (source: string) => [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]!);

describe("the relay's own entry", () => {
  it("imports Node's modules, relay.ts, the package's version and the client header, and nothing else", async () => {
    const relay = imports(await read("relay.ts"));
    expect(relay.filter((from) => !from.startsWith("node:"))).toEqual(["@sonobe/mcp/clients"]);
    expect(imports(await read("relay-main.ts")).sort()).toEqual(["../package.json", "./relay.ts"]);
    // The header's module stands alone too: importing it from the @sonobe/mcp index instead made the bundle 1.9 MB.
    expect(imports(await read("../../mcp/src/clients.ts"))).toEqual([]);
    const mcp = JSON.parse(await read("../../mcp/package.json")) as { exports: Record<string, string> };
    expect(mcp.exports["./clients"]).toBe("./src/clients.ts");
  });

  it("bundles to a few kilobytes", async () => {
    const result = await build({ entryPoints: [path.join(here, "relay-main.ts")], bundle: true, platform: "node", format: "esm", target: "node22", write: false, logLevel: "silent" });
    const code = result.outputFiles[0]!.text;
    expect(code.length).toBeLessThan(64 * 1024);
    expect(code).toContain("sonobe mcp: relaying to Sonobe");
    expect(code).not.toMatch(/from\s+["']@sonobe\//);
  });

  it("is where main.ts goes for exactly `mcp`, and only then", async () => {
    const main = await read("main.ts");
    expect(main).toContain('if (args.length === 1 && args[0] === "mcp") {\n  await import("./relay-main.ts");');
    expect(main).toContain('await import("./cli.ts")');
    // Nothing is loaded before the choice is made.
    expect(imports(main)).toEqual([]);
  });
});

describe("sonobe mcp through main.ts and through the CLI", () => {
  let dir: string;
  let home: string;
  let server: Server;
  const seen: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sonobe-relay-main-"));
    home = path.join(dir, "home");
    // The app, as far as the relay needs it: /health, /clients, and one answer for every POST.
    server = createServer((req, res) => {
      if (req.url === "/health") return void res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true,"version":"9.9.9"}');
      if (req.url?.startsWith("/clients")) {
        seen.push(`${req.method} /clients`);
        return void res.writeHead(204).end();
      }
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const message = JSON.parse(body) as { id: number; method: string };
        seen.push(message.method);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "sonobe", version: "9.9.9" } } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    await mkdir(home);
    await writeFile(path.join(home, "mcp.json"), JSON.stringify({ port, url: `http://127.0.0.1:${port}/mcp`, token: "t" }));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });

  const env = (extra: Record<string, string>) => Object.fromEntries(Object.entries({ ...process.env, ...extra }).filter((e): e is [string, string] => typeof e[1] === "string"));
  const initialize = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.0" } } })}\n`;

  /** `node main.ts <args>` as a process: its output and exit code. With `input`, stdin closes after the first line out. */
  function viaMain(args: string[], sonobeHome: string, input?: string) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [MAIN, ...args], { env: env({ SONOBE_HOME: sonobeHome }), cwd: dir });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (input && stdout.includes("\n")) child.stdin.end();
      });
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      if (input) child.stdin.write(input);
      else child.stdin.end();
    });
  }

  /** The CLI's mcp command in this process, the same way. */
  async function viaCli(args: string[], sonobeHome: string, input?: string) {
    const stdin = new PassThrough();
    let stdout = "";
    let stderr = "";
    const done = runCli(args, {
      cwd: dir,
      env: { SONOBE_HOME: sonobeHome },
      stdin,
      stdout: {
        write: (text: string) => {
          stdout += text;
          if (input) stdin.end();
        },
      },
      stderr: { write: (text: string) => (stderr += text) },
    });
    if (input) stdin.write(input);
    else stdin.end();
    return { code: await done, stdout, stderr };
  }

  it("relays the same way from both: the same answer, the same line on stderr, exit 0 when stdin closes", async () => {
    const main = await viaMain(["mcp"], home, initialize);
    const cli = await viaCli(["mcp"], home, initialize);
    expect(main.code).toBe(0);
    expect(JSON.parse(main.stdout)).toMatchObject({ id: 1, result: { serverInfo: { name: "sonobe", version: "9.9.9" } } });
    expect(main).toEqual(cli);
    expect(main.stderr).toMatch(/^sonobe mcp: relaying to Sonobe 9\.9\.9 at http:\/\/127\.0\.0\.1:\d+\/mcp\n$/);
    // Each said hello, forwarded the message and said goodbye (the hello and the message go out together).
    expect([...seen].sort()).toEqual(["DELETE /clients", "DELETE /clients", "POST /clients", "POST /clients", "initialize", "initialize"]);
  });

  it("says the same when the app isn't running, and exits 1", async () => {
    const empty = path.join(dir, "no-app");
    const main = await viaMain(["mcp"], empty);
    expect(main.code).toBe(1);
    expect(main.stderr).toContain("the Sonobe app isn't running");
    expect(main.stderr).toContain("sonobe mcp --headless <project.sonobe>");
    expect(main).toEqual(await viaCli(["mcp"], empty));
  });

  it("leaves every other form of mcp to the CLI, so its answers are the CLI's", async () => {
    for (const args of [["mcp", "--help"], ["mcp", "Stray.sonobe"], ["mcp", "--headles", "x"], ["--version"]]) {
      const main = await viaMain(args, home);
      expect(main, args.join(" ")).toEqual(await viaCli(args, home));
    }
    expect((await viaMain(["mcp", "--help"], home)).stdout).toContain("sonobe mcp");
    expect((await viaMain(["mcp", "Stray.sonobe"], home)).code).toBe(2);
    expect((await viaMain(["--version"], home)).stdout).toBe(`${VERSION}\n`);
  }, 30_000);
});
