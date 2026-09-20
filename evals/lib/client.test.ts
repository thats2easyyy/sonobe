import { describe, expect, it } from "vitest";
import { childEnv, claudeArgs, EXAMPLE_TOOLS, mcpConfig, parseClaudeVersion } from "./client.ts";

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("claudeArgs", () => {
  const args = claudeArgs({
    mcpConfigPath: "/tmp/run/mcp.json",
    maxTurns: 40,
    hideExamples: true,
    model: "haiku",
    budgetUsd: 2,
  });

  it("runs headless with only Sonobe's tools, all allowed", () => {
    expect(args[0]).toBe("-p");
    expect(flag(args, "--output-format")).toBe("stream-json");
    expect(args).toContain("--verbose");
    expect(flag(args, "--mcp-config")).toBe("/tmp/run/mcp.json");
    expect(args).toContain("--strict-mcp-config");
    expect(flag(args, "--tools")).toBe("");
    expect(flag(args, "--allowedTools")).toBe("mcp__sonobe");
    expect(flag(args, "--permission-mode")).toBe("dontAsk");
    expect(args).toContain("--no-session-persistence");
  });

  it("applies the budgets and the model", () => {
    expect(flag(args, "--max-turns")).toBe("40");
    expect(flag(args, "--model")).toBe("haiku");
    expect(flag(args, "--max-budget-usd")).toBe("2");
  });

  it("hides the examples and the person's own settings unless asked", () => {
    expect(
      args.slice(
        args.indexOf("--disallowedTools") + 1,
        args.indexOf("--disallowedTools") + 1 + EXAMPLE_TOOLS.length,
      ),
    ).toEqual(EXAMPLE_TOOLS);
    expect(flag(args, "--setting-sources")).toBe("project,local");
    const open = claudeArgs({
      mcpConfigPath: "m.json",
      maxTurns: 5,
      hideExamples: false,
      userConfig: true,
    });
    expect(open).not.toContain("--disallowedTools");
    expect(open).not.toContain("--setting-sources");
    expect(open).not.toContain("--model");
  });

  it("keeps skills and slash commands off, even with the person's own settings", () => {
    const open = claudeArgs({
      mcpConfigPath: "m.json",
      maxTurns: 5,
      hideExamples: false,
      userConfig: true,
    });
    for (const a of [args, open]) {
      expect(a).toContain("--disable-slash-commands");
      expect(flag(a, "--tools")).toBe("");
    }
  });

  it("never puts the prompt on the command line (it goes in on stdin)", () => {
    expect(args.filter((a) => !a.startsWith("--") && a !== "-p")).toEqual([
      "stream-json",
      "/tmp/run/mcp.json",
      "",
      "mcp__sonobe",
      "dontAsk",
      "40",
      "project,local",
      ...EXAMPLE_TOOLS,
      "haiku",
      "2",
    ]);
  });
});

describe("childEnv", () => {
  it("drops a parent Claude Code session's variables and keeps the rest", () => {
    const env = childEnv({
      PATH: "/bin",
      HOME: "/home/me",
      ANTHROPIC_API_KEY: "k",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "s",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_PROJECT_DIR: "/p",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/home/me",
      ANTHROPIC_API_KEY: "k",
      CLAUDE_CODE_USE_BEDROCK: "1",
    });
  });
});

describe("mcpConfig and parseClaudeVersion", () => {
  it("starts sonobe mcp --headless on the run's project", () => {
    expect(
      mcpConfig({
        node: "/usr/bin/node",
        sonobe: "/repo/packages/cli/dist/sonobe.mjs",
        project: "/tmp/run/Prototype.sonobe",
      }),
    ).toEqual({
      mcpServers: {
        sonobe: {
          command: "/usr/bin/node",
          args: [
            "/repo/packages/cli/dist/sonobe.mjs",
            "mcp",
            "--headless",
            "/tmp/run/Prototype.sonobe",
          ],
        },
      },
    });
  });

  it("reads the version claude --version prints", () => {
    expect(parseClaudeVersion("2.1.278 (Claude Code)\n")).toBe("2.1.278");
    expect(parseClaudeVersion("nothing")).toBeUndefined();
  });
});
