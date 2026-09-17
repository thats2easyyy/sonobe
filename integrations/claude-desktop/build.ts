#!/usr/bin/env node
/**
 * Build the Claude Desktop extension folder: bundle the `sonobe` CLI into server/sonobe.mjs,
 * copy the agent guides and the manifest. Pack the result with `npx @anthropic-ai/mcpb pack`.
 *
 *   node integrations/claude-desktop/build.ts [--out <dir>]
 */

import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = path.resolve(values.out ?? path.join(here, "dist"));

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "server"), { recursive: true });

await build({
  entryPoints: [path.join(root, "packages/cli/src/main.ts")],
  outfile: path.join(out, "server/sonobe.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
  // Some dependencies are CommonJS; give the ESM bundle a real require().
  banner: {
    js: "import { createRequire as __sonobeRequire } from 'node:module'; const require = __sonobeRequire(import.meta.url);",
  },
});

await cp(path.join(root, "packages/mcp/guides"), path.join(out, "guides"), { recursive: true });
await cp(path.join(here, "manifest.json"), path.join(out, "manifest.json"));
await cp(path.join(root, "LICENSE"), path.join(out, "LICENSE"));

const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8")) as {
  version: string;
};
const size = (await stat(path.join(out, "server/sonobe.mjs"))).size;
console.log(
  `Built Sonobe extension ${manifest.version} in ${out} (server bundle ${(size / 1024 / 1024).toFixed(1)} MB).`,
);
console.log(`Pack it:  npx @anthropic-ai/mcpb pack "${out}" sonobe.mcpb`);
