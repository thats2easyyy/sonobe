/** Node helpers for example folders: discovery and drift between a built document and the files on disk. */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serializeDocument, type SonobeDocument } from "@sonobe/core";

/** The examples/ folder. */
export const EXAMPLES_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Example folders (those holding project.json), sorted. */
export function listExampleFolders(dir: string = EXAMPLES_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "project.json")))
    .map((entry) => entry.name)
    .sort();
}

export interface ProjectDrift {
  /** Files the build produces that are missing or differ on disk. */
  changed: string[];
  /** Component or script files on disk that the build doesn't produce. */
  extra: string[];
}

function listFiles(dir: string, sub: string, ext: string): string[] {
  const full = path.join(dir, sub);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => name.endsWith(ext))
    .map((name) => `${sub}/${name}`);
}

/** Compare a document's canonical files with a project folder. */
export function projectDrift(dir: string, doc: SonobeDocument): ProjectDrift {
  const files = serializeDocument(doc);
  const changed: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    if (!existsSync(full) || readFileSync(full, "utf8") !== text) changed.push(rel);
  }
  const extra = [...listFiles(dir, "components", ".json"), ...listFiles(dir, "scripts", ".js")].filter((rel) => !(rel in files));
  return { changed: changed.sort(), extra: extra.sort() };
}
