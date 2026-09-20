/**
 * Open in Claude Code: the Design with Claude box's hand-off for people who use their Claude plan
 * instead of an API key. Main writes a one-time zsh script and opens it in Terminal, which runs the
 * person's own `claude` in their app's folder with the prompt they wrote. They see and drive that
 * session; Sonobe never runs Claude headlessly and never reads its output or credentials
 * (ARCHITECTURE §10). The script passes the app's relay as `sonobe` with `--mcp-config`, for that
 * session only, so the person's Claude settings don't change. When their organization manages Claude
 * Code's MCP servers, which refuses that, the session gets the organization's own servers instead.
 *
 * Electron-free: main injects shell.openPath, the folder dialog and the relay's launch spec.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CodeFolderError, type CodeFolderKey, type CodeFolderStore } from "./assistant/codeFolder.ts";
import type { HandoffRequest, HandoffResult } from "./assistant/protocol.ts";

export type { HandoffRequest, HandoffResult };

/** The longest prompt the hand-off passes on. */
export const HANDOFF_PROMPT_LIMIT = 20_000;
/** Scripts Terminal never ran (the person opens .command files with another app) go after a day. */
const STALE_SCRIPT_MS = 24 * 60 * 60 * 1000;

export const HANDOFF_NOT_MAC = "Open in Claude Code works on macOS for now. Copy the prompt instead, and paste it into Claude Code in your app's folder.";

/**
 * Claude Code's managed MCP config on macOS, where an organization lists the only MCP servers its
 * sessions load. While it's there, Claude Code 2.1 refuses `--mcp-config` at startup, or ignores it
 * when the file doesn't parse; the path has no override.
 */
export const MANAGED_MCP_CONFIG = "/Library/Application Support/ClaudeCode/managed-mcp.json";

/** The managed MCP config: null when there's none, else whether it lists a server named `sonobe`. */
export type ManagedMcp = { sonobe: boolean } | null;

/** What the terminal says before the session when the organization's servers don't include Sonobe's. */
export const MANAGED_WITHOUT_SONOBE = `Your organization manages Claude Code's MCP servers (${MANAGED_MCP_CONFIG}), and Sonobe's isn't one of them, so this session can't reach your canvas. Ask your admin to add a server named sonobe that runs Sonobe's \`sonobe mcp\`, then try Open in Claude Code again.`;

/** The MCP server the session gets as `sonobe`: the app's relay, as Connect Claude launches it. */
export interface HandoffServer {
  command: string;
  args: string[];
}

/** Where the session opens: the folder (`root`, and `path` with home as "~"), or why there's none. */
export type HandoffFolder = { root: string; path: string } | { cancelled: true } | { error: string };

export interface HandoffOptions {
  /** process.platform. */
  platform: string;
  /** Where scripts are written: <userData>/handoff. */
  dir: string;
  folder(): Promise<HandoffFolder>;
  server(): HandoffServer;
  /** Electron's shell.openPath: "" when the file opened, else why it didn't. */
  openPath(file: string): Promise<string>;
  now?(): number;
  /** The script's file name without ".command" (default: 16 random bytes in hex). */
  name?(): string;
  /** Claude Code's managed MCP config (default: readManagedMcp()). */
  managedMcp?(): Promise<ManagedMcp>;
}

/**
 * Read the managed MCP config as Claude Code counts it: a file it can't stat (it isn't there, or a
 * folder above it can't be searched) is none, and one it can't read or parse lists no servers.
 */
export async function readManagedMcp(file = MANAGED_MCP_CONFIG): Promise<ManagedMcp> {
  if (!(await stat(file).catch(() => null))) return null;
  try {
    const servers: unknown = (JSON.parse(await readFile(file, "utf8")) as { mcpServers?: unknown } | null)?.mcpServers;
    return { sonobe: typeof servers === "object" && servers !== null && Object.hasOwn(servers, "sonobe") };
  } catch {
    return { sonobe: false };
  }
}

/** A zsh word that is exactly `value`: single-quoted, with each `'` as `'\''`. NUL can't be passed in an argument, so it's refused. */
export function shellQuote(value: string): string {
  if (value.includes("\0")) throw new Error("A shell argument can't hold a NUL character.");
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** `{"mcpServers":{"sonobe":{…}}}` for `claude --mcp-config`. */
export function handoffMcpConfig(server: HandoffServer): string {
  return JSON.stringify({ mcpServers: { sonobe: { command: server.command, args: server.args } } });
}

/**
 * The one-time Terminal script (`display`: the folder as its error names it, like "~/code/noddit").
 * `claude` takes its prompt after `--`: `--mcp-config <configs...>` takes every argument after it,
 * and without `--` a prompt starting with "-" is refused as an unknown option.
 *
 * The script always passes Sonobe's relay, without asking `claude mcp get sonobe` first. That exits 0
 * for any server of the name, even one in the folder's own .mcp.json that is pending approval or was
 * rejected, so a cloned repo could stand in for the relay or leave the session without it. A
 * `--mcp-config` server replaces a user, local or project server of the same name for the session
 * (Claude Code 2.1 connects `{...configured, ...dynamic}`), so as `sonobe` the session has one relay,
 * the app's, even for people who added one with Connect Claude, and their saved `mcp__sonobe__*`
 * permissions still apply; under another name they'd get every tool twice. Claude Code still asks
 * about the folder's own `sonobe`, but approving it doesn't replace the app's relay in this session.
 *
 * With the organization's managed-mcp.json (`managed`), Claude Code won't start with `--mcp-config`,
 * and loads only the servers that file lists, never the folder's. So the script starts `claude`
 * without it: the session has the organization's `sonobe` if it lists one, and when it doesn't, the
 * terminal says so first.
 */
export function buildHandoffScript(o: { folder: string; prompt: string; mcpConfig: string; display?: string; managed?: ManagedMcp }): string {
  const folder = shellQuote(o.folder);
  const prompt = shellQuote(o.prompt);
  const session = o.managed
    ? [...(o.managed.sonobe ? [] : [`print -r -- ${shellQuote(MANAGED_WITHOUT_SONOBE)}`]), `exec claude -- ${prompt}`]
    : [`exec claude --mcp-config ${shellQuote(o.mcpConfig)} -- ${prompt}`];
  return [
    "#!/bin/zsh -l",
    "# Sonobe's Open in Claude Code. It deletes itself as it starts.",
    'rm -f -- "$0"',
    `cd -- ${folder} || { print -r -- ${shellQuote(`Sonobe couldn't open ${o.display ?? o.folder}. Check that it's still there, then try Open in Claude Code again.`)}; exit 1; }`,
    "if ! command -v claude >/dev/null 2>&1; then",
    `  print -r -- ${shellQuote("Claude Code isn't installed, or isn't on your PATH. Install it from https://claude.com/claude-code, then try Open in Claude Code again.")}`,
    "  exit 1",
    "fi",
    ...session,
    "",
  ].join("\n");
}

/** The prompt, or why it can't go to Claude Code. */
function checkPrompt(request: unknown): { prompt: string } | { error: string } {
  const prompt = request && typeof request === "object" ? (request as Partial<HandoffRequest>).prompt : undefined;
  if (typeof prompt !== "string" || !prompt.trim()) return { error: "There's no request to hand to Claude Code yet. Describe the screen in the box first." };
  if (prompt.length > HANDOFF_PROMPT_LIMIT) return { error: `The prompt is over ${HANDOFF_PROMPT_LIMIT.toLocaleString("en-US")} characters, too long to hand to Claude Code. Shorten the request, or copy the prompt instead.` };
  if (prompt.includes("\0")) return { error: "The prompt has a NUL character, which Terminal can't pass on. Remove it and try again." };
  // `claude -- update` still runs the update command: a prompt that is one word could name one.
  if (!/\s/.test(prompt)) return { error: "A one-word prompt could be one of Claude Code's own commands, like “update”. Describe the screen in a few words." };
  return { prompt };
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Delete scripts older than a day that Terminal never ran (and so never deleted). */
async function pruneScripts(dir: string, now: number): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith(".command"))) {
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => null);
    if (info && now - info.mtimeMs > STALE_SCRIPT_MS) await rm(file, { force: true }).catch(() => undefined);
  }
}

/** Where a one-time Terminal script goes and how it's opened (HandoffOptions has the same fields). */
export interface TerminalScriptOptions {
  /** <userData>/handoff. */
  dir: string;
  /** Electron's shell.openPath: "" when the file opened, else why it didn't. */
  openPath(file: string): Promise<string>;
  now?(): number;
  /** The script's file name without ".command" (default: 16 random bytes in hex). */
  name?(): string;
}

/**
 * Write a one-time `.command` script into `options.dir` (0700, clearing day-old ones Terminal never
 * ran) and open it in Terminal. The script deletes itself as it starts; one Terminal didn't open is
 * removed here. Resolves with teaching errors (also used by Sign in to Claude, ./assistant/acp/signIn.ts).
 */
export async function openTerminalScript(script: string, options: TerminalScriptOptions): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = path.join(options.dir, `${options.name?.() ?? randomBytes(16).toString("hex")}.command`);
  try {
    await mkdir(options.dir, { recursive: true, mode: 0o700 });
    await pruneScripts(options.dir, (options.now ?? Date.now)());
    await writeFile(file, script, { mode: 0o700, flag: "wx" });
    await chmod(file, 0o700);
  } catch (err) {
    await rm(file, { force: true }).catch(() => undefined);
    return { ok: false, error: `Sonobe couldn't write the script for Terminal: ${messageOf(err)}` };
  }
  const failed = await options.openPath(file).catch((err: unknown) => messageOf(err) || "it gave no reason");
  if (failed) {
    await rm(file, { force: true }).catch(() => undefined);
    return { ok: false, error: `Terminal didn't open: ${failed}` };
  }
  return { ok: true };
}

/** Write the script for `request` into `options.dir` and open it in Terminal. Resolves with teaching errors; never rejects for expected failures. */
export async function openInClaudeCode(request: unknown, options: HandoffOptions): Promise<HandoffResult> {
  if (options.platform !== "darwin") return { ok: false, error: HANDOFF_NOT_MAC };
  const checked = checkPrompt(request);
  if ("error" in checked) return { ok: false, error: checked.error };
  const folder = await options.folder();
  if ("cancelled" in folder) return { ok: false, cancelled: true };
  if ("error" in folder) return { ok: false, error: folder.error };

  const managed = options.managedMcp ? await options.managedMcp() : await readManagedMcp();
  const script = buildHandoffScript({ folder: folder.root, display: folder.path, prompt: checked.prompt, mcpConfig: handoffMcpConfig(options.server()), managed });
  const opened = await openTerminalScript(script, options);
  if (!opened.ok) return opened;
  return managed && !managed.sonobe ? { ok: true, folder: folder.path, withoutSonobe: true } : { ok: true, folder: folder.path };
}

/**
 * The folder linked to the window's prototype. When none is linked, or it's missing, the one the
 * person picks now in the Match Your Code dialog, linked the same way (so Match my code… and Open in
 * Claude Code share it, and the same folders are refused).
 */
export async function handoffFolder(store: CodeFolderStore, key: CodeFolderKey, pick: () => Promise<string | null>): Promise<HandoffFolder> {
  const linked = async (): Promise<HandoffFolder | null> => {
    const status = await store.status(key);
    const grant = status.linked && !status.missing ? await store.get(key) : null;
    return grant && status.linked ? { root: grant.root, path: status.linked.path } : null;
  };
  const current = await linked();
  if (current) return current;
  const picked = await pick();
  if (picked === null) return { cancelled: true };
  try {
    await store.link(key, picked);
  } catch (err) {
    if (err instanceof CodeFolderError) return { error: err.message };
    throw err;
  }
  return (await linked()) ?? { error: "Sonobe couldn't link that folder. Choose Match my code… to try again." };
}
