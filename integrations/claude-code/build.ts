#!/usr/bin/env node
/**
 * Build the Claude Code plugin's MCP server: the bundled `sonobe` CLI
 * (packages/cli/scripts/bundle.ts) at dist/sonobe.mjs with the agent guides and the examples' texts
 * beside it.
 * .mcp.json runs it with `node ${CLAUDE_PLUGIN_ROOT}/dist/sonobe.mjs mcp`, so the plugin needs
 * nothing on PATH but Node.
 *
 *   node integrations/claude-code/build.ts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleCli } from "../../packages/cli/scripts/bundle.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const r = await bundleCli({ outfile: path.join(here, "dist", "sonobe.mjs") });
console.log(
  `Built the Sonobe plugin server in ${path.dirname(r.outfile)} (${(r.bytes / 1024 / 1024).toFixed(1)} MB).`,
);
console.log(`Try it:  claude --plugin-dir "${here}"`);
