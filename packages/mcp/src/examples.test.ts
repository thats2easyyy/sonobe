/**
 * The examples catalog behind list_examples and get_example: every example in the registry
 * (examples/recipes) is listed with no list of its own, and its recipe batches, applied through
 * apply_ops to a blank document, build the very document the example ships.
 */

import { serializeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRecipeDocument } from "../../../examples/lib/recipe.ts";
import { RECIPES } from "../../../examples/recipes/index.ts";
import { batchOps, defaultExamples, exampleTextFiles, loadExamples, parseExamplesTable, readmeSections } from "./examples.ts";
import { connectClient, tempProject, type TempProject, type TestClient } from "./test-helpers.ts";

const registry = createPatchRegistry();

describe("the examples catalog", () => {
  it("lists every example in the registry, in its order, with the README table's words", () => {
    const catalog = defaultExamples();
    expect(catalog.list().map((e) => e.id)).toEqual(RECIPES.map((r) => r.folder));
    for (const entry of catalog.list()) {
      expect(entry.readme, entry.id).toContain(`# ${entry.name}`);
      expect(entry.scenarios?.length, entry.id).toBeGreaterThan(0);
      expect(entry.keyPatchNames.length, `${entry.id} has a row in examples/README.md`).toBeGreaterThan(0);
      const built = catalog.build(entry, registry);
      // Every key patch the table names resolves to a patch type the example uses.
      expect(built.keyPatches.length, entry.id).toBe(entry.keyPatchNames.length);
      for (const type of built.keyPatches) expect(built.patchTypes, entry.id).toContain(type);
    }
    expect(catalog.list()[9]).toMatchObject({ id: "10-swipe-cards", teaches: "Per-copy state with loops, throws, deck depth" });
    expect(exampleTextFiles()).toContain("10-swipe-cards/test.json");
  });

  it("finds examples by id, number, bare name or title, and suggests close ones", () => {
    const catalog = defaultExamples();
    for (const ref of ["10-swipe-cards", "10", "010", "swipe-cards", "Swipe Cards", "swipe cards"])
      expect(catalog.get(ref)?.id, ref).toBe("10-swipe-cards");
    expect(catalog.get("swipe-crads")).toBeUndefined();
    expect(catalog.suggest("swipe-crads")).toContain("10-swipe-cards");
  });

  it("still lists examples from their recipes alone when there's no examples folder", () => {
    const bare = loadExamples({ dir: undefined });
    const entry = bare.get("08")!;
    expect(entry).toMatchObject({ id: "08-bottom-sheet", teaches: entry.recipe.description, keyPatchNames: [] });
    expect(entry.readme).toBeUndefined();
    // Key patches fall back to the patch types the example uses most.
    expect(bare.build(entry, registry).keyPatches).toHaveLength(5);
  });

  it("parses the examples table and README sections", () => {
    const rows = parseExamplesTable("| # | Example | You'll learn | Key patches |\n|---|---|---|---|\n| 04 | [Carousel Paging](04-carousel-paging/) | Paging scroll | Scroll (paging), Loop |");
    expect(rows.get("04-carousel-paging")).toEqual({ teaches: "Paging scroll", keyPatches: ["Scroll", "Loop"] });
    const { intro, sections } = readmeSections("# Title\n\nIntro with a [link](../../docs/x.md).\n\nLevel 1\n\n## What you'll learn\n\n- A\n\n## Check it\nrun");
    expect(intro).toBe("Intro with a link.");
    expect([...sections.keys()]).toEqual(["What you'll learn", "Check it"]);
    expect(sections.get("What you'll learn")).toBe("- A");
  });

  it("splits long recipes into batches at op boundaries, and keeps recipes with refs whole", () => {
    const ops = Array.from({ length: 320 }, (_, i) => ({ op: "rename" as const, id: `p${i}`, name: `P ${i}` }));
    expect(batchOps(ops).map((b) => b.length)).toEqual([150, 150, 20]);
    expect(batchOps([...ops, { op: "addPatch", patch: { ref: "a", type: "switch" } }])).toHaveLength(1);
  });
});

describe("list_examples and get_example", () => {
  let project: TempProject;
  let client: TestClient;

  beforeAll(async () => {
    project = await tempProject({ name: "Examples" });
    client = await connectClient(project.host);
  });

  afterAll(async () => {
    await client.close();
    await project.cleanup();
  });

  it("lists what each example teaches and its key patches, and filters by words and patch types", async () => {
    const all = await client.call("list_examples");
    expect(all.isError).toBe(false);
    for (const recipe of RECIPES) expect(all.text).toContain(`${recipe.folder} · ${recipe.name}: `);
    expect(all.text).toContain("10-swipe-cards · Swipe Cards: Per-copy state with loops, throws, deck depth. Key patches: loop, swipe, gesture, loopSum, springAnimation.");
    expect(all.structured).toMatchObject({ total: RECIPES.length });
    const swipe = await client.call("list_examples", { query: "swipe" });
    expect((swipe.structured.examples as { id: string }[]).map((e) => e.id)).toContain("10-swipe-cards");
    expect(swipe.text).not.toContain("01-tap-to-grow");
    const byType = await client.call("list_examples", { query: "springAnimation" });
    expect((byType.structured.examples as { id: string }[]).map((e) => e.id)).toEqual(expect.arrayContaining(["08-bottom-sheet", "09-drag-and-snap"]));
    const none = await client.call("list_examples", { query: "zzz nothing" });
    expect(none.text).toContain('No example matches "zzz nothing"');
  });

  it("teaches one example: the patch chain, common mistakes and the scenarios it passes", async () => {
    const r = await client.call("get_example", { id: "10" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/^# 10 Swipe Cards \(10-swipe-cards\)\nA deck of dinner ideas\./);
    expect(r.text).toContain("Key patches: loop, swipe, gesture, loopSum, springAnimation.");
    for (const heading of ["## What you'll learn", "## The patch chain", "## Common mistakes", "## Scenarios it passes"])
      expect(r.text).toContain(heading);
    expect(r.text).not.toContain("## Build it step by step");
    expect(r.text).toContain("- A fast flick left throws the card away: Card 2 is gone;");
    expect(r.text).not.toContain("](../../docs");
    expect(r.structured).toMatchObject({ id: "10-swipe-cards", batches: 1, keyPatches: ["loop", "swipe", "gesture", "loopSum", "springAnimation"] });

    const full = await client.call("get_example", { id: "Swipe Cards", detail: "full" });
    expect(full.text).toContain("## Build it step by step");
    expect(full.text).toContain("## Variations");
    expect(full.text).toContain("## Outline");
    expect(full.text).toContain("patch card_swipe swipe");

    const typo = await client.call("get_example", { id: "swipe-crads" });
    expect(typo.structured.error).toMatchObject({ code: "unknown_example" });
    expect(typo.text).toContain('There\'s no example "swipe-crads". Did you mean "10-swipe-cards"?');
    const batch = await client.call("get_example", { id: "01", detail: "ops", batch: 2 });
    expect(batch.structured.error).toMatchObject({ code: "invalid_batch" });
  });

  it("gives recipes as apply_ops batches that build the example itself, for every example", async () => {
    for (const recipe of RECIPES) {
      const target = await tempProject({ name: recipe.name });
      const c = await connectClient(target.host);
      try {
        const first = await client.call("get_example", { id: recipe.folder, detail: "ops" });
        expect(first.isError, first.text).toBe(false);
        const batches = first.structured.batches as number;
        for (let i = 1; i <= batches; i++) {
          const r = i === 1 ? first : await client.call("get_example", { id: recipe.folder, detail: "ops", batch: i });
          const json = /```json\n([\s\S]*?)\n```/.exec(r.text)![1]!;
          const applied = await c.call("apply_ops", { ops: JSON.parse(json) });
          expect(applied.isError, `${recipe.folder} batch ${i}: ${applied.text}`).toBe(false);
        }
        const { doc } = await target.host.getDocument();
        const example = buildRecipeDocument(recipe, registry);
        const files = serializeDocument(doc);
        const expected = serializeDocument(example);
        for (const [file, text] of Object.entries(expected)) {
          if (file === "project.json") continue;
          expect(files[file], `${recipe.folder}: ${file}`).toBe(text);
        }
        expect(doc.project.background).toBe(example.project.background);
        const errors = await c.call("get_diagnostics", { severity: "error" });
        expect(errors.text, recipe.folder).toContain("No error-level diagnostics");
      } finally {
        await c.close();
        await target.cleanup();
      }
    }
  }, 60_000);
});
