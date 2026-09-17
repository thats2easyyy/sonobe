/**
 * Connect Claude helpers: MCP status parsing, the launch command for `sonobe mcp` (a repo checkout in
 * development, the installed CLI in production), the Claude Code command, the Claude Desktop config
 * snippet and its file location, shell quoting, and example prompts.
 */

export interface McpStatusInfo {
  running: boolean;
  port: number | null;
  /** e.g. "http://127.0.0.1:52817/mcp" */
  url: string | null;
  /** Path of ~/.sonobe/mcp.json. */
  tokenFile: string | null;
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
  };
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
  /** "checkout": run the CLI from a repo with node. "installed": the `sonobe` command. */
  mode: LaunchMode;
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
  if (options.mode === "installed") return { command: "sonobe", args: tail };
  const repo = options.repoPath?.trim() || "/path/to/sonobe";
  return { command: options.nodePath?.trim() || "node", args: [joinRepoPath(repo, CLI_ENTRY), ...tail] };
}

/** `claude mcp add sonobe -- <command> <args…>` */
export function claudeCodeCommand(spec: LaunchSpec, shell: ShellFlavor = "posix"): string {
  return ["claude", "mcp", "add", "sonobe", "--", spec.command, ...spec.args].map((part, i) => (i < 5 ? part : shellQuote(part, shell))).join(" ");
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
