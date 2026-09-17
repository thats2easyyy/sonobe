#!/usr/bin/env node
/**
 * Bundle the `sonobe` CLI into one self-contained ESM file (shebang, no JavaScript dependencies)
 * with the agent guides beside it, so it runs outside the repo: npx, global installs, the Claude
 * Code plugin and the Claude Desktop extension. The native screenshot rasterizer (@resvg/resvg-js
 * and the platform binaries installed with it) is copied to node_modules beside the bundle, which
 * loads it at runtime for headless get_screenshot.
 *
 *   node packages/cli/scripts/bundle.ts [--outfile <path>] [--no-guides] [--no-rasterizer]
 *
 * Default output: packages/cli/dist/sonobe.mjs, packages/cli/dist/guides/ and packages/cli/dist/node_modules/@resvg/.
 */

import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

/** packages/cli */
export const CLI_ROOT = path.resolve(here, "..");
/** The repository root. */
export const REPO_ROOT = path.resolve(CLI_ROOT, "../..");
export const DEFAULT_OUTFILE = path.join(CLI_ROOT, "dist", "sonobe.mjs");
export const GUIDES_SOURCE = path.join(REPO_ROOT, "packages", "mcp", "guides");

export interface BundleOptions {
  /** Where to write the bundle (default packages/cli/dist/sonobe.mjs). */
  outfile?: string;
  /** Copy the agent guides to <outfile dir>/guides (default true). */
  guides?: boolean;
  /** Copy the screenshot rasterizer to <outfile dir>/node_modules/@resvg (default true). */
  rasterizer?: boolean;
  /** esbuild log level (default "warning"). */
  logLevel?: "silent" | "error" | "warning" | "info";
}

export interface BundleResult {
  outfile: string;
  /** Where the guides were copied, when they were. */
  guidesDir?: string;
  /** Where the rasterizer packages were copied, when they were installed and copied. */
  rasterizerDir?: string;
  bytes: number;
}

const SHEBANG = "#!/usr/bin/env node";

/** Build the single-file CLI. */
export async function bundleCli(options: BundleOptions = {}): Promise<BundleResult> {
  const outfile = path.resolve(options.outfile ?? DEFAULT_OUTFILE);
  await mkdir(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(CLI_ROOT, "src", "main.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "none",
    logLevel: options.logLevel ?? "warning",
    // Some dependencies are CommonJS; give the ESM bundle a real require().
    banner: {
      js: "import { createRequire as __sonobeCreateRequire } from 'node:module'; const require = __sonobeCreateRequire(import.meta.url);",
    },
  });
  // Exactly one shebang on the first line, whatever esbuild kept from the entry.
  const code = await readFile(outfile, "utf8");
  const body = code.replace(/^#![^\n]*\n/, "");
  await writeFile(outfile, `${SHEBANG}\n${body}`);
  await chmod(outfile, 0o755);
  const result: BundleResult = { outfile, bytes: (await stat(outfile)).size };
  if (options.guides !== false) {
    const guidesDir = path.join(path.dirname(outfile), "guides");
    await rm(guidesDir, { recursive: true, force: true });
    await cp(GUIDES_SOURCE, guidesDir, { recursive: true });
    result.guidesDir = guidesDir;
  }
  if (options.rasterizer !== false) {
    const rasterizerDir = await copyRasterizer(path.dirname(outfile));
    if (rasterizerDir) result.rasterizerDir = rasterizerDir;
  }
  return result;
}

/**
 * Copy @resvg/resvg-js and the platform binary packages installed beside it (only this machine's
 * platform, as npm installs them) into <dir>/node_modules/@resvg, so a bundle in <dir> can load the
 * rasterizer. Returns the folder, or undefined when the rasterizer isn't installed.
 */
export async function copyRasterizer(dir: string): Promise<string | undefined> {
  const require = createRequire(import.meta.url);
  let manifest: string;
  try {
    manifest = require.resolve("@resvg/resvg-js/package.json", { paths: [REPO_ROOT, CLI_ROOT] });
  } catch {
    return undefined;
  }
  const scope = path.dirname(path.dirname(manifest));
  const target = path.join(dir, "node_modules", "@resvg");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const name of await readdir(scope)) {
    if (name !== "resvg-js" && !name.startsWith("resvg-js-")) continue;
    await cp(path.join(scope, name), path.join(target, name), {
      recursive: true,
      dereference: true,
    });
  }
  return target;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const { values } = parseArgs({
    options: {
      outfile: { type: "string" },
      "no-guides": { type: "boolean" },
      "no-rasterizer": { type: "boolean" },
    },
  });
  const r = await bundleCli({
    ...(values.outfile ? { outfile: values.outfile } : {}),
    guides: !values["no-guides"],
    rasterizer: !values["no-rasterizer"],
  });
  console.log(
    `Bundled sonobe CLI → ${path.relative(process.cwd(), r.outfile) || r.outfile} (${(r.bytes / 1024 / 1024).toFixed(1)} MB)${r.guidesDir ? ` with guides in ${path.relative(process.cwd(), r.guidesDir)}` : ""}.`,
  );
  console.log(`Run it anywhere with Node 22+:  node "${r.outfile}" --help`);
}
