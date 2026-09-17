#!/usr/bin/env node
/**
 * Build the Claude Desktop extension folder from the bundled `sonobe` CLI
 * (packages/cli/scripts/bundle.ts): server/sonobe.mjs, the agent guides, the manifest and the
 * license. Pack the result with `npx @anthropic-ai/mcpb pack`.
 *
 *   node integrations/claude-desktop/build.ts [--out <dir>]
 */

import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bundleCli, GUIDES_SOURCE, REPO_ROOT } from "../../packages/cli/scripts/bundle.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = path.resolve(values.out ?? path.join(here, "dist"));

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "server"), { recursive: true });

// The same single-file CLI that npm installs; it finds guides at ../guides next to server/.
const bundle = await bundleCli({ outfile: path.join(out, "server", "sonobe.mjs"), guides: false });
await cp(GUIDES_SOURCE, path.join(out, "guides"), { recursive: true });
await cp(path.join(here, "manifest.json"), path.join(out, "manifest.json"));
await cp(path.join(REPO_ROOT, "LICENSE"), path.join(out, "LICENSE"));

const manifest = JSON.parse(await readFile(path.join(out, "manifest.json"), "utf8")) as {
  version: string;
};
console.log(
  `Built Sonobe extension ${manifest.version} in ${out} (server bundle ${(bundle.bytes / 1024 / 1024).toFixed(1)} MB).`,
);
console.log(`Pack it:  npx @anthropic-ai/mcpb pack "${out}" sonobe.mcpb`);
