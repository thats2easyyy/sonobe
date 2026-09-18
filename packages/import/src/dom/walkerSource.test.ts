import { describe, expect, it } from "vitest";
import { bundleWalker, walkerModule } from "../../scripts/walker-bundle.ts";
import { WALKER_SOURCE } from "./walkerSource.ts";

describe("walker bundle", () => {
  it("matches src/dom/walk.ts (run node packages/import/scripts/build-walker.ts after changing the walker)", async () => {
    const bundle = await bundleWalker();
    expect(WALKER_SOURCE === bundle, "walkerSource.ts is stale: node packages/import/scripts/build-walker.ts").toBe(true);
    expect(walkerModule(bundle)).toContain("export const WALKER_SOURCE");
    // Injected into pages as-is: no imports, no zod.
    expect(bundle).not.toMatch(/\bimport\s*[{(]|zod/);
  });
});
