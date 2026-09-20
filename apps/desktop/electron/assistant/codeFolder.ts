/**
 * Code folders: the app folder a person links to a prototype (Match my code…, a native dialog in the
 * main process), and the Assistant's three read-only tools over it (list_code_files, search_code,
 * read_code_file). The link is kept in the app's data, keyed by project path, or held for the
 * window's session when the prototype is unsaved; never in the document. The tools are the
 * Assistant's own, not MCP tools. Electron-free.
 */

import type { AssistantCodeFolderStatus } from "./protocol.ts";
import type { LocalTools } from "./toolBridge.ts";

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

export function createCodeFolderStore(_options: { file: string; home: string; now?: () => number }): CodeFolderStore {
  throw new Error("not implemented");
}

/** The code tools, in the order they're listed. */
export const CODE_TOOL_NAMES = ["list_code_files", "search_code", "read_code_file"] as const;

export function createCodeTools(_store: CodeFolderStore, _options?: { deadlineMs?: number; callChars?: number; replyChars?: number; chatChars?: number }): LocalTools {
  throw new Error("not implemented");
}
