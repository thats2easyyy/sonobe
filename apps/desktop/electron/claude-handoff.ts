/**
 * Open in Claude Code: the Design with Claude box's hand-off for people who use their Claude plan
 * instead of an API key. Main writes a one-time zsh script and opens it in Terminal, which runs the
 * person's own `claude` in their app's folder with the prompt they wrote. They see and drive that
 * session; Sonobe never runs Claude headlessly and never reads its output or credentials
 * (ARCHITECTURE §10). When no `sonobe` server is configured for that folder, the script passes the
 * app's relay with `--mcp-config` for that session only, so the person's Claude settings don't change.
 *
 * Electron-free: main injects shell.openPath, the folder dialog and the relay's launch spec.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CodeFolderError, type CodeFolderKey, type CodeFolderStore } from "./assistant/codeFolder.ts";
import type { HandoffRequest, HandoffResult } from "./assistant/protocol.ts";

export type { HandoffRequest, HandoffResult };

/** The longest prompt the hand-off passes on. */
export const HANDOFF_PROMPT_LIMIT = 20_000;
/** Scripts Terminal never ran (the person opens .command files with another app) go after a day. */
const STALE_SCRIPT_MS = 24 * 60 * 60 * 1000;

export const HANDOFF_NOT_MAC = "Open in Claude Code works on macOS for now. Copy the prompt instead, and paste it into Claude Code in your app's folder.";

/** The MCP server a session gets when its folder has none named `sonobe`: the app's relay, as Connect Claude launches it. */
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
 */
export function buildHandoffScript(o: { folder: string; prompt: string; mcpConfig: string; display?: string }): string {
  const folder = shellQuote(o.folder);
  const prompt = shellQuote(o.prompt);
  return [
    "#!/bin/zsh -l",
    "# Sonobe's Open in Claude Code. It deletes itself as it starts.",
    'rm -f -- "$0"',
    `cd -- ${folder} || { print -r -- ${shellQuote(`Sonobe couldn't open ${o.display ?? o.folder}. Check that it's still there, then try Open in Claude Code again.`)}; exit 1; }`,
    "if ! command -v claude >/dev/null 2>&1; then",
    `  print -r -- ${shellQuote("Claude Code isn't installed, or isn't on your PATH. Install it from https://claude.com/claude-code, then try Open in Claude Code again.")}`,
    "  exit 1",
    "fi",
    // `claude mcp get` exits 1 when the folder has no server by that name.
    `if claude mcp get sonobe >/dev/null 2>&1; then exec claude -- ${prompt}; fi`,
    `exec claude --mcp-config ${shellQuote(o.mcpConfig)} -- ${prompt}`,
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

/** Write the script for `request` into `options.dir` and open it in Terminal. Resolves with teaching errors; never rejects for expected failures. */
export async function openInClaudeCode(request: unknown, options: HandoffOptions): Promise<HandoffResult> {
  if (options.platform !== "darwin") return { ok: false, error: HANDOFF_NOT_MAC };
  const checked = checkPrompt(request);
  if ("error" in checked) return { ok: false, error: checked.error };
  const folder = await options.folder();
  if ("cancelled" in folder) return { ok: false, cancelled: true };
  if ("error" in folder) return { ok: false, error: folder.error };

  const script = buildHandoffScript({ folder: folder.root, display: folder.path, prompt: checked.prompt, mcpConfig: handoffMcpConfig(options.server()) });
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
  return { ok: true, folder: folder.path };
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
