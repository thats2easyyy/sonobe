/**
 * The example prototypes. Every folder loads through the headless MCP host with zero error
 * diagnostics, matches its recipe, lays its patch graphs out with room between the nodes, uses only
 * implemented patch types, documents real ids in its README, and passes the scripted scenarios in
 * its test.json.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findLayer, type Component, type Diagnostic, type SonobeDocument } from "@sonobe/core";
import { componentNodeBoxes } from "@sonobe/core/graph";
import { createRuntime } from "@sonobe/engine";
import { createHeadlessHost } from "@sonobe/mcp";
import { createPatchRegistry } from "@sonobe/patches";
import { afterAll, describe, expect, it } from "vitest";
import { EXAMPLES_DIR, listExampleFolders, projectDrift } from "./lib/disk.ts";
import { buildRecipe } from "./lib/recipe.ts";
import { formatReport, parseExampleTest, runScenario, type ExampleTest } from "./lib/scenarios.ts";
import { RECIPES } from "./recipes/index.ts";

const registry = createPatchRegistry();
const host = createHeadlessHost({ registry, maxSimSessions: 2 });
const folders = listExampleFolders();

const README_SECTIONS = ["## What you'll learn", "## Build it step by step", "## The patch chain", "## Variations"];

/**
 * Core reports pulse_into_state for any pulse wired into a boolean input, including Or, which is how the
 * guides merge two pulses into one (docs/guides/02-isat.md). Only that case is tolerated here.
 */
function isPulseMerge(d: Diagnostic, root: Component): boolean {
  return d.code === "pulse_into_state" && d.itemIds.some((id) => root.patches[id]?.type === "or");
}

/** The least room between two patch nodes, across or down. */
const NODE_CLEARANCE = 12;

/**
 * Pairs of patch nodes closer than NODE_CLEARANCE in every component, as the patch editor draws them
 * with the prototype running a second (the root's live values; slots are there before values arrive).
 */
function crowdedNodes(doc: SonobeDocument): string[] {
  const runtime = createRuntime(doc, { registry, deterministic: true, fps: 60 });
  for (let i = 0; i < 60; i++) runtime.step();
  const crowded: string[] = [];
  for (const [id, component] of Object.entries(doc.components)) {
    const live = id === doc.project.root ? { live: (address: string) => runtime.getRawValue(address) } : {};
    const boxes = [...componentNodeBoxes(doc, registry, id, live)].filter(([node]) => Object.hasOwn(component.patches, node));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, ra] = boxes[i]!;
        const [b, rb] = boxes[j]!;
        const across = Math.max(ra.x - (rb.x + rb.width), rb.x - (ra.x + ra.width));
        const down = Math.max(ra.y - (rb.y + rb.height), rb.y - (ra.y + ra.height));
        if (Math.max(across, down) < NODE_CLEARANCE) crowded.push(`${id}: ${a} and ${b} (${Math.round(across)} across, ${Math.round(down)} down)`);
      }
    }
  }
  runtime.dispose();
  return crowded;
}

afterAll(async () => {
  await host.close();
});

describe("examples", () => {
  it("has a project folder for every recipe, and a recipe for every folder", () => {
    expect(folders).toEqual(RECIPES.map((r) => r.folder).sort());
  });

  it("lists recipes in learning order", () => {
    const numbers = RECIPES.map((r) => Number(r.folder.slice(0, 2)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("links only to guides that exist", () => {
    for (const recipe of RECIPES) {
      for (const slug of recipe.guides) expect(existsSync(path.join(EXAMPLES_DIR, "..", "docs", "guides", `${slug}.md`)), `${recipe.folder}: ${slug}`).toBe(true);
    }
  });
});

for (const recipe of RECIPES) {
  const dir = path.join(EXAMPLES_DIR, recipe.folder);
  const testPath = path.join(dir, "test.json");
  const readmePath = path.join(dir, "README.md");
  let exampleTest: ExampleTest | undefined;
  let testError: unknown;
  try {
    exampleTest = parseExampleTest(JSON.parse(readFileSync(testPath, "utf8")), `examples/${recipe.folder}/test.json`);
  } catch (err) {
    testError = err;
  }

  describe(recipe.folder, () => {
    const open = async () => (await host.openDocument(dir)).docId;

    it("loads with zero error diagnostics", async () => {
      const docId = await open();
      const { diagnostics } = await host.diagnostics(docId);
      const errors = diagnostics.filter((d) => d.severity === "error");
      expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
      const { doc } = await host.getDocument(docId);
      const root = doc.components[doc.project.root]!;
      const warnings = diagnostics.filter((d) => d.severity === "warning" && !isPulseMerge(d, root));
      expect(warnings.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    });

    it("matches its recipe (run node examples/build.ts to regenerate)", async () => {
      const built = await buildRecipe(recipe, registry);
      expect(projectDrift(dir, built.doc, built.files)).toEqual({ changed: [], extra: [] });
    });

    it("keeps its patch nodes apart (run node examples/build.ts to lay them out again)", async () => {
      const { doc } = await host.getDocument(await open());
      expect(crowdedNodes(doc)).toEqual([]);
    });

    it("uses only implemented patch types", async () => {
      const { doc } = await host.getDocument(await open());
      const types = Object.values(doc.components).flatMap((c) => Object.values(c.patches).map((p) => p.type));
      expect(types.filter((t) => !registry.isImplemented(t))).toEqual([]);
    });

    it("has a README whose ids and addresses exist", async () => {
      expect(existsSync(readmePath)).toBe(true);
      const readme = readFileSync(readmePath, "utf8");
      for (const section of README_SECTIONS) expect(readme, `missing "${section}"`).toContain(section);
      const { doc } = await host.getDocument(await open());
      const root = doc.components[doc.project.root]!;
      const missing: string[] = [];
      for (const m of readme.matchAll(/`@([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z]+)?(?:#\d+)?`/g)) {
        if (!findLayer(root.layers, m[1]!)) missing.push(m[0]);
      }
      for (const m of readme.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]*)(?:\.([A-Za-z0-9]+))?`/g)) {
        const id = m[1]!;
        if (!root.patches[id] && !findLayer(root.layers, id)) missing.push(m[0]);
      }
      expect(missing, "README names ids that aren't in the project").toEqual([]);
    });

    it("has a valid test.json", () => {
      expect(testError).toBeUndefined();
    });

    for (const scenario of exampleTest?.scenarios ?? []) {
      it(`simulates: ${scenario.name}`, async () => {
        const report = await runScenario(host, await open(), scenario);
        expect(report.pass, formatReport(report)).toBe(true);
      });
    }
  });
}
