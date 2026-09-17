import { describe, expect, it } from "vitest";
import { claudeCodeCommand, claudeDesktopConfig, claudeDesktopConfigPath, EXAMPLE_PROMPTS, joinRepoPath, mcpLaunchSpec, parseMcpStatus, repoPathFromDevUrl, shellForPlatform, shellQuote, tildePath } from "./connectInfo.ts";

describe("parseMcpStatus", () => {
  it("accepts the host's status shape", () => {
    const cliPath = "/Applications/Sonobe.app/Contents/Resources/cli/sonobe";
    expect(parseMcpStatus({ running: true, port: 52817, url: "http://127.0.0.1:52817/mcp", tokenFile: "/Users/me/.sonobe/mcp.json", cliPath })).toEqual({ running: true, port: 52817, url: "http://127.0.0.1:52817/mcp", tokenFile: "/Users/me/.sonobe/mcp.json", cliPath });
    expect(parseMcpStatus({ running: false, port: null, url: null, tokenFile: "" })).toEqual({ running: false, port: null, url: null, tokenFile: null, cliPath: null });
    expect(parseMcpStatus({ running: false, port: null, url: null, tokenFile: "", cliPath: " " })?.cliPath).toBeNull();
  });

  it("rejects anything else", () => {
    expect(parseMcpStatus(null)).toBeNull();
    expect(parseMcpStatus("running")).toBeNull();
    expect(parseMcpStatus({ port: 1 })).toBeNull();
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
  it("runs a checkout with node", () => {
    const spec = mcpLaunchSpec({ mode: "checkout", nodePath: "/opt/homebrew/bin/node", repoPath: "/Users/me/sonobe" });
    expect(spec).toEqual({ command: "/opt/homebrew/bin/node", args: ["/Users/me/sonobe/packages/cli/src/main.ts", "mcp"] });
    expect(claudeCodeCommand(spec)).toBe("claude mcp add sonobe -- /opt/homebrew/bin/node /Users/me/sonobe/packages/cli/src/main.ts mcp");
  });

  it("uses the app's bundled CLI by full path in production", () => {
    const cliPath = "/Applications/Sonobe.app/Contents/Resources/cli/sonobe";
    const spec = mcpLaunchSpec({ mode: "installed", cliPath });
    expect(claudeCodeCommand(spec)).toBe(`claude mcp add sonobe -- ${cliPath} mcp`);
    expect(JSON.parse(claudeDesktopConfig(spec))).toEqual({ mcpServers: { sonobe: { command: cliPath, args: ["mcp"] } } });
    const windows = mcpLaunchSpec({ mode: "installed", cliPath: "C:\\Program Files\\Sonobe\\resources\\cli\\sonobe.cmd" });
    expect(claudeCodeCommand(windows, "windows")).toBe('claude mcp add sonobe -- "C:\\Program Files\\Sonobe\\resources\\cli\\sonobe.cmd" mcp');
  });

  it("falls back to sonobe on PATH when the host has no bundled CLI", () => {
    const spec = mcpLaunchSpec({ mode: "installed", cliPath: null });
    expect(claudeCodeCommand(spec)).toBe("claude mcp add sonobe -- sonobe mcp");
    expect(JSON.parse(claudeDesktopConfig(spec))).toEqual({ mcpServers: { sonobe: { command: "sonobe", args: ["mcp"] } } });
  });

  it("serves a project headless and quotes paths with spaces", () => {
    const spec = mcpLaunchSpec({ mode: "checkout", repoPath: "/Users/me/sonobe", headlessProject: "/Users/me/Checkout Flow.sonobe" });
    expect(claudeCodeCommand(spec)).toBe("claude mcp add sonobe -- node /Users/me/sonobe/packages/cli/src/main.ts mcp --headless '/Users/me/Checkout Flow.sonobe'");
    expect(mcpLaunchSpec({ mode: "checkout", nodePath: " ", repoPath: "" })).toEqual({ command: "node", args: ["/path/to/sonobe/packages/cli/src/main.ts", "mcp"] });
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
