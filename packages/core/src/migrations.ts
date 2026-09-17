/**
 * File format versioning (research: file-format-interop §5.7). Every project and
 * component file carries `formatVersion`; migrations are pure `vN → vN+1` functions
 * run in sequence on load. Never delete a migration.
 */

import { FORMAT_VERSION } from "./document.ts";
import type { FormatIssue } from "./schema.ts";

export type FormatErrorCode = "invalidFormat" | "tooNew" | "migrationFailed" | "corrupt";

/** A project or file that can't be loaded, with a human-first message. */
export class ProjectFormatError extends Error {
  readonly code: FormatErrorCode;
  readonly file: string | undefined;
  readonly issues: FormatIssue[];

  constructor(code: FormatErrorCode, message: string, options: { file?: string; issues?: FormatIssue[]; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProjectFormatError";
    this.code = code;
    this.file = options.file;
    this.issues = options.issues ?? [];
  }
}

export type MigratedFileKind = "project" | "component";

export interface Migration {
  kind: MigratedFileKind;
  /** Upgrades files at this version to `from + 1`. */
  from: number;
  description: string;
  migrate(json: Record<string, unknown>): Record<string, unknown>;
}

/** Registered migrations (format 1 is the first version, so none yet). */
export const MIGRATIONS: readonly Migration[] = [];

export interface MigrateOptions {
  migrations?: readonly Migration[];
  /** Version this reader understands (defaults to FORMAT_VERSION). */
  currentVersion?: number;
  file?: string;
}

/**
 * Detect the version of a parsed file, reject too-new files, and run migrations up to
 * the current version. Throws ProjectFormatError.
 */
export function migrateFile(kind: MigratedFileKind, json: unknown, options: MigrateOptions = {}): Record<string, unknown> {
  const file = options.file ?? (kind === "project" ? "project.json" : "component file");
  const current = options.currentVersion ?? FORMAT_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new ProjectFormatError("invalidFormat", `${file} isn't a Sonobe ${kind} file: expected a JSON object.`, { file });
  }
  const record = json as Record<string, unknown>;
  const version = record.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError("invalidFormat", `${file} has no valid "formatVersion", so it isn't a Sonobe ${kind} file.`, {
      file,
      issues: [{ path: "formatVersion", message: "must be a whole number ≥ 1", file }],
    });
  }
  if (version > current) {
    const minReader = record.minReaderVersion;
    if (kind === "project" && typeof minReader === "number" && Number.isInteger(minReader) && minReader <= current) return record;
    throw new ProjectFormatError(
      "tooNew",
      `${file} was saved by a newer version of Sonobe (format ${version}). This version reads format ${current}. Update Sonobe to open it.`,
      { file },
    );
  }
  let out = record;
  for (let from = version; from < current; from++) {
    const migration = migrations.find((m) => m.kind === kind && m.from === from);
    if (!migration) {
      throw new ProjectFormatError("migrationFailed", `${file} is format ${version}, but there's no migration from format ${from} to ${from + 1}.`, { file });
    }
    try {
      out = { ...migration.migrate(structuredClone(out)), formatVersion: from + 1 };
    } catch (err) {
      throw new ProjectFormatError("migrationFailed", `Upgrading ${file} from format ${from} to ${from + 1} failed (${migration.description}): ${err instanceof Error ? err.message : String(err)}`, {
        file,
        cause: err,
      });
    }
  }
  return out;
}
