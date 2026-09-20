// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_DESKTOP_BUILD_COMMANDS, claudeDesktopBundle } from "./buildInfo.ts";
import { ConnectClaudeDialog, type ConnectClaudeDialogProps, type ConnectHostLike } from "./ConnectClaudeDialog.tsx";

const build = vi.hoisted(() => ({ dev: false }));

vi.mock("./buildInfo.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./buildInfo.ts")>();
  return {
    ...actual,
    claudeDesktopBundle: (options: Parameters<typeof actual.claudeDesktopBundle>[0] = {}) => actual.claudeDesktopBundle({ dev: build.dev, ...options }),
    detectRepoPath: () => Promise.resolve(null),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP_CLI = "/Applications/Sonobe.app/Contents/Resources/cli/sonobe";
const RUNNING = { running: true, port: 52817, url: "http://127.0.0.1:52817/mcp", tokenFile: "/Users/me/.sonobe/mcp.json" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  build.dev = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  localStorage.clear();
});

const appHost = (status: Record<string, unknown>): ConnectHostLike => ({ platform: "darwin", getMcpStatus: () => Promise.resolve(status) });

/** Render the dialog, let the MCP status arrive, and return the text it shows. */
async function show(props: Omit<ConnectClaudeDialogProps, "open" | "onOpenChange">): Promise<string> {
  await act(async () => {
    root.render(<ConnectClaudeDialog open onOpenChange={() => {}} {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return document.body.textContent ?? "";
}

const session = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-aaaa-4bbb-8ccc-000000000001",
  label: "Claude Code",
  name: "claude-code",
  version: "2.1.278",
  folder: "/Users/me/workspace/noddit",
  via: "relay",
  state: "connected",
  connectedAt: Date.now() - 60_000,
  lastSeenAt: Date.now(),
  lastActivityAt: Date.now() - 12_000,
  lastTool: "get_outline",
  toolCalls: 3,
  relayVersion: "0.1.0",
  ...overrides,
});

describe("Connect Claude sessions", () => {
  it("says nothing is connected while the server only listens", async () => {
    const text = await show({ host: appHost({ ...RUNNING, clients: [], version: "0.1.0" }), initialTab: "code", defaults: { mode: "installed", platform: "darwin" } });
    expect(text).toContain("No Claude session is connected");
    expect(text).toContain("Sessions show up here once Claude starts Sonobe's server");
    expect(text).not.toContain("ready for Claude");
    expect(document.querySelector(".sb-connect__status")?.getAttribute("data-tone")).toBe("neutral");
  });

  it("lists connected sessions with their folder and last activity", async () => {
    const text = await show({ host: appHost({ ...RUNNING, clients: [session(), session({ id: "22222222-aaaa-4bbb-8ccc-000000000002", folder: "/Users/me/workspace/sonobe", state: "gone", lastTool: "finish_work" })], version: "0.1.0" }), defaults: { mode: "installed", platform: "darwin" } });
    expect(text).toContain("Claude Code is connected");
    expect(text).toContain("~/workspace/noddit");
    expect(text).toContain("Active 12 s ago · get_outline · 3 tool calls");
    expect(text).toContain("~/workspace/sonobe");
    expect(text).toContain("Disconnected");
    expect(text).toContain("Last active 12 s ago · finish_work");
    expect(document.querySelector(".sb-connect__status")?.getAttribute("data-tone")).toBe("success");
  });

  it("flags a session running an older relay, and explains clients without one", async () => {
    const text = await show({ host: appHost({ ...RUNNING, clients: [session({ relayVersion: "0.0.9" }), session({ id: "http", label: "Unidentified MCP client", name: null, version: null, folder: null, via: "http" })], version: "0.1.0" }), defaults: { mode: "installed", platform: "darwin" } });
    expect(text).toContain("2 sessions are connected");
    expect(text).toContain("Runs the relay from Sonobe 0.0.9, not this app's 0.1.0");
    expect(text).toContain("Unidentified MCP client");
    expect(text).toContain("Sonobe can't tell which session it is");
  });
});

describe("Connect Claude setup", () => {
  it("gives Claude Code the app's CLI by full path, for every project", async () => {
    const text = await show({ host: appHost({ ...RUNNING, cliPath: APP_CLI }), initialTab: "code", defaults: { mode: "installed", platform: "darwin" } });
    expect(text).toContain(`claude mcp add --scope user sonobe -- ${APP_CLI} mcp`);
    expect(text).toContain("Run this once in a terminal, from any folder");
    expect(text).toContain("Runs the CLI that comes with the Sonobe app");
    expect(text).toContain("claude mcp remove --scope user sonobe");
    expect(text).toContain("Earlier versions added Sonobe to one folder only");
    expect(text).toContain("claude mcp remove --scope local sonobe");
    expect(text).toContain("Start a new Claude Code session in any folder");
  });

  it("keeps a headless setup with the folder where Claude starts", async () => {
    const text = await show({ host: null, initialTab: "code", defaults: { mode: "checkout", platform: "darwin", repoPath: "/Users/me/sonobe", headlessProject: "/Users/me/Deck.sonobe" } });
    expect(text).toContain("claude mcp add --scope local sonobe-headless -- node /Users/me/sonobe/packages/cli/src/main.ts mcp --headless /Users/me/Deck.sonobe");
    expect(text).toContain("Run this in the folder where you start Claude");
    expect(text).not.toContain("Earlier versions added Sonobe");
  });

  it("leads Claude Desktop with the config, because the app ships no .mcpb", async () => {
    const text = await show({ host: appHost({ ...RUNNING, cliPath: APP_CLI }), initialTab: "desktop", defaults: { mode: "installed", platform: "darwin" } });
    expect(text).toContain("Add Sonobe to Claude Desktop's config");
    expect(text).toContain(`"command": "${APP_CLI}"`);
    expect(text).not.toContain(".mcpb");
    expect(text).not.toContain("Install in Claude Desktop");
  });

  it("warns that a bare sonobe needs a full path when the host reports no CLI", async () => {
    const text = await show({ host: appHost(RUNNING), initialTab: "desktop", defaults: { mode: "installed", platform: "darwin" } });
    expect(text).toContain('"command": "sonobe"');
    expect(text).toContain("replace sonobe with the command's full path");
    expect(text).toContain("npm link -w @sonobe/cli");
  });

  it("shows a source checkout how to build and pack the extension", async () => {
    build.dev = true;
    const text = await show({
      host: appHost({ ...RUNNING, cliPath: null }),
      initialTab: "desktop",
      defaults: { mode: "checkout", platform: "darwin", repoPath: "/Users/me/sonobe", nodePath: "/opt/homebrew/bin/node" },
    });
    expect(text).toContain("Build and install the Sonobe extension");
    expect(text).toContain("node integrations/claude-desktop/build.ts");
    expect(text).toContain("npx @anthropic-ai/mcpb pack integrations/claude-desktop/dist sonobe.mcpb");
    expect(text).toContain("Then open sonobe.mcpb");
    expect(text).toContain("Or add Sonobe by hand");
    expect(text).toContain('"command": "/opt/homebrew/bin/node"');
  });

  it("tells browser users that headless mode takes screenshots", async () => {
    const text = await show({ host: null, initialTab: "code", defaults: { mode: "checkout", platform: "darwin", repoPath: "/Users/me/sonobe" } });
    expect(text).toContain("takes approximate screenshots");
    expect(text).not.toContain("Screenshots need the desktop app");
  });
});

describe("claudeDesktopBundle", () => {
  it("offers the extension only to source checkouts", () => {
    const manifest = JSON.stringify({ name: "sonobe", display_name: "Sonobe" });
    expect(claudeDesktopBundle({ dev: false, manifest })).toBeNull();
    expect(claudeDesktopBundle({ dev: true, manifest: null })).toBeNull();
    expect(claudeDesktopBundle({ dev: true, manifest })).toEqual({ name: "Sonobe", folder: "integrations/claude-desktop", buildCommands: CLAUDE_DESKTOP_BUILD_COMMANDS, file: "sonobe.mcpb" });
  });

  it("uses the build commands the extension's README documents", () => {
    const readme = Object.values(import.meta.glob("../../../../../integrations/claude-desktop/README.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[0]!;
    for (const command of CLAUDE_DESKTOP_BUILD_COMMANDS.split("\n")) expect(readme).toContain(command);
  });
});
