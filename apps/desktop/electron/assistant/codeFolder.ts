/**
 * Code folders: the app folder a person links to a prototype (Match my code…, a native dialog in the
 * main process), and the Assistant's three read-only tools over it (list_code_files, search_code,
 * read_code_file). The link is kept in the app's data, keyed by project path, or held for the
 * window's session when the prototype is unsaved; never in the document. The tools are the
 * Assistant's own, not MCP tools. Electron-free.
 *
 * The tools stay inside the folder (paths are checked after resolving links, and walks never follow a
 * linked folder), skip hidden folders, dependencies and build output, refuse files that may hold
 * secrets, binaries and big files, redact key-shaped text, and cap what one call, one reply and one
 * chat read. Everything they return is sent to Anthropic's API as a tool result.
 */

import type { Stats } from "node:fs";
import { constants as fsConstants, realpath as realpathCallback } from "node:fs";
import { open, opendir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { didYouMean, didYouMeanText } from "@sonobe/core";
import { atomicWriteFile, readJsonFile } from "../fs-utils.ts";
import type { AssistantCodeFolderStatus } from "./protocol.ts";
import type { AssistantToolInfo, LocalTools, LocalToolScope, ToolCallResult } from "./toolBridge.ts";

export interface CodeFolderKey { projectPath: string | null; windowId: string }
export interface CodeFolderGrant { root: string; name: string; dev: number; ino: number; linkedAt: number; persisted: boolean }
export type CodeFolderErrorCode = "not_a_folder" | "too_broad" | "unreadable" | "missing" | "not_linked" | "bad_path" | "outside" | "secret_file" | "binary" | "too_large" | "budget" | "timeout";

/** Why a folder couldn't be linked or read, in words for the person (link) or for Claude (tools). */
export class CodeFolderError extends Error {
  readonly code: CodeFolderErrorCode;
  readonly hint?: string;

  constructor(code: CodeFolderErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "CodeFolderError";
    this.code = code;
    this.hint = hint;
  }
}

export interface CodeFolderStore {
  get(key: CodeFolderKey): Promise<CodeFolderGrant | null>;
  status(key: CodeFolderKey): Promise<AssistantCodeFolderStatus>;
  /** Validates and links; persisted when key.projectPath is set, else for the window only. Throws CodeFolderError. */
  link(key: CodeFolderKey, folder: string): Promise<AssistantCodeFolderStatus>;
  unlink(key: CodeFolderKey): Promise<AssistantCodeFolderStatus>;
  forgetWindow(windowId: string): void;
}

/** The operating system's realpath (fs.realpath.native), which resolves every link and the path's real case. */
const realpathNative = (target: string): Promise<string> => promisify(realpathCallback.native)(target);

// ---------------------------------------------------------------------------------------------------
// The store

/** Links remembered for saved projects; the oldest go first. */
export const MAX_CODE_FOLDER_LINKS = 200;

interface StoredLink { root: string; name: string; dev: number; ino: number; linkedAt: number }
interface CodeFoldersFile { version: 1; links: Record<string, StoredLink> }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function storedLink(value: unknown): StoredLink | null {
  if (!isRecord(value)) return null;
  const { root, name, dev, ino, linkedAt } = value;
  if (typeof root !== "string" || !path.isAbsolute(root) || path.parse(root).root === root || typeof name !== "string") return null;
  if (!isCount(dev) || !isCount(ino) || !isCount(linkedAt)) return null;
  return { root, name, dev, ino, linkedAt };
}

/** The key a project's link is kept under, or null for an unsaved prototype. */
function projectKey(projectPath: string | null): string | null {
  return typeof projectPath === "string" && path.isAbsolute(projectPath) ? path.resolve(projectPath) : null;
}

/** `child` is `parent` or inside it. */
function isWithin(parent: string, child: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

const notAFolder = () => new CodeFolderError("not_a_folder", "That isn't a folder.");
const unreadableFolder = () => new CodeFolderError("unreadable", "Sonobe can't read that folder. Check that your user account can open it.");
const isPermissionError = (err: unknown) => ["EACCES", "EPERM"].includes((err as NodeJS.ErrnoException)?.code ?? "");

async function sameFolder(link: StoredLink): Promise<boolean> {
  try {
    const info = await stat(link.root);
    return info.isDirectory() && info.dev === link.dev && info.ino === link.ino;
  } catch {
    return false;
  }
}

export function createCodeFolderStore(options: { file: string; home: string; now?: () => number }): CodeFolderStore {
  const now = options.now ?? Date.now;
  const windows = new Map<string, StoredLink>();
  let links: Map<string, StoredLink> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let homes: Promise<string[]> | null = null;

  /** Run file operations one at a time so concurrent links don't lose writes. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  /** Home as given and as it resolves (a temp or network home can sit behind a link). */
  const homeForms = (): Promise<string[]> =>
    (homes ??= (async () => {
      const given = path.resolve(options.home);
      const real = await realpathNative(given).catch(() => given);
      return [...new Set([given, real])];
    })());

  const load = async (): Promise<Map<string, StoredLink>> => {
    if (links) return links;
    const data = await readJsonFile(options.file);
    const raw = isRecord(data) && isRecord(data.links) ? data.links : {};
    links = new Map(
      Object.entries(raw).flatMap(([project, value]): [string, StoredLink][] => {
        const link = storedLink(value);
        return link && path.isAbsolute(project) ? [[path.resolve(project), link]] : [];
      }),
    );
    return links;
  };

  const save = async (next: Map<string, StoredLink>) => {
    const kept = [...next.entries()].sort((a, b) => b[1].linkedAt - a[1].linkedAt).slice(0, MAX_CODE_FOLDER_LINKS);
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const file: CodeFoldersFile = { version: 1, links: Object.fromEntries(kept) };
    await atomicWriteFile(options.file, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    links = new Map(kept);
  };

  const get = (key: CodeFolderKey): Promise<CodeFolderGrant | null> =>
    serial(async () => {
      const project = projectKey(key.projectPath);
      const windowLink = windows.get(key.windowId);
      if (!project) return windowLink ? { ...windowLink, persisted: false } : null;
      const current = await load();
      const link = current.get(project);
      if (link) return { ...link, persisted: true };
      if (!windowLink) return null;
      // The window's prototype was saved since the folder was linked: keep the link with the project now.
      try {
        await save(new Map(current).set(project, windowLink));
        windows.delete(key.windowId);
        return { ...windowLink, persisted: true };
      } catch {
        return { ...windowLink, persisted: false };
      }
    });

  const displayPath = async (root: string): Promise<string> => {
    for (const home of await homeForms()) {
      if (root === home) return "~";
      if (isWithin(home, root)) return `~${root.slice(home.length)}`;
    }
    return root;
  };

  const status = async (key: CodeFolderKey): Promise<AssistantCodeFolderStatus> => {
    const grant = await get(key);
    if (!grant) return { linked: null, missing: false };
    return { linked: { name: grant.name, path: await displayPath(grant.root), persisted: grant.persisted }, missing: !(await sameFolder(grant)) };
  };

  const validate = async (folder: unknown): Promise<StoredLink> => {
    if (typeof folder !== "string" || !folder || folder.includes("\0") || !path.isAbsolute(folder)) throw notAFolder();
    let root: string;
    let info: Stats;
    try {
      root = await realpathNative(folder);
      info = await stat(root);
    } catch (err) {
      throw isPermissionError(err) ? unreadableFolder() : notAFolder();
    }
    if (!info.isDirectory()) throw notAFolder();
    const broad = path.parse(root).root === root || (await homeForms()).some((home) => isWithin(root, home));
    if (broad) throw new CodeFolderError("too_broad", "Pick your app's folder, not your whole home folder.");
    try {
      const dir = await opendir(root);
      try {
        await dir.read();
      } finally {
        await dir.close().catch(() => undefined);
      }
    } catch {
      throw unreadableFolder();
    }
    return { root, name: path.basename(root), dev: info.dev, ino: info.ino, linkedAt: now() };
  };

  return {
    get,
    status,

    async link(key, folder) {
      const link = await validate(folder);
      const project = projectKey(key.projectPath);
      await serial(async () => {
        if (!project) {
          windows.set(key.windowId, link);
          return;
        }
        await save(new Map(await load()).set(project, link));
        windows.delete(key.windowId);
      });
      return status(key);
    },

    async unlink(key) {
      const project = projectKey(key.projectPath);
      await serial(async () => {
        windows.delete(key.windowId);
        if (!project) return;
        const current = await load();
        if (!current.has(project)) return;
        const next = new Map(current);
        next.delete(project);
        await save(next);
      });
      return status(key);
    },

    forgetWindow(windowId) {
      windows.delete(windowId);
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// What the tools skip, refuse and redact

/** Folders walks never enter (every dot-folder is skipped too). */
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", "Pods", "DerivedData", "dist", "build", ".next", ".gradle", ".venv"]);
/** Entries one walk looks at, at most. */
export const MAX_WALK_ENTRIES = 5_000;
/** read_code_file refuses bigger files; search_code skips files over SEARCH_MAX_BYTES. */
export const READ_MAX_BYTES = 2 * 1024 * 1024;
export const SEARCH_MAX_BYTES = 1024 * 1024;
/** A NUL byte this early means a binary file. */
const BINARY_SNIFF_BYTES = 8 * 1024;

const SECRET_FOLDERS = new Set([".ssh", ".aws", ".gnupg"]);
// key.properties and keystore.properties hold Android signing passwords; local.properties often holds API keys.
const SECRET_NAMES = new Set([".npmrc", ".netrc", ".pypirc", "googleservice-info.plist", "google-services.json", "key.properties", "keystore.properties", "local.properties"]);
const SECRET_PREFIXES = [".env", "id_rsa", "id_dsa", "id_ed25519", "id_ecdsa", "credentials"];
const SECRET_EXTENSIONS = [".pem", ".key", ".p8", ".p12", ".pfx", ".ppk", ".asc", ".kdbx", ".keystore", ".jks", ".mobileprovision", ".tfvars", ".tfvars.json", ".tfstate", ".tfstate.backup", ".sqlite", ".db"];
/** An env file by another name: "prod.env", "docker/app.env", "env". */
const ENV_FILE = /(^|[._-])env$/;

/** A file that may hold secrets (by name, ignoring case), given its path relative to the folder's top. */
export function isSecretPath(rel: string): boolean {
  const parts = rel.toLowerCase().split("/");
  const base = parts.at(-1) ?? "";
  if (parts.slice(0, -1).some((part) => SECRET_FOLDERS.has(part))) return true;
  return (
    SECRET_NAMES.has(base) ||
    SECRET_PREFIXES.some((prefix) => base.startsWith(prefix)) ||
    SECRET_EXTENSIONS.some((ext) => base.endsWith(ext)) ||
    ENV_FILE.test(base) ||
    base.includes("secret") ||
    (base.startsWith("service-account") && base.endsWith(".json"))
  );
}

const isHiddenPath = (rel: string) => rel.split("/").some((part) => part.startsWith("."));

const REDACTED = "[redacted]";
/** PEM and PGP private keys (an unfinished block runs to the end). Each line is redacted on its own, so line numbers hold. */
const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|[\s\S]*$)/g;
/**
 * Anthropic, OpenAI (project, service account, admin and legacy), AWS, GitHub (classic and
 * fine-grained), GitLab, Stripe secret and restricted, Slack and Google keys. The ones whose
 * prefix could end a word in CSS or code ("mask-", "desk_") need a word boundary before them.
 */
const KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /(?<![A-Za-z0-9_-])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,}/g,
  /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_])[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
];

/** Replace API keys, tokens and private keys with "[redacted]". */
export function redactSecrets(text: string): string {
  let out = text.replace(PEM_PRIVATE_KEY, (block) => block.replace(/[^\r\n]+/g, REDACTED));
  for (const pattern of KEY_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The tools

export const CODE_TOOL_NAMES = ["list_code_files", "search_code", "read_code_file"] as const;
type CodeToolName = (typeof CODE_TOOL_NAMES)[number];

interface FieldSpec {
  name: string;
  kind: "string" | "integer";
  description: string;
  required?: boolean;
  min?: number;
  max?: number;
  default?: number;
}

interface CodeToolSpec { name: CodeToolName; title: string; description: string; fields: FieldSpec[] }

const PATH_FIELD = (description: string, required = false): FieldSpec => ({ name: "path", kind: "string", description, ...(required ? { required } : {}) });
const PATTERN_FIELD = (description: string): FieldSpec => ({ name: "pattern", kind: "string", description, min: 1, max: 200 });

const CODE_TOOLS: readonly CodeToolSpec[] = [
  {
    name: "list_code_files",
    title: "List code files",
    description:
      "List files in the code folder the person linked to this prototype (their app's repo), to find theme, token and component files. Paths are relative to the folder's top. Hidden folders, node_modules, build output and files that may hold secrets are skipped. Read-only.",
    fields: [
      PATH_FIELD('A folder to list, relative to the code folder\'s top, like "src/theme". Default: the whole folder.'),
      PATTERN_FIELD('Only files whose name matches this glob, like "*.swift" or "**/*color*". A pattern with a "/" matches paths under `path`.'),
      { name: "maxResults", kind: "integer", description: "Most files to list (1–400, default 200).", min: 1, max: 400, default: 200 },
    ],
  },
  {
    name: "search_code",
    title: "Search code",
    description: 'Search the linked code folder\'s text files for a literal string (not a regex), like a color name or "accentColor". Returns path:line: text for each match.',
    fields: [
      { name: "query", kind: "string", description: 'The text to find, exactly as written (case-sensitive), like "accentColor" or "#8B5CF6".', required: true, min: 2, max: 200 },
      PATH_FIELD("Only search this folder or file, relative to the code folder's top."),
      PATTERN_FIELD('Only search files whose name matches this glob, like "*.css" or "**/theme/*".'),
      { name: "maxResults", kind: "integer", description: "Most matching lines to return (1–100, default 40).", min: 1, max: 100, default: 40 },
    ],
  },
  {
    name: "read_code_file",
    title: "Read code file",
    description:
      "Read a text file from the linked code folder, like a theme or token file. Returns up to 800 lines per call; pass offset to continue. Files that may hold secrets, binaries and files over 2 MB aren't read.",
    fields: [
      PATH_FIELD('The file to read, relative to the code folder\'s top, like "src/theme.ts".', true),
      { name: "offset", kind: "integer", description: "The line to start at (1 is the first line). To continue, pass the line after the last one you got.", min: 1 },
      { name: "limit", kind: "integer", description: "Most lines to return (1–2000, default 800).", min: 1, max: 2000, default: 800 },
    ],
  },
];

function inputSchema(spec: CodeToolSpec): Record<string, unknown> {
  const properties = Object.fromEntries(
    spec.fields.map((f) => [
      f.name,
      f.kind === "string"
        ? { type: "string", ...(f.min !== undefined ? { minLength: f.min } : {}), ...(f.max !== undefined ? { maxLength: f.max } : {}), description: f.description }
        : { type: "integer", ...(f.min !== undefined ? { minimum: f.min } : {}), ...(f.max !== undefined ? { maximum: f.max } : {}), ...(f.default !== undefined ? { default: f.default } : {}), description: f.description },
    ]),
  );
  const required = spec.fields.filter((f) => f.required).map((f) => f.name);
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

interface CodeToolArgs { path?: string; pattern?: string; maxResults?: number; query?: string; offset?: number; limit?: number }

/** The input, checked against the tool's closed shape, or a teaching error. */
function parseArgs(spec: CodeToolSpec, input: Record<string, unknown>): CodeToolArgs | CodeFolderError {
  const known = spec.fields.map((f) => f.name);
  const unknown = Object.keys(input).filter((key) => !known.includes(key));
  if (unknown.length) {
    const message =
      unknown.length === 1
        ? `${spec.name} has no field "${unknown[0]}".${didYouMeanText(didYouMean(unknown[0]!, known))}`
        : `${spec.name} has no fields ${unknown.map((key) => `"${key}"`).join(", ")}.`;
    return new CodeFolderError("bad_path", message, `${spec.name} takes: ${known.join(", ")}.`);
  }
  const args: Record<string, string | number> = {};
  for (const field of spec.fields) {
    const value = input[field.name];
    if (value === undefined || value === null) {
      if (field.required) return new CodeFolderError("bad_path", `${spec.name} needs "${field.name}". ${field.description}`);
      continue;
    }
    if (field.kind === "string") {
      const min = field.min ?? 0;
      const max = field.max ?? Infinity;
      if (typeof value !== "string" || value.length < min || value.length > max) {
        const size = field.max !== undefined ? ` of ${min} to ${max} characters` : "";
        return new CodeFolderError("bad_path", `${spec.name}'s "${field.name}" must be text${size}. ${field.description}`);
      }
    } else if (typeof value !== "number" || !Number.isInteger(value) || value < (field.min ?? -Infinity) || value > (field.max ?? Infinity)) {
      const range = field.max !== undefined ? `from ${field.min} to ${field.max}` : `of ${field.min} or more`;
      return new CodeFolderError("bad_path", `${spec.name}'s "${field.name}" must be a whole number ${range}. ${field.description}`);
    }
    args[field.name] = value;
  }
  return args as CodeToolArgs;
}

const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;
const chars = (count: number) => count.toLocaleString("en-US");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${Number((bytes / 1024 / 1024).toFixed(1))} MB`;
}

type GlobToken =
  | { kind: "char"; char: string }
  /** "?": one character, but not "/". */
  | { kind: "one" }
  /** "*" (within a folder) or "**" (across folders). */
  | { kind: "star"; slash: boolean }
  /** "**\/": nothing, or folders and their "/". */
  | { kind: "folders" }
  /** "{a,b}": any one of the alternatives. */
  | { kind: "either"; options: GlobToken[][] };

/** A glob's tokens, lowercased. A "{" with no "}" after it is literal, and so is every other character. */
function globTokens(text: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  // Stars in a row match what one does ("***" is "**"), so they're kept as one.
  const star = (slash: boolean) => {
    const last = tokens.at(-1);
    if (last?.kind === "star") last.slash ||= slash;
    else tokens.push({ kind: "star", slash });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "*" && text[i + 1] === "*") {
      i++;
      if (text[i + 1] === "/") {
        i++;
        tokens.push({ kind: "folders" });
      } else star(true);
    } else if (c === "*") star(false);
    else if (c === "?") tokens.push({ kind: "one" });
    else if (c === "{" && text.indexOf("}", i) > i) {
      const end = text.indexOf("}", i);
      tokens.push({ kind: "either", options: text.slice(i + 1, end).split(",").map(globTokens) });
      i = end;
    } else tokens.push({ kind: "char", char: c.toLowerCase() });
  }
  return tokens;
}

type GlobState =
  | { kind: "end" }
  | { kind: "char"; char: string; next: number }
  | { kind: "one"; next: number }
  /** Takes any number of characters (not "/" unless `slash`), then goes on to `next`. */
  | { kind: "star"; slash: boolean; next: number }
  /** Goes on to every state in `to` without taking a character. */
  | { kind: "split"; to: number[] };

/** Add `tokens`' states, each leading to the one after, the last to `next`; returns the first. */
function compileGlob(tokens: readonly GlobToken[], states: GlobState[], next: number): number {
  const add = (state: GlobState) => states.push(state) - 1;
  for (let t = tokens.length - 1; t >= 0; t--) {
    const token = tokens[t]!;
    if (token.kind === "char") next = add({ kind: "char", char: token.char, next });
    else if (token.kind === "one") next = add({ kind: "one", next });
    else if (token.kind === "star") next = add({ kind: "star", slash: token.slash, next });
    else if (token.kind === "folders") next = add({ kind: "split", to: [next, add({ kind: "star", slash: true, next: add({ kind: "char", char: "/", next }) })] });
    else {
      const after = next;
      next = add({ kind: "split", to: token.options.map((option) => compileGlob(option, states, after)) });
    }
  }
  return next;
}

/**
 * A glob ("*.swift", "**\/*color*", "*.{ts,tsx}") as a case-insensitive test of a "/" path: "*" and
 * "?" stay inside one folder, "**" crosses folders, "**\/" also matches nothing, and "{a,b}" is either.
 * It steps every place the pattern could be at once, one character at a time, so a test takes at most
 * (path length × pattern length) steps. A RegExp backtracks instead: "********************q" took
 * about 100 s against one long file name, synchronously in Electron's main process, where the
 * call's deadline can't stop it.
 */
export function globMatcher(glob: string): (path: string) => boolean {
  const END = 0;
  const states: GlobState[] = [{ kind: "end" }];
  const start = compileGlob(globTokens(glob), states, END);

  // Reused by every test (it runs synchronously): the states the pattern could be in now and after
  // this character, and the step each state was last entered in, so none is entered twice a step.
  let now = new Int32Array(states.length);
  let after = new Int32Array(states.length);
  const enteredAt = new Int32Array(states.length);
  const pending: number[] = [];
  let step = 0;
  return (path) => {
    if (step > 2 ** 30) {
      enteredAt.fill(0);
      step = 0;
    }
    let size = 0;
    let count = 0;
    /** List `first` for after this character, and what it goes on to without taking one: a split's targets, a star's next. */
    const enter = (first: number) => {
      pending.push(first);
      while (pending.length) {
        const s = pending.pop()!;
        if (enteredAt[s] === step) continue;
        enteredAt[s] = step;
        const state = states[s]!;
        if (state.kind === "split") pending.push(...state.to);
        else {
          after[count++] = s;
          if (state.kind === "star") pending.push(state.next);
        }
      }
    };
    const advance = () => {
      [now, after] = [after, now];
      size = count;
      count = 0;
    };
    step++;
    enter(start);
    advance();
    for (let i = 0; i < path.length && size; i++) {
      const c = path[i]!.toLowerCase();
      step++;
      for (let k = 0; k < size; k++) {
        const s = now[k]!;
        const state = states[s]!;
        if (state.kind === "char") {
          if (state.char === c) enter(state.next);
        } else if (state.kind === "one") {
          if (c !== "/") enter(state.next);
        } else if (state.kind === "star" && (state.slash || c !== "/")) enter(s);
      }
      advance();
    }
    // The end was entered in the last step, after the path's last character (not before it ran out of states).
    return enteredAt[END] === step;
  };
}

/** Matches a walked file: against its name, or with a "/" in the pattern, its path under the walk's start. */
function fileMatcher(pattern: string | undefined, start: string): ((rel: string) => boolean) | null {
  if (!pattern) return null;
  const matches = globMatcher(pattern);
  const byPath = pattern.includes("/");
  return (rel) => matches(byPath ? (start ? rel.slice(start.length + 1) : rel) : rel.slice(rel.lastIndexOf("/") + 1));
}

/** Stops a call: the deadline passed or the person pressed Stop. */
class CallStopped extends Error {
  readonly reason: "timeout" | "stopped";
  constructor(reason: "timeout" | "stopped") {
    super(reason);
    this.reason = reason;
  }
}

function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof CallStopped ? signal.reason : new CallStopped("stopped");
}

/** Run `work` until it finishes, `ms` pass, or `outer` aborts, whichever comes first. */
async function withDeadline<T>(ms: number, outer: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const stop = (reason: "timeout" | "stopped") => {
    if (!controller.signal.aborted) controller.abort(new CallStopped(reason));
  };
  const onAbort = () => stop("stopped");
  const timer = setTimeout(() => stop("timeout"), ms);
  outer.addEventListener("abort", onAbort, { once: true });
  if (outer.aborted) onAbort();
  const stopped = new Promise<never>((_, reject) => {
    const fire = () => reject(controller.signal.reason);
    if (controller.signal.aborted) fire();
    else controller.signal.addEventListener("abort", fire, { once: true });
  });
  try {
    return await Promise.race([work(controller.signal), stopped]);
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", onAbort);
  }
}

/** The linked folder, checked for this call. */
interface OpenFolder { root: string; name: string }

const toPosix = (rel: string) => rel.split(path.sep).join("/");
const absolute = (root: string, rel: string) => (rel ? path.join(root, ...rel.split("/")) : root);

const outsideError = (raw: string) => new CodeFolderError("outside", `“${raw}” is outside the linked folder. Paths are relative to its top, like “src/theme.ts”.`);
const secretError = (rel: string) => new CodeFolderError("secret_file", `Sonobe doesn't read “${rel}”: files like it can hold secrets. Look for theme or token files instead.`);
const hiddenError = (rel: string) => new CodeFolderError("secret_file", `Sonobe doesn't read hidden files or folders like “${rel}”: they can hold secrets. Look for theme or token files instead.`);

/** A path Claude passed, as a clean relative POSIX path ("" for the folder's top). */
function relativePath(raw: string | undefined): string {
  if (raw === undefined || raw === "" || raw === ".") return "";
  if (raw.includes("\0")) throw new CodeFolderError("bad_path", "That path has a NUL character in it. Paths are relative to the folder's top, like “src/theme.ts”.");
  if (raw.includes("\\")) throw new CodeFolderError("bad_path", `“${raw}” uses backslashes. Write paths with forward slashes, like “src/theme.ts”.`);
  if (raw.startsWith("/") || raw.startsWith("~") || /^[A-Za-z]:/.test(raw)) throw outsideError(raw);
  const normal = path.posix.normalize(raw).replace(/\/+$/, "");
  if (normal === ".." || normal.startsWith("../")) throw outsideError(raw);
  return normal === "." ? "" : normal;
}

/** Refuse a relative path that's hidden or may hold secrets. */
function checkReadable(rel: string): void {
  if (!rel) return;
  if (isSecretPath(rel)) throw secretError(rel);
  if (isHiddenPath(rel)) throw hiddenError(rel);
}

interface Resolved { rel: string; real: string; info: Stats }

/** Resolve a path inside the folder, following links only to places still inside it. */
async function resolveInside(folder: OpenFolder, raw: string | undefined): Promise<Resolved> {
  const rel = relativePath(raw);
  checkReadable(rel);
  let real: string;
  let info: Stats;
  try {
    real = await realpathNative(absolute(folder.root, rel));
    info = await stat(real);
  } catch (err) {
    if (isPermissionError(err)) throw new CodeFolderError("unreadable", `Sonobe can't open “${rel}”: the person's user account can't read it.`);
    throw new CodeFolderError("bad_path", `There's no “${rel}” in the linked folder. Find paths with list_code_files.`);
  }
  if (!isWithin(folder.root, real)) {
    throw rel ? new CodeFolderError("outside", `“${rel}” links to a place outside the linked folder, so Sonobe won't read it. Paths are relative to its top, like “src/theme.ts”.`) : outsideError(raw ?? "");
  }
  checkReadable(toPosix(path.relative(folder.root, real)));
  return { rel, real, info };
}

/** A file's text (redacted), or a refusal: not a file, over `maxBytes`, or binary. */
async function readText(real: string, rel: string, maxBytes: number, signal: AbortSignal): Promise<string> {
  // O_NONBLOCK: a FIFO swapped in after the check can't hang the call. O_NOFOLLOW: nor can a new link.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
  let handle;
  try {
    handle = await open(real, flags);
  } catch (err) {
    if (isPermissionError(err)) throw new CodeFolderError("unreadable", `Sonobe can't open “${rel}”: the person's user account can't read it.`);
    throw new CodeFolderError("bad_path", `Sonobe couldn't open “${rel}” (it may have just changed). Find paths with list_code_files.`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new CodeFolderError("bad_path", `“${rel}” isn't a file.`);
    if (info.size > maxBytes) throw new CodeFolderError("too_large", `“${rel}” is over ${formatSize(maxBytes)}, so Sonobe won't read it. Look for a smaller theme or token file.`);
    const bytes = await handle.readFile({ signal });
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) throw new CodeFolderError("binary", `“${rel}” isn't a text file.`);
    return redactSecrets(new TextDecoder().decode(bytes));
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return (text.endsWith("\n") ? text.slice(0, text.endsWith("\r\n") ? -2 : -1) : text).split(/\r?\n/);
}

interface WalkedFile { rel: string; real: string; size: number; secret: boolean }

/**
 * Visit the files under `start` breadth first, in name order: top-level files before deeper ones.
 * Skips hidden files (unless they may hold secrets, which are visited as `secret` so they can be
 * listed as skipped), skipped folders, and anything that isn't a file. Links are followed to files
 * inside the folder only, never to folders. Stops when `visit` returns false; `capped` when it looked
 * at MAX_WALK_ENTRIES entries.
 */
async function walk(folder: OpenFolder, start: string, signal: AbortSignal, visit: (file: WalkedFile) => Promise<boolean> | boolean): Promise<{ capped: boolean }> {
  let seen = 0;
  const queue = [start];
  while (queue.length) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(absolute(folder.root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      throwIfStopped(signal);
      if (++seen > MAX_WALK_ENTRIES) return { capped: true };
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !SKIPPED_FOLDERS.has(entry.name)) queue.push(rel);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      let real = absolute(folder.root, rel);
      let target = rel;
      let info: Stats;
      try {
        if (entry.isSymbolicLink()) {
          real = await realpathNative(real);
          if (!isWithin(folder.root, real)) continue;
          target = toPosix(path.relative(folder.root, real));
        }
        info = await stat(real);
      } catch {
        continue;
      }
      if (!info.isFile()) continue;
      const secret = isSecretPath(rel) || isSecretPath(target);
      if (!secret && (isHiddenPath(rel) || isHiddenPath(target))) continue;
      if (!(await visit({ rel, real, size: info.size, secret }))) return { capped: false };
    }
  }
  return { capped: false };
}

/** Where a list or search starts: a folder to walk, or one file. */
async function startOf(folder: OpenFolder, raw: string | undefined): Promise<{ rel: string; file: WalkedFile | null }> {
  const resolved = await resolveInside(folder, raw);
  if (resolved.info.isDirectory()) return { rel: resolved.rel, file: null };
  if (!resolved.info.isFile()) throw new CodeFolderError("bad_path", `“${resolved.rel}” isn't a file or a folder.`);
  return { rel: resolved.rel, file: { rel: resolved.rel, real: resolved.real, size: resolved.info.size, secret: false } };
}

/** How much one call may return, and which limit set it. */
interface CallRoom { max: number; limitedBy: "call" | "reply" | "chat" }

const WALK_CAPPED_NOTE = `(Stopped after looking at ${chars(MAX_WALK_ENTRIES)} entries. Narrow it with path or pattern.)`;

function cutNote(room: CallRoom): string {
  if (room.limitedBy === "call") return `(Cut at ${chars(room.max)} characters. Narrow it with path or pattern.)`;
  return `(Cut short: this ${room.limitedBy} is near its limit for reading the code folder.)`;
}

/** Lines, then notes, cut to whole lines (with a note that says so) when they don't fit. */
function fitLines(lines: readonly string[], notes: readonly string[], room: CallRoom): string {
  const full = [...lines, ...notes].join("\n");
  if (full.length <= room.max) return full;
  const note = cutNote(room);
  const kept: string[] = [];
  let used = note.length;
  for (const line of lines) {
    if (used + line.length + 1 > room.max) break;
    kept.push(line);
    used += line.length + 1;
  }
  return [...kept, note].join("\n");
}

const where = (rel: string) => (rel ? `“${rel}”` : "the linked folder");

async function listCodeFiles(folder: OpenFolder, args: CodeToolArgs, room: CallRoom, signal: AbortSignal): Promise<string> {
  const start = await startOf(folder, args.path);
  const max = args.maxResults ?? 200;
  const matches = fileMatcher(args.pattern, start.rel);
  const lines: string[] = [];
  let more = false;
  const visit = (file: WalkedFile) => {
    if (matches && !matches(file.rel)) return true;
    if (lines.length === max) {
      more = true;
      return false;
    }
    lines.push(file.secret ? `(skipped: may hold secrets) ${file.rel}` : `${file.rel}  ${formatSize(file.size)}`);
    return true;
  };
  let capped = false;
  if (start.file) visit(start.file);
  else ({ capped } = await walk(folder, start.rel, signal, visit));
  const notes = [...(more ? [`(Showing the first ${plural(max, "file")}. Narrow it with path or pattern to see the rest.)`] : []), ...(capped ? [WALK_CAPPED_NOTE] : [])];
  if (!lines.length) return [`No files${args.pattern ? ` match “${args.pattern}”` : ""} in ${where(start.rel)}.`, ...notes].join("\n");
  return fitLines(lines, notes, room);
}

/** A matching line, trimmed, and cut around the match when it's long (minified code). */
function excerpt(line: string, query: string): string {
  const text = line.trim();
  if (text.length <= 240) return text;
  const at = Math.max(0, text.indexOf(query) - 80);
  return `${at > 0 ? "…" : ""}${text.slice(at, at + 240)}${at + 240 < text.length ? "…" : ""}`;
}

async function searchCode(folder: OpenFolder, args: CodeToolArgs, room: CallRoom, signal: AbortSignal): Promise<string> {
  const query = args.query!;
  const start = await startOf(folder, args.path);
  const max = args.maxResults ?? 40;
  const matches = fileMatcher(args.pattern, start.rel);
  const lines: string[] = [];
  let more = false;
  let large = 0;
  const visit = async (file: WalkedFile) => {
    if (file.secret || (matches && !matches(file.rel))) return true;
    if (file.size > SEARCH_MAX_BYTES) {
      large++;
      return true;
    }
    let text: string;
    try {
      text = await readText(file.real, file.rel, SEARCH_MAX_BYTES, signal);
    } catch (err) {
      // A binary, or a file that changed during the walk: search the rest.
      if (err instanceof CallStopped) throw err;
      return true;
    }
    if (!text.includes(query)) return true;
    const fileLines = splitLines(text);
    for (let i = 0; i < fileLines.length; i++) {
      if (!fileLines[i]!.includes(query)) continue;
      if (lines.length === max) {
        more = true;
        return false;
      }
      lines.push(`${file.rel}:${i + 1}: ${excerpt(fileLines[i]!, query)}`);
    }
    return true;
  };
  let capped = false;
  if (start.file) await visit(start.file);
  else ({ capped } = await walk(folder, start.rel, signal, visit));
  const notes = [
    ...(more ? [`(Showing the first ${plural(max, "match", "matches")}. Narrow it with path or pattern to see the rest.)`] : []),
    ...(large ? [`(Skipped ${plural(large, "file")} over ${formatSize(SEARCH_MAX_BYTES)}.)`] : []),
    ...(capped ? [WALK_CAPPED_NOTE] : []),
  ];
  if (!lines.length) return [`No matches for “${query}” in ${where(start.rel)}.`, ...notes].join("\n");
  return fitLines(lines, notes, room);
}

async function readCodeFile(folder: OpenFolder, args: CodeToolArgs, room: CallRoom, signal: AbortSignal): Promise<string> {
  if (!relativePath(args.path)) throw new CodeFolderError("bad_path", "read_code_file reads one file: pass its path, like “src/theme.ts”. List files with list_code_files.");
  const file = await resolveInside(folder, args.path);
  if (file.info.isDirectory()) throw new CodeFolderError("bad_path", `“${file.rel}” is a folder. List it with list_code_files.`);
  const lines = splitLines(await readText(file.real, file.rel, READ_MAX_BYTES, signal));
  const total = lines.length;
  if (!total) return `${file.rel} (empty)`;
  const offset = args.offset ?? 1;
  if (offset > total) throw new CodeFolderError("bad_path", `“${file.rel}” has ${plural(total, "line")}, so there's nothing at line ${offset}.`);
  const last = Math.min(total, offset - 1 + (args.limit ?? 800));

  const header = (end: number) => `${file.rel} (lines ${offset}–${end} of ${total})`;
  const moreNote = (end: number) => {
    if (end >= total) return "";
    const next = `(${plural(total - end, "more line")}: pass offset ${end + 1} to continue.)`;
    return end < last && room.limitedBy !== "call" ? `${next} ${cutNote(room)}` : next;
  };
  // Room for the header and the closing notes at their longest.
  const reserve = header(total).length + `(${plural(total, "more line")}: pass offset ${total} to continue.) `.length + cutNote(room).length + 2;
  const space = room.max - reserve;
  let end = offset - 1;
  let used = 0;
  while (end < last && used + lines[end]!.length + 1 <= space) used += lines[end++]!.length + 1;
  const shown = lines.slice(offset - 1, end);
  const notes: string[] = [];
  if (end < offset) {
    // Not even one whole line fits (minified code): show as much of it as fits, and say so.
    const cutAt = space - 110;
    if (cutAt < 20) {
      throw new CodeFolderError(
        "budget",
        room.limitedBy === "call"
          ? `Line ${offset} of “${file.rel}” is too long to show. Find what you need in it with search_code.`
          : `This ${room.limitedBy} is at its limit for reading the code folder, so line ${offset} of “${file.rel}” doesn't fit.${room.limitedBy === "chat" ? " Start a new chat to read more." : " Design with what you've read so far."}`,
      );
    }
    shown.push(lines[offset - 1]!.slice(0, cutAt));
    notes.push(`(Line ${offset} was cut at ${chars(cutAt)} of its ${chars(lines[offset - 1]!.length)} characters. Find what you need in it with search_code.)`);
    end = offset;
  }
  const more = moreNote(end);
  return [header(end), ...shown, ...notes, ...(more ? [more] : [])].join("\n");
}

const RUN: Record<CodeToolName, (folder: OpenFolder, args: CodeToolArgs, room: CallRoom, signal: AbortSignal) => Promise<string>> = {
  list_code_files: listCodeFiles,
  search_code: searchCode,
  read_code_file: readCodeFile,
};

const textResult = (text: string, isError = false): ToolCallResult => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
const errorResult = (err: CodeFolderError): ToolCallResult => textResult(err.hint ? `${err.message}\n${err.hint}` : err.message, true);

/** The least room a call needs; a reply or chat with less left counts as used up. */
const MIN_CALL_CHARS = 200;

export function createCodeTools(store: CodeFolderStore, options: { deadlineMs?: number; callChars?: number; replyChars?: number; chatChars?: number } = {}): LocalTools {
  const deadlineMs = options.deadlineMs ?? 5_000;
  const callChars = Math.max(MIN_CALL_CHARS, options.callChars ?? 60_000);
  const replyChars = options.replyChars ?? 240_000;
  const chatChars = options.chatChars ?? 600_000;
  /** Characters read per chat, and in its current reply (replies in one chat run one at a time). */
  const chats = new Map<string, { chat: number; runId: string; reply: number }>();

  const infos: readonly AssistantToolInfo[] = Object.freeze(CODE_TOOLS.map((spec) => Object.freeze({ name: spec.name, title: spec.title, description: spec.description, inputSchema: inputSchema(spec), readOnly: true })));

  const usageOf = (scope: LocalToolScope) => {
    let usage = chats.get(scope.conversationId);
    if (!usage) chats.set(scope.conversationId, (usage = { chat: 0, runId: scope.runId, reply: 0 }));
    if (usage.runId !== scope.runId) Object.assign(usage, { runId: scope.runId, reply: 0 });
    return usage;
  };

  /** The linked folder for this call's window, still where it was linked. */
  const openFolder = async (scope: LocalToolScope): Promise<OpenFolder> => {
    const key = { projectPath: scope.projectPath, windowId: scope.conversationId };
    const grant = await store.get(key);
    if (!grant) throw new CodeFolderError("not_linked", "No code folder is linked to this prototype. Ask the person to choose Match my code… in the Design with Claude box.");
    try {
      const root = await realpathNative(grant.root);
      const info = await stat(root);
      if (info.isDirectory() && info.dev === grant.dev && info.ino === grant.ino) return { root, name: grant.name };
    } catch {
      // Gone: said below.
    }
    const shown = (await store.status(key)).linked?.path ?? grant.root;
    throw new CodeFolderError("missing", `The linked folder “${grant.name}” isn't where it was linked (${shown}). Ask the person to link it again.`);
  };

  return {
    infos,

    async call(name, input, scope) {
      const spec = CODE_TOOLS.find((s) => s.name === name);
      if (!spec) return textResult(`There's no code folder tool named ${name}. The code folder tools are ${CODE_TOOL_NAMES.join(", ")}.`, true);
      const args = parseArgs(spec, input && typeof input === "object" ? input : {});
      if (args instanceof CodeFolderError) return errorResult(args);

      const usage = usageOf(scope);
      const chatLeft = chatChars - usage.chat;
      const replyLeft = replyChars - usage.reply;
      if (chatLeft < MIN_CALL_CHARS) return errorResult(new CodeFolderError("budget", `This chat has read ${chars(chatChars)} characters from the code folder, its limit. Start a new chat to read more.`));
      if (replyLeft < MIN_CALL_CHARS) return errorResult(new CodeFolderError("budget", `This reply has read ${chars(replyChars)} characters from the code folder, its limit for one reply. Design with what you've read so far.`));
      const room: CallRoom =
        chatLeft < Math.min(callChars, replyLeft) ? { max: chatLeft, limitedBy: "chat" } : replyLeft < callChars ? { max: replyLeft, limitedBy: "reply" } : { max: callChars, limitedBy: "call" };

      try {
        const text = await withDeadline(deadlineMs, scope.signal, async (signal) => RUN[spec.name](await openFolder(scope), args, room, signal));
        const out = text.length > room.max ? text.slice(0, room.max) : text;
        usage.chat += out.length;
        usage.reply += out.length;
        return textResult(out);
      } catch (err) {
        if (err instanceof CodeFolderError) return errorResult(err);
        if (err instanceof CallStopped && err.reason === "timeout") {
          return errorResult(new CodeFolderError("timeout", "Reading the code folder took too long, so it stopped. Ask for a narrower folder or pattern."));
        }
        if (err instanceof CallStopped || scope.signal.aborted) return textResult("Stopped: the person pressed Stop, so the code folder wasn't read.", true);
        return textResult(`Sonobe couldn't read the code folder: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },

    forget(conversationId) {
      chats.delete(conversationId);
    },
  };
}
