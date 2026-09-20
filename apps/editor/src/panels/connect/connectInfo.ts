/**
 * Connect Claude helpers: MCP status parsing (with the connected sessions), the launch command for
 * `sonobe mcp` (a repo checkout in development, the app's bundled CLI in production), the Claude Code
 * install and remove commands, the Claude Desktop config snippet and its file location, shell quoting,
 * and example prompts.
 */

/** One MCP client session the app heard from (host-api.d.ts McpClientSession). */
export interface McpSessionInfo {
  id: string;
  /** "Claude Code", "Claude Desktop", the client's own name, or "Unidentified MCP client". */
  label: string;
  version: string | null;
  /** The session's project folder. */
  folder: string | null;
  /** relay: `sonobe mcp`. http: a client without the relay, which can't say which session it is. */
  via: "relay" | "http";
  state: "connected" | "idle" | "gone";
  connectedAt: number;
  lastActivityAt: number | null;
  lastTool: string | null;
  toolCalls: number;
  relayVersion: string | null;
}

export interface McpStatusInfo {
  running: boolean;
  port: number | null;
  /** e.g. "http://127.0.0.1:52817/mcp" */
  url: string | null;
  /** Path of ~/.sonobe/mcp.json. */
  tokenFile: string | null;
  /** The app's bundled CLI launcher ("/Applications/Sonobe.app/Contents/Resources/cli/sonobe"), or null. */
  cliPath: string | null;
  /** Sessions the app heard from recently, most recently active first. Empty from older hosts. */
  clients: McpSessionInfo[];
  /** When the host read `clients` (epoch ms), or null from older hosts. */
  checkedAt: number | null;
  /** The app's version, or null from older hosts. */
  version: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const time = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One session row, or null when it's malformed (dropped, so one bad row never hides the rest). */
function parseSession(value: unknown): McpSessionInfo | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const connectedAt = time(v.connectedAt);
  if (!text(v.id) || !text(v.label) || connectedAt === null) return null;
  if (v.via !== "relay" && v.via !== "http") return null;
  if (v.state !== "connected" && v.state !== "idle" && v.state !== "gone") return null;
  return {
    id: v.id as string,
    label: v.label as string,
    version: text(v.version),
    folder: text(v.folder),
    via: v.via,
    state: v.state,
    connectedAt,
    lastActivityAt: time(v.lastActivityAt),
    lastTool: text(v.lastTool),
    toolCalls: typeof v.toolCalls === "number" && Number.isInteger(v.toolCalls) && v.toolCalls >= 0 ? v.toolCalls : 0,
    relayVersion: text(v.relayVersion),
  };
}

/** Validate what `sonobeHost.getMcpStatus()` resolved (it crosses a context bridge as unknown). */
export function parseMcpStatus(value: unknown): McpStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.running !== "boolean") return null;
  return {
    running: v.running,
    port: typeof v.port === "number" && Number.isFinite(v.port) ? v.port : null,
    url: typeof v.url === "string" && v.url ? v.url : null,
    tokenFile: typeof v.tokenFile === "string" && v.tokenFile ? v.tokenFile : null,
    cliPath: typeof v.cliPath === "string" && v.cliPath.trim() ? v.cliPath : null,
    clients: Array.isArray(v.clients) ? v.clients.map(parseSession).filter((c): c is McpSessionInfo => c !== null) : [],
    checkedAt: time(v.checkedAt),
    version: text(v.version),
  };
}

/** Sessions connected right now (a green dot), most recently active first. */
export function connectedSessions(status: McpStatusInfo | null): McpSessionInfo[] {
  return status?.running ? status.clients.filter((c) => c.state === "connected") : [];
}

/** "just now", "12 s ago", "4 min ago", "2 h ago". */
export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** The last path segment of a folder ("/Users/me/placemark" → "placemark"). */
export function folderName(folder: string): string {
  return folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder;
}

/** "Claude Code · placemark · active 12 s ago": one line per session, for tooltips. */
export function sessionSummary(session: McpSessionInfo, now: number): string {
  const when = session.lastActivityAt !== null ? `active ${relativeTime(session.lastActivityAt, now)}` : `connected ${relativeTime(session.connectedAt, now)}`;
  return [session.label, session.folder ? folderName(session.folder) : null, when].filter(Boolean).join(" · ");
}

export type ShellFlavor = "posix" | "windows";

export function shellForPlatform(platform: string): ShellFlavor {
  return platform === "win32" || /^win/i.test(platform) ? "windows" : "posix";
}

/** Quote one argument for a POSIX shell or Windows (cmd/PowerShell). Simple words stay bare. */
export function shellQuote(arg: string, shell: ShellFlavor): string {
  if (arg === "") return shell === "posix" ? "''" : '""';
  if (shell === "posix") return /^[A-Za-z0-9_/.:=@%+,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
  return /^[A-Za-z0-9_/\\.:=@%+,-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

/** Join a repo path and a POSIX relative path, keeping Windows separators when the repo uses them. */
export function joinRepoPath(repoPath: string, relative: string): string {
  const windows = /^[A-Za-z]:\\/.test(repoPath) || (repoPath.includes("\\") && !repoPath.includes("/"));
  const base = repoPath.replace(/[\\/]+$/, "");
  return windows ? `${base}\\${relative.replace(/\//g, "\\")}` : `${base}/${relative}`;
}

export const CLI_ENTRY = "packages/cli/src/main.ts";

export type LaunchMode = "checkout" | "installed";

export interface LaunchOptions {
  /** "checkout": run the CLI from a repo with node. "installed": the app's bundled CLI (`cliPath`), else `sonobe` on PATH. */
  mode: LaunchMode;
  /**
   * Installed mode: the full path of the app's CLI launcher. Claude Desktop doesn't read the shell's
   * PATH, so a bare `sonobe` only works after `npm link -w @sonobe/cli` and only in a terminal.
   */
  cliPath?: string | null;
  /** Node executable for checkout mode. Default "node". */
  nodePath?: string;
  /** Repo root for checkout mode. */
  repoPath?: string;
  /** Serve this project folder without the app (`--headless`). */
  headlessProject?: string;
}

export interface LaunchSpec {
  command: string;
  args: string[];
}

/** The process Claude should launch for Sonobe's MCP relay (or headless server). */
export function mcpLaunchSpec(options: LaunchOptions): LaunchSpec {
  const tail = ["mcp", ...(options.headlessProject ? ["--headless", options.headlessProject] : [])];
  if (options.mode === "installed") return { command: options.cliPath?.trim() || "sonobe", args: tail };
  const repo = options.repoPath?.trim() || "/path/to/sonobe";
  return { command: options.nodePath?.trim() || "node", args: [joinRepoPath(repo, CLI_ENTRY), ...tail] };
}

/** Claude Code config scopes: user (every project), local (this project only, the default of `claude mcp add`). */
export type ClaudeCodeScope = "user" | "local";

/** Headless servers work on one prototype folder, so they stay with one project; the relay serves every project. */
export function isHeadlessSpec(spec: LaunchSpec): boolean {
  return spec.args.includes("--headless");
}

/**
 * `claude mcp add --scope user sonobe -- <command> <args…>`. The relay installs at user scope, so every
 * Claude Code session gets Sonobe's tools whatever folder it starts in; a headless server installs at
 * local scope as `sonobe-headless`.
 */
export function claudeCodeCommand(spec: LaunchSpec, shell: ShellFlavor = "posix", options: { scope?: ClaudeCodeScope; name?: string } = {}): string {
  const headless = isHeadlessSpec(spec);
  const scope = options.scope ?? (headless ? "local" : "user");
  const name = options.name ?? (headless ? "sonobe-headless" : "sonobe");
  const prefix = ["claude", "mcp", "add", "--scope", scope, name, "--"];
  return [...prefix, ...[spec.command, ...spec.args].map((part) => shellQuote(part, shell))].join(" ");
}

/** `claude mcp remove --scope local sonobe`: drop one entry, like an older per-folder one that shadows the user entry. */
export function claudeCodeRemoveCommand(scope: ClaudeCodeScope, name = "sonobe"): string {
  return `claude mcp remove --scope ${scope} ${name}`;
}

/** The `mcpServers` entry for claude_desktop_config.json. */
export function claudeDesktopConfig(spec: LaunchSpec): string {
  return JSON.stringify({ mcpServers: { sonobe: { command: spec.command, args: spec.args } } }, null, 2);
}

/** Where Claude Desktop keeps its config on this platform, or null when unknown. */
export function claudeDesktopConfigPath(platform: string): string | null {
  if (platform === "darwin" || /mac/i.test(platform)) return "~/Library/Application Support/Claude/claude_desktop_config.json";
  if (shellForPlatform(platform) === "windows") return "%APPDATA%\\Claude\\claude_desktop_config.json";
  return null;
}

/**
 * The repo root from the dev server URL of a file inside it: "/@fs/Users/me/sonobe/packages/cli/src/main.ts"
 * → "/Users/me/sonobe"; "/@fs/C:/dev/sonobe/packages/…" → "C:\\dev\\sonobe". Null for any other URL.
 */
export function repoPathFromDevUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const clean = decodeURIComponent(url.replace(/[?#].*$/, ""));
  const match = /^(?:https?:\/\/[^/]+)?\/@fs(\/.*)$/.exec(clean);
  if (!match) return null;
  const path = match[1]!;
  const suffix = `/${CLI_ENTRY}`;
  if (!path.endsWith(suffix)) return null;
  const root = path.slice(0, -suffix.length);
  const drive = /^\/([A-Za-z]:)(\/.*)?$/.exec(root);
  if (drive) return `${drive[1]}${(drive[2] ?? "").replace(/\//g, "\\")}` || `${drive[1]}\\`;
  return root || "/";
}

/** The home-relative form of a path under the user's home ("/Users/me/.sonobe/mcp.json" → "~/.sonobe/mcp.json"). */
export function tildePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, "~");
}

export interface PromptGroup {
  audience: string;
  description: string;
  prompts: string[];
}

/** Starter prompts, from "never prototyped" to engineers checking numbers. */
export const EXAMPLE_PROMPTS: readonly PromptGroup[] = [
  {
    audience: "Beginners",
    description: "Learn while Claude builds",
    prompts: [
      "Make a card that grows a little when I tap it. Add one patch at a time and tell me what each one does.",
      "Explain this prototype as if I've never used a patch editor.",
      "Don't build it for me. Tell me the next single step, wait until I say done, then check my work.",
    ],
  },
  {
    audience: "Designers",
    description: "Describe the feel, not the wiring",
    prompts: [
      "Build a bottom sheet I can drag down to dismiss. Hand the finger's velocity to the spring when I let go.",
      "Turn this into three tabs with an underline that slides. Name each patch by its effect.",
      "The like button feels mushy. Make it snappy with a tiny bounce, then show me the numbers you changed.",
      "Import the profile screen from my app (localhost:3000/profile) into Sonobe, then make the Follow button bounce when I tap it.",
    ],
  },
  {
    audience: "Engineers",
    description: "Prove it with simulations",
    prompts: [
      "Tap @card, step 60 frames, and confirm @card.scale ends at 1.08 with less than 2% overshoot. Report the settle time.",
      "Give me SwiftUI and Jetpack Compose handoff code for every spring in this file, as a table.",
      "Find patches with no path to any layer. List them before you delete anything.",
    ],
  },
];
