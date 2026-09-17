import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { CATALOG_DOC_FIELDS, externalLottiePlugin, leanCatalogChunk, leanCatalogPlugin } from "../scripts/player-bundle.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("web player bundle", () => {
  it("strips catalog documentation but keeps what runtime code reads", () => {
    const entry = {
      type: "popAnimation",
      name: "Pop Animation",
      summary: "Springs toward a number.",
      aliases: ["spring"],
      inputs: [{ key: "number", name: "Number", type: "number", description: "Target value." }],
      outputs: [],
      ...Object.fromEntries(CATALOG_DOC_FIELDS.map((field) => [field, `long ${field} text`])),
    };
    const lean = JSON.parse(leanCatalogChunk(JSON.stringify({ file: "animation-1.json", category: "animation", patches: [entry] })));
    expect(lean).toEqual({
      file: "animation-1.json",
      category: "animation",
      patches: [{ type: "popAnimation", name: "Pop Animation", summary: "Springs toward a number.", aliases: ["spring"], inputs: entry.inputs, outputs: [] }],
    });
  });

  it("leaves patch docs and lottie-web out of player.js", { timeout: 120_000 }, async () => {
    const result = await build({
      absWorkingDir: root,
      entryPoints: ["player/player.ts"],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: ["es2022", "safari16"],
      minify: true,
      write: false,
      metafile: true,
      logLevel: "silent",
      define: { __SONOBE_VERSION__: JSON.stringify("test") },
      plugins: [leanCatalogPlugin(), externalLottiePlugin()],
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.filter((p) => /node_modules[\\/]lottie-web/.test(p))).toEqual([]);
    expect(inputs.some((p) => p.startsWith("sonobe-external-lottie:"))).toBe(true);
    const output = Object.values(result.metafile.outputs)[0]!;
    const catalogBytes = Object.entries(output.inputs)
      .filter(([p]) => /packages[\\/]patches[\\/]catalog[\\/]/.test(p))
      .reduce((sum, [, info]) => sum + info.bytesInOutput, 0);
    // The full catalog was about 1.3 MB of the 2 MB player; without docs it's under half of that.
    expect(catalogBytes).toBeGreaterThan(0);
    expect(catalogBytes).toBeLessThan(700_000);
    expect(result.outputFiles[0]!.contents.length).toBeLessThan(1_300_000);
  });
});
