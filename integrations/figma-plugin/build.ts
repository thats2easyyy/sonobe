#!/usr/bin/env node
/**
 * Build the Sonobe Capture Figma plugin into dist/ (code.js and ui.html). In the Figma desktop app,
 * choose Plugins → Development → Import plugin from manifest… and pick integrations/figma-plugin/manifest.json.
 *
 *   node integrations/figma-plugin/build.ts
 */

import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
// Figma's plugin sandbox runs ES2020; no DOM, so the bundle carries only the mapping code.
await build({ absWorkingDir: here, entryPoints: ["src/code.ts"], outfile: path.join(out, "code.js"), bundle: true, format: "iife", platform: "neutral", target: "es2020", logLevel: "warning" });
await cp(path.join(here, "src", "ui.html"), path.join(out, "ui.html"));
console.log(`Built the Sonobe Capture Figma plugin in ${out}. Import integrations/figma-plugin/manifest.json in Figma (Plugins → Development).`);
