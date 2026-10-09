/**
 * Builds the editor for e2e/production.spec.ts: the production build (`vite build`, the same config
 * `npm run build -w @sonobe/editor` uses), written to a scratch folder.
 */

import { expect, test as setup } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PRODUCTION_BUILD } from "./helpers.ts";

const EDITOR = fileURLToPath(new URL("../apps/editor", import.meta.url));

setup("build the editor", () => {
  setup.setTimeout(180_000);
  const build = spawnSync("npx", ["vite", "build", "--outDir", PRODUCTION_BUILD, "--emptyOutDir"], { cwd: EDITOR, encoding: "utf8" });
  const output = `${build.stdout ?? ""}${build.stderr ?? ""}`;
  if (build.status !== 0) throw new Error(`The editor's production build failed. Run \`npm run build -w @sonobe/editor\` to see it on its own.\n\n${build.error?.message ?? output.slice(-4000)}`);

  // Code meant to load on demand that something also imports statically lands back in the startup chunk; the bundler says so.
  const pinned = output.split("\n").filter((line) => line.includes("INEFFECTIVE_DYNAMIC_IMPORT"));
  expect(pinned, "A module that loads with import() is also imported statically, so it ships in the startup chunk. Make the static import a dynamic one (or an `import type`).").toEqual([]);
});
