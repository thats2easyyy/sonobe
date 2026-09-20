import { describe, expect, it } from "vitest";
import { bundleSymbols, bundleWalker, symbolModule, walkerModule } from "../../scripts/walker-bundle.ts";
import { SYMBOL_APPLY_SOURCE, SYMBOL_COLLECT_SOURCE } from "./symbolSource.ts";
import { WALKER_SOURCE } from "./walkerSource.ts";

describe("walker bundle", () => {
  it("matches src/dom/walk.ts (run node packages/import/scripts/build-walker.ts after changing the walker)", async () => {
    const bundle = await bundleWalker();
    expect(WALKER_SOURCE === bundle, "walkerSource.ts is stale: node packages/import/scripts/build-walker.ts").toBe(true);
    expect(walkerModule(bundle)).toContain("export const WALKER_SOURCE");
    // Injected into pages as-is: no imports, no zod.
    expect(bundle).not.toMatch(/\bimport\s*[{(]|zod/);
  });

  it("keeps the SF Symbol page scripts in sync with src/dom/symbols.ts", async () => {
    const bundles = await bundleSymbols();
    expect(SYMBOL_COLLECT_SOURCE === bundles.collect && SYMBOL_APPLY_SOURCE === bundles.apply, "symbolSource.ts is stale: node packages/import/scripts/build-walker.ts").toBe(true);
    expect(symbolModule(bundles)).toContain("export const SYMBOL_APPLY_SOURCE");
    for (const bundle of [bundles.collect, bundles.apply]) {
      expect(bundle).not.toMatch(/\bimport\s*[{(]|zod/);
      // Small: only what the page needs, not the whole walker.
      expect(bundle.length).toBeLessThan(8_000);
    }
  });
});
