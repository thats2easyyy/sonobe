/**
 * Regenerates the example project folders from examples/recipes, deterministically.
 *
 *   node examples/build.ts                    write every project
 *   node examples/build.ts 08-bottom-sheet    write one project
 *   node examples/build.ts --check            exit 1 when a project on disk differs from its recipe
 *
 * Only project files (project.json, knobs.json, components/, assets/) are written, including the asset
 * files a recipe's design import makes. README.md, test.json and a design/ folder are hand-written and
 * never touched.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDiagnostics } from "@sonobe/core";
import { saveProjectToDisk } from "@sonobe/core/node";
import { createPatchRegistry } from "@sonobe/patches";
import { EXAMPLES_DIR, projectDrift, writeAssetFiles } from "./lib/disk.ts";
import { buildRecipe } from "./lib/recipe.ts";
import { RECIPES } from "./recipes/index.ts";

export async function main(argv: string[]): Promise<number> {
  const check = argv.includes("--check");
  const wanted = argv.filter((a) => !a.startsWith("--"));
  const unknown = wanted.filter((w) => !RECIPES.some((r) => r.folder === w));
  if (unknown.length) {
    process.stderr.write(`Unknown example ${unknown.join(", ")}. Examples: ${RECIPES.map((r) => r.folder).join(", ")}\n`);
    return 2;
  }
  const registry = createPatchRegistry();
  let failures = 0;
  for (const recipe of RECIPES) {
    if (wanted.length && !wanted.includes(recipe.folder)) continue;
    const dir = path.join(EXAMPLES_DIR, recipe.folder);
    const { doc, files } = await buildRecipe(recipe, registry);
    const errors = getDiagnostics(doc, registry).filter((d) => d.severity === "error");
    if (errors.length) {
      failures++;
      process.stderr.write(`✗ ${recipe.folder} has error diagnostics:\n${errors.map((d) => `  ${d.code}: ${d.message}`).join("\n")}\n`);
      continue;
    }
    for (const file of ["README.md", "test.json"]) {
      if (!existsSync(path.join(dir, file))) process.stderr.write(`! ${recipe.folder} has no ${file} yet.\n`);
    }
    if (check) {
      const drift = projectDrift(dir, doc, files);
      if (drift.changed.length || drift.extra.length) {
        failures++;
        process.stderr.write(`✗ ${recipe.folder} is out of date: ${[...drift.changed, ...drift.extra.map((f) => `${f} (extra)`)].join(", ")}. Run node examples/build.ts ${recipe.folder}\n`);
      } else {
        process.stdout.write(`✓ ${recipe.folder}\n`);
      }
      continue;
    }
    const r = await saveProjectToDisk(dir, doc);
    const assets = writeAssetFiles(dir, files);
    const written = [...r.written, ...assets.written];
    const removed = [...r.removed, ...assets.removed];
    process.stdout.write(`✓ ${recipe.folder}${written.length ? ` wrote ${written.join(", ")}` : " unchanged"}${removed.length ? `, removed ${removed.join(", ")}` : ""}\n`);
  }
  return failures ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
