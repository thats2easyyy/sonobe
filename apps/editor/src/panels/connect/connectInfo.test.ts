import { describe, expect, it } from "vitest";
import {
  claudeCodeCommand,
  claudeCodeRemoveCommand,
  claudeDesktopConfig,
  claudeDesktopConfigPath,
  connectedSessions,
  EXAMPLE_PROMPTS,
  joinRepoPath,
  mcpLaunchSpec,
  parseMcpStatus,
  relativeTime,
  repoPathFromDevUrl,
  sessionSummary,
  shellForPlatform,
  shellQuote,
  tildePath,
} from "./connectInfo.ts";

const SESSION = {
  id: "11111111-aaaa-4bbb-8ccc-000000000001",
  label: "Claude Code",
  name: "claude-code",
  version: "2.1.278",
  folder: "/Users/me/noddit",
  via: "relay",
  state: "connected",
  connectedAt: 1_000,
  lastSeenAt: 50_000,
  lastActivityAt: 40_000,
  lastTool: "get_outline",
  toolCalls: 3,
  relayVersion: "0.1.0",
};

describe("parseMcpStatus", () => {
  it("accepts the host's status shape", () => {
    const cliPath = "/Applications/Sonobe.app/Contents/Resources/cli/sonobe";
    expect(parseMcpStatus({ running: true, port: 52817, url: "http://127.0.0.1:52817/mcp", tokenFile: "/Users/me/.sonobe/mcp.json", cliPath, clients: [], checkedAt: 5, version: "0.1.0" })).toEqual({
      running: true,
      port: 52817,
      url: "http://127.0.0.1:52817/mcp",
      tokenFile: "/Users/me/.sonobe/mcp.json",
      cliPath,
      clients: [],
      checkedAt: 5,
      version: "0.1.0",
    });
    // Older hosts send no sessions.
    expect(parseMcpStatus({ running: false, port: null, url: null, tokenFile: "" })).toEqual({ running: false, port: null, url: null, tokenFile: null, cliPath: null, clients: [], checkedAt: null, version: null });
    expect(parseMcpStatus({ running: false, port: null, url: null, tokenFile: "", cliPath: " " })?.cliPath).toBeNull();
  });

  it("keeps good session rows and drops malformed ones", () => {
    const status = parseMcpStatus({ running: true, port: 1, url: null, tokenFile: null, clients: [SESSION, { ...SESSION, id: "" }, { ...SESSION, state: "asleep" }, { ...SESSION, via: "carrier-pigeon" }, "junk", null, { ...SESSION, id: "http", via: "http", folder: null, lastTool: 7 }] });
    expect(status?.clients.map((c) => c.id)).toEqual([SESSION.id, "http"]);
    expect(status?.clients[0]).toMatchObject({ label: "Claude Code", folder: "/Users/me/noddit", toolCalls: 3, lastTool: "get_outline" });
    expect(status?.clients[1]).toMatchObject({ folder: null, lastTool: null });
  });

  it("counts only connected sessions of a running server", () => {
    const status = parseMcpStatus({ running: true, port: 1, url: null, tokenFile: null, clients: [SESSION, { ...SESSION, id: "22222222-aaaa-4bbb-8ccc-000000000002", state: "gone" }] });
    expect(connectedSessions(status).map((c) => c.id)).toEqual([SESSION.id]);
    expect(connectedSessions(status && { ...status, running: false })).toEqual([]);
    expect(connectedSessions(null)).toEqual([]);
  });

  it("rejects anything else", () => {
    expect(parseMcpStatus(null)).toBeNull();
    expect(parseMcpStatus("running")).toBeNull();
    expect(parseMcpStatus({ port: 1 })).toBeNull();
  });
});

describe("session text", () => {
  it("says how long ago, in words", () => {
    expect(relativeTime(10_000, 12_000)).toBe("just now");
    expect(relativeTime(0, 12_000)).toBe("12 s ago");
    expect(relativeTime(0, 4 * 60_000 + 30_000)).toBe("4 min ago");
    expect(relativeTime(0, 2 * 3600_000 + 60_000)).toBe("2 h ago");
    expect(relativeTime(5_000, 0)).toBe("just now");
  });

  it("sums a session up in one line", () => {
    const [session] = parseMcpStatus({ running: true, clients: [SESSION] })!.clients;
    expect(sessionSummary(session!, 52_000)).toBe("Claude Code · noddit · active 12 s ago");
    expect(sessionSummary({ ...session!, folder: null, lastActivityAt: null }, 61_000)).toBe("Claude Code · connected 1 min ago");
  });
});

describe("shell quoting", () => {
  it("leaves simple words bare and quotes the rest", () => {
    expect(shellQuote("/Users/me/sonobe/packages/cli/src/main.ts", "posix")).toBe("/Users/me/sonobe/packages/cli/src/main.ts");
    expect(shellQuote("/Users/me/My Projects/sonobe", "posix")).toBe("'/Users/me/My Projects/sonobe'");
    expect(shellQuote("it's", "posix")).toBe("'it'\\''s'");
    expect(shellQuote("$(rm -rf ~)", "posix")).toBe("'$(rm -rf ~)'");
    expect(shellQuote("C:\\dev\\sonobe", "windows")).toBe("C:\\dev\\sonobe");
    expect(shellQuote("C:\\Program Files\\nodejs\\node.exe", "windows")).toBe('"C:\\Program Files\\nodejs\\node.exe"');
    expect(shellQuote("", "posix")).toBe("''");
    expect(shellForPlatform("win32")).toBe("windows");
    expect(shellForPlatform("darwin")).toBe("posix");
  });

  it("joins repo paths with the repo's separators", () => {
    expect(joinRepoPath("/Users/me/sonobe/", "packages/cli/src/main.ts")).toBe("/Users/me/sonobe/packages/cli/src/main.ts");
    expect(joinRepoPath("C:\\dev\\sonobe", "packages/cli/src/main.ts")).toBe("C:\\dev\\sonobe\\packages\\cli\\src\\main.ts");
  });
});

describe("launch commands", () => {
  it("runs a checkout with node, installed for every project", () => {
    const spec = mcpLaunchSpec({ mode: "checkout", nodePath: "/opt/homebrew/bin/node", repoPath: "/Users/me/sonobe" });
    expect(spec).toEqual({ command: "/opt/homebrew/bin/node", args: ["/Users/me/sonobe/packages/cli/src/main.ts", "mcp"] });
    expect(claudeCodeCommand(spec)).toBe("claude mcp add --scope user sonobe -- /opt/homebrew/bin/node /Users/me/sonobe/packages/cli/src/main.ts mcp");
  });

  it("uses the app's bundled CLI by full path in production", () => {
    const cliPath = "/Applications/Sonobe.app/Contents/Resources/cli/sonobe";
    const spec = mcpLaunchSpec({ mode: "installed", cliPath });
    expect(claudeCodeCommand(spec)).toBe(`claude mcp add --scope user sonobe -- ${cliPath} mcp`);
    expect(JSON.parse(claudeDesktopConfig(spec))).toEqual({ mcpServers: { sonobe: { command: cliPath, args: ["mcp"] } } });
    const windows = mcpLaunchSpec({ mode: "installed", cliPath: "C:\\Program Files\\Sonobe\\resources\\cli\\sonobe.cmd" });
    expect(claudeCodeCommand(windows, "windows")).toBe('claude mcp add --scope user sonobe -- "C:\\Program Files\\Sonobe\\resources\\cli\\sonobe.cmd" mcp');
  });

  it("falls back to sonobe on PATH when the host has no bundled CLI", () => {
    const spec = mcpLaunchSpec({ mode: "installed", cliPath: null });
    expect(claudeCodeCommand(spec)).toBe("claude mcp add --scope user sonobe -- sonobe mcp");
    expect(JSON.parse(claudeDesktopConfig(spec))).toEqual({ mcpServers: { sonobe: { command: "sonobe", args: ["mcp"] } } });
  });

  it("keeps a headless server with one project, and quotes paths with spaces", () => {
    const spec = mcpLaunchSpec({ mode: "checkout", repoPath: "/Users/me/sonobe", headlessProject: "/Users/me/Checkout Flow.sonobe" });
    expect(claudeCodeCommand(spec)).toBe("claude mcp add --scope local sonobe-headless -- node /Users/me/sonobe/packages/cli/src/main.ts mcp --headless '/Users/me/Checkout Flow.sonobe'");
    expect(mcpLaunchSpec({ mode: "checkout", nodePath: " ", repoPath: "" })).toEqual({ command: "node", args: ["/path/to/sonobe/packages/cli/src/main.ts", "mcp"] });
  });

  it("quotes every launch part, whatever its position", () => {
    const spec = { command: "/Users/me/My Tools/node", args: ["/Users/me/sonobe/packages/cli/src/main.ts", "mcp"] };
    expect(claudeCodeCommand(spec)).toBe("claude mcp add --scope user sonobe -- '/Users/me/My Tools/node' /Users/me/sonobe/packages/cli/src/main.ts mcp");
    expect(claudeCodeCommand(spec, "posix", { scope: "local", name: "sonobe-dev" })).toBe("claude mcp add --scope local sonobe-dev -- '/Users/me/My Tools/node' /Users/me/sonobe/packages/cli/src/main.ts mcp");
  });

  it("removes one scope's entry", () => {
    expect(claudeCodeRemoveCommand("local")).toBe("claude mcp remove --scope local sonobe");
    expect(claudeCodeRemoveCommand("user", "sonobe-headless")).toBe("claude mcp remove --scope user sonobe-headless");
  });

  it("knows where Claude Desktop keeps its config", () => {
    expect(claudeDesktopConfigPath("darwin")).toBe("~/Library/Application Support/Claude/claude_desktop_config.json");
    expect(claudeDesktopConfigPath("win32")).toBe("%APPDATA%\\Claude\\claude_desktop_config.json");
    expect(claudeDesktopConfigPath("linux")).toBeNull();
  });
});

describe("repoPathFromDevUrl", () => {
  it("reads the repo root from a /@fs dev URL", () => {
    expect(repoPathFromDevUrl("/@fs/Users/me/workspace/sonobe/packages/cli/src/main.ts")).toBe("/Users/me/workspace/sonobe");
    expect(repoPathFromDevUrl("http://localhost:5199/@fs/Users/me/My%20Code/sonobe/packages/cli/src/main.ts?url")).toBe("/Users/me/My Code/sonobe");
    expect(repoPathFromDevUrl("/@fs/C:/dev/sonobe/packages/cli/src/main.ts")).toBe("C:\\dev\\sonobe");
    expect(repoPathFromDevUrl("./assets/main-abc123.ts")).toBeNull();
    expect(repoPathFromDevUrl(null)).toBeNull();
  });

  it("shortens home paths", () => {
    expect(tildePath("/Users/me/.sonobe/mcp.json")).toBe("~/.sonobe/mcp.json");
    expect(tildePath("/home/me/.sonobe/mcp.json")).toBe("~/.sonobe/mcp.json");
    expect(tildePath("C:\\Users\\me\\.sonobe\\mcp.json")).toBe("C:\\Users\\me\\.sonobe\\mcp.json");
  });

  it("has prompts for each audience", () => {
    expect(EXAMPLE_PROMPTS.map((g) => g.audience)).toEqual(["Beginners", "Designers", "Engineers"]);
    for (const group of EXAMPLE_PROMPTS) expect(group.prompts.length).toBeGreaterThan(0);
  });
});
