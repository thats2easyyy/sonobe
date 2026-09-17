/** Importing files into an inspector asset field (Image, Video, Sound, Lottie) through `session.assets`. */

import type { AssetKind, Id, ValueType } from "@sonobe/core";
import { assetKindFor } from "../../state/assets.ts";
import type { EditorSession } from "../../state/session.ts";

/** Asset kinds an inspector field of `type` takes. */
export const ASSET_KINDS: Partial<Record<ValueType, readonly AssetKind[]>> = {
  image: ["image"],
  video: ["video"],
  sound: ["sound"],
  json: ["lottie", "json"],
};

export const assetKindsFor = (type: ValueType): readonly AssetKind[] => ASSET_KINDS[type] ?? ["image"];

const ACCEPT: Readonly<Record<AssetKind, string>> = {
  image: "image/*,.svg,.heic,.heif,.avif",
  video: "video/*,.mov,.m4v,.webm",
  sound: "audio/*,.m4a,.opus",
  font: ".ttf,.otf,.woff,.woff2",
  lottie: ".json,.lottie,application/json",
  json: ".json,application/json",
};

/** The file input `accept` attribute for these kinds. */
export function acceptAttribute(kinds: readonly AssetKind[]): string {
  return [...new Set(kinds.flatMap((kind) => ACCEPT[kind].split(",")))].join(",");
}

/** "an image", "a Lottie animation" */
export const KIND_NOUNS: Readonly<Record<AssetKind, string>> = {
  image: "an image",
  video: "a video",
  sound: "a sound",
  font: "a font",
  lottie: "a Lottie animation",
  json: "a JSON file",
};

/** Plain-language names for "No image files yet" hints. */
export const KIND_PLURALS: Readonly<Record<AssetKind, string>> = {
  image: "images",
  video: "videos",
  sound: "sounds",
  font: "fonts",
  lottie: "Lottie animations",
  json: "JSON files",
};

const fits = (kind: AssetKind, kinds: readonly AssetKind[]) => kinds.includes(kind) || (kind === "json" && kinds.includes("lottie"));

/** Whether a file looks like it fits (by name and MIME type; unknown files are let through to the importer). */
export function fileFitsKinds(file: { name: string; type?: string }, kinds: readonly AssetKind[]): boolean {
  const kind = assetKindFor(file.name, file.type ?? "");
  return kind === undefined || fits(kind, kinds);
}

export type FieldImportResult = { ok: true; assetId: Id; name: string; reused: boolean } | { ok: false; error: string };

/** The file as `{ name, bytes, mime }`, which every AssetService version reads correctly. */
async function readFile(file: File): Promise<{ name: string; bytes: Uint8Array; mime?: string }> {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), ...(file.type ? { mime: file.type } : {}) };
}

/**
 * Import a file as an asset for a field that takes `kinds` (`propName` is for messages: "Image").
 * Pass `coalesceKey`, then set the field with the same key, to make the import and the set one undo step.
 */
export async function importAssetForField(session: EditorSession, file: File, kinds: readonly AssetKind[], propName: string, options: { coalesceKey?: string } = {}): Promise<FieldImportResult> {
  const assets = (session as Partial<Pick<EditorSession, "assets">>).assets;
  const wanted = KIND_NOUNS[kinds[0] ?? "image"];
  if (!assets || typeof assets.importFile !== "function") return { ok: false, error: "This version of Sonobe can't import files here yet. Use a web address instead." };
  const guessed = assetKindFor(file.name, file.type);
  if (guessed !== undefined && !fits(guessed, kinds)) return { ok: false, error: `“${file.name}” is ${KIND_NOUNS[guessed]}, but ${propName} takes ${wanted}.` };
  let input: { name: string; bytes: Uint8Array; mime?: string };
  try {
    input = await readFile(file);
  } catch (err) {
    return { ok: false, error: `Couldn't read “${file.name}”: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = await assets.importFile(input, options.coalesceKey ? { coalesceKey: options.coalesceKey } : {});
  if (!result.ok || !result.assetId || !result.record) return { ok: false, error: result.error ?? `Couldn't import “${file.name}”.` };
  if (!fits(result.record.kind, kinds)) return { ok: false, error: `“${file.name}” is ${KIND_NOUNS[result.record.kind]}, but ${propName} takes ${wanted}.` };
  return { ok: true, assetId: result.assetId, name: result.record.name, reused: result.reused === true };
}
