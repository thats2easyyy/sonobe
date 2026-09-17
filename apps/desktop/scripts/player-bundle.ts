/**
 * esbuild plugins for the web player bundle (phone preview and pop-out viewer). The player runs
 * prototypes and never shows patch documentation, so:
 *
 * - catalog chunks lose the text only the editor's reference, the patch picker and agents read
 *   (behavior specs, docs, examples...). Runtime code reads `aliases` and `summary`, which stay.
 * - lottie-web stays out of player.js. The player passes `loadLottie`, which loads lottie.js (its
 *   own bundle) the first time a Lottie layer draws.
 *
 * Plain TypeScript with erasable syntax, so scripts/build.mjs imports it directly.
 */

import { readFile } from "node:fs/promises";
import type { Plugin } from "esbuild";

/** Catalog entry fields the player never reads. */
export const CATALOG_DOC_FIELDS: readonly string[] = ["behavior", "docs", "examples", "commonMistakes", "defaultNotes", "pairsWellWith", "dynamicPortsRule", "origamiPorts", "importAliases", "statusReason"];

/** A catalog chunk file's JSON without the documentation fields of its patches. */
export function leanCatalogChunk(json: string): string {
  const chunk = JSON.parse(json) as { patches?: unknown };
  if (Array.isArray(chunk.patches)) {
    chunk.patches = chunk.patches.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") return entry;
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entry)) if (!CATALOG_DOC_FIELDS.includes(key)) out[key] = value;
      return out;
    });
  }
  return JSON.stringify(chunk);
}

/** Strips documentation from packages/patches/catalog/*.json as the bundle imports them. */
export function leanCatalogPlugin(): Plugin {
  return {
    name: "sonobe-lean-catalog",
    setup(build) {
      build.onLoad({ filter: /[\\/]packages[\\/]patches[\\/]catalog[\\/][^\\/]+\.json$/ }, async (args) => ({
        contents: leanCatalogChunk(await readFile(args.path, "utf8")),
        loader: "json",
      }));
    },
  };
}

/** Resolves lottie-web to an empty module; the page supplies the player through `loadLottie`. */
export function externalLottiePlugin(): Plugin {
  return {
    name: "sonobe-external-lottie",
    setup(build) {
      build.onResolve({ filter: /^lottie-web(?:\/.*)?$/ }, (args) => ({ path: args.path, namespace: "sonobe-external-lottie" }));
      build.onLoad({ filter: /.*/, namespace: "sonobe-external-lottie" }, () => ({ contents: "export default {};", loader: "js" }));
    },
  };
}
