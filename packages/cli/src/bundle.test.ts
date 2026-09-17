/**
 * The single-file bundle runs outside the repo: built into a temp folder with no node_modules in
 * reach, then driven as a real process (new, validate, sim, describe, and mcp --headless over
 * stdio with the 2026-era v2 client).
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleCli, type BundleResult } from "../scripts/bundle.ts";

const run = promisify(execFile);

let dir: string;
let bundle: BundleResult;

const childEnv = () =>
  Object.fromEntries(
    Object.entries({ ...process.env, NODE_PATH: "", SONOBE_GUIDES_DIR: "" }).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
    ),
  );

async function sonobe(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const r = await run(process.execPath, [bundle.outfile, ...args], {
      cwd: dir,
      env: childEnv(),
    });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-bundle-"));
  bundle = await bundleCli({ outfile: path.join(dir, "bin", "sonobe.mjs"), logLevel: "error" });
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the bundled CLI", () => {
  it("is one executable file with a shebang and the guides beside it", async () => {
    const code = await readFile(bundle.outfile, "utf8");
    expect(code.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(code.match(/^#!/gm)).toHaveLength(1);
    expect((await stat(bundle.outfile)).mode & 0o111).not.toBe(0);
    expect(code).not.toMatch(/from\s+["']@sonobe\//);
    expect(bundle.guidesDir).toBe(path.join(dir, "bin", "guides"));
    expect(bundle.rasterizerDir).toBe(path.join(dir, "bin", "node_modules", "@resvg"));
    expect(
      (await stat(path.join(bundle.rasterizerDir!, "resvg-js", "package.json"))).isFile(),
    ).toBe(true);
    const direct = await run(bundle.outfile, ["--version"], { cwd: dir, env: childEnv() });
    expect(direct.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it("creates, validates, describes and simulates projects", async () => {
    const created = await sonobe(["new", "Zoom.sonobe", "--template", "photo-zoom"]);
    expect(created.code, created.stderr).toBe(0);
    expect(created.stdout).toContain('Created "Zoom"');
    const valid = await sonobe(["validate", "Zoom.sonobe"]);
    expect(valid.code, valid.stderr).toBe(0);
    expect(valid.stdout).toContain("0 errors, 0 warnings");
    const described = await sonobe(["describe", "optionPicker"]);
    expect(described.stdout).toContain('"option0", "option1"');
    await writeFile(
      path.join(dir, "tap.json"),
      JSON.stringify([{ kind: "tap", target: "@photo", atMs: 100 }]),
    );
    const sim = await sonobe([
      "sim",
      "Zoom.sonobe",
      "--events",
      "tap.json",
      "--trace",
      "@photo.scale",
      "--duration",
      "900",
      "--rows",
      "6",
    ]);
    expect(sim.code, sim.stderr).toBe(0);
    expect(sim.stdout).toMatch(/@photo\.scale: start 1 → end 1\.2\d*, settled by \d+ ms/);
  }, 60_000);

  it("serves a project over stdio to the v2 client", async () => {
    const project = path.join(dir, "Served.sonobe");
    expect((await sonobe(["new", project, "--template", "photo-zoom"])).code).toBe(0);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundle.outfile, "mcp", "--headless", project, "--no-autosave"],
      env: childEnv(),
      cwd: dir,
      stderr: "pipe",
    });
    const client = new Client(
      { name: "claude-code", version: "2.1.273" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(30);
      const guide = await client.callTool({
        name: "get_guide",
        arguments: { topic: "start-here" },
      });
      expect((guide.structuredContent as { text: string }).text).toContain("# Start here");
      const reset = await client.callTool({ name: "sim_reset", arguments: {} });
      const simId = (reset.structuredContent as { simId: string }).simId;
      const tap = await client.callTool({
        name: "sim_dispatch",
        arguments: { simId, events: [{ kind: "tap", target: "@photo" }] },
      });
      expect(JSON.stringify(tap.structuredContent)).toContain("tap_photo");
      // Headless screenshots load the rasterizer copied beside the bundle.
      const shot = await client.callTool({
        name: "get_screenshot",
        arguments: { simId, target: "@photo", atMs: 400 },
      });
      expect(shot.isError, JSON.stringify(shot.content)).toBeFalsy();
      expect((shot.content as { type: string; mimeType?: string }[])[0]).toMatchObject({
        type: "image",
        mimeType: "image/png",
      });
      const missing = await client.callTool({ name: "sim_step", arguments: { simId: "sim_99" } });
      expect(missing.isError).toBe(true);
      expect((missing.structuredContent as { error: { code: string } }).error.code).toBe(
        "unknown_sim",
      );
    } finally {
      await client.close();
    }
  }, 60_000);
});
