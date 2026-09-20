/** Node helpers for example folders: discovery, asset files, and drift between a built document and the files on disk. */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOBS_FILE, serializeDocument, type SonobeDocument } from "@sonobe/core";

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
  /** Component, script, knobs or asset files on disk that the build doesn't produce. */
  extra: string[];
}

/** An asset file's bytes as the build produces them, stored at assets/<file>. */
export interface AssetFile {
  file: string;
  bytes: Uint8Array;
}

function listFiles(dir: string, sub: string, ext: string): string[] {
  const full = path.join(dir, sub);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => name.endsWith(ext))
    .map((name) => `${sub}/${name}`);
}

/** Files an OS leaves in folders, besides hidden ones like Finder's .DS_Store. */
const LITTER = new Set(["Thumbs.db", "desktop.ini", "Icon\r"]);

/** Asset files in a project folder, other than the registry assets.json, hidden files, OS litter and folders. */
function assetFilesOnDisk(dir: string): string[] {
  const full = path.join(dir, "assets");
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && !LITTER.has(entry.name) && entry.name !== "assets.json")
    .map((entry) => `assets/${entry.name}`);
}

const sameBytes = (file: string, bytes: Uint8Array) => existsSync(file) && Buffer.compare(readFileSync(file), bytes) === 0;

/** Write the asset files that are missing or differ, and remove the ones the build no longer makes. */
export function writeAssetFiles(dir: string, files: readonly AssetFile[]): { written: string[]; removed: string[] } {
  const written: string[] = [];
  for (const { file, bytes } of files) {
    const full = path.join(dir, "assets", file);
    if (sameBytes(full, bytes)) continue;
    writeFileSync(full, bytes);
    written.push(`assets/${file}`);
  }
  const kept = new Set(files.map((f) => `assets/${f.file}`));
  const removed = assetFilesOnDisk(dir).filter((rel) => !kept.has(rel));
  for (const rel of removed) rmSync(path.join(dir, rel));
  return { written, removed };
}

/** Compare a document's canonical files, and the asset files its build made, with a project folder. */
export function projectDrift(dir: string, doc: SonobeDocument, assets: readonly AssetFile[] = []): ProjectDrift {
  const files = serializeDocument(doc);
  const changed: string[] = [];
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    if (!existsSync(full) || readFileSync(full, "utf8") !== text) changed.push(rel);
  }
  for (const { file, bytes } of assets) if (!sameBytes(path.join(dir, "assets", file), bytes)) changed.push(`assets/${file}`);
  const built = new Set(assets.map((a) => `assets/${a.file}`));
  const knobs = existsSync(path.join(dir, KNOBS_FILE)) ? [KNOBS_FILE] : [];
  const extra = [...listFiles(dir, "components", ".json"), ...listFiles(dir, "scripts", ".js"), ...knobs, ...assetFilesOnDisk(dir).filter((rel) => !built.has(rel))].filter((rel) => !(rel in files));
  return { changed: changed.sort(), extra: extra.sort() };
}
