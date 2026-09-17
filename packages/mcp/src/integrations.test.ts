/** The Claude integrations stay in sync with the server surface. */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUIDE_TOPICS } from "./guides.ts";
import { PROMPT_NAMES, TOOL_NAMES } from "./server.ts";

const root = fileURLToPath(new URL("../../../integrations/", import.meta.url));
const read = (rel: string) => readFileSync(`${root}${rel}`, "utf8");
const json = (rel: string) => JSON.parse(read(rel)) as Record<string, unknown>;

describe("Claude Code plugin", () => {
  it("declares the plugin and a relay MCP server", () => {
    expect(json("claude-code/.claude-plugin/plugin.json")).toMatchObject({
      name: "sonobe",
      version: expect.any(String),
      description: expect.any(String),
    });
    const servers = json("claude-code/.mcp.json").mcpServers as Record<
      string,
      { command: string; args: string[] }
    >;
    // The bundled CLI inside the plugin, so nothing but Node has to be on PATH.
    expect(servers.sonobe).toEqual({
      command: "node",
      args: ["${CLAUDE_PLUGIN_ROOT}/dist/sonobe.mjs", "mcp"],
    });
    const build = read("claude-code/build.ts");
    expect(build).toContain("bundleCli");
    expect(build).toContain('"dist", "sonobe.mjs"');
    expect(read("claude-code/README.md")).toContain("node integrations/claude-code/build.ts");
  });

  it("ships a skill that teaches real tools and guide topics", () => {
    const skill = read("claude-code/skills/sonobe/SKILL.md");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(front).toMatch(/^name: sonobe$/m);
    expect(front).toMatch(/^description: .{60,}$/m);
    const mentioned = [...skill.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]!);
    for (const name of mentioned)
      expect([...TOOL_NAMES, ...PROMPT_NAMES, ...GUIDE_TOPICS] as string[], name).toContain(name);
    for (const tool of [
      "get_guide",
      "get_document_info",
      "get_outline",
      "describe_patch_types",
      "begin_work",
      "finish_work",
      "sim_reset",
      "sim_dispatch",
      "sim_trace",
    ])
      expect(skill).toContain(`\`${tool}\``);
    expect(existsSync(`${root}claude-code/README.md`)).toBe(true);
  });
});

describe("Claude Desktop bundle", () => {
  const manifest = json("claude-desktop/manifest.json") as {
    manifest_version: string;
    name: string;
    version: string;
    description: string;
    author: { name: string };
    server: { type: string; entry_point: string; mcp_config: { command: string; args: string[] } };
    tools: { name: string; description: string }[];
    prompts: { name: string; text: string }[];
    user_config: Record<string, { type: string }>;
  };

  it("is a valid MCPB 0.3 manifest that runs the bundled relay", () => {
    expect(manifest).toMatchObject({
      manifest_version: "0.3",
      name: "sonobe",
      version: expect.any(String),
      description: expect.any(String),
      author: { name: expect.any(String) },
    });
    expect(manifest.server).toMatchObject({
      type: "node",
      entry_point: "server/sonobe.mjs",
      mcp_config: { command: "node", args: ["${__dirname}/server/sonobe.mjs", "mcp"] },
    });
    expect(manifest.user_config.sonobe_home!.type).toBe("directory");
    expect(existsSync(`${root}claude-desktop/build.ts`)).toBe(true);
    expect(read("claude-desktop/build.ts")).toContain("bundleCli");
    expect(read("claude-desktop/README.md")).toContain("mcpb pack");
  });

  it("lists exactly the server's tools and prompts", () => {
    expect(manifest.tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const t of manifest.tools) expect(t.description.length, t.name).toBeGreaterThan(10);
    expect(manifest.prompts.map((p) => p.name)).toEqual([...PROMPT_NAMES]);
  });
});
