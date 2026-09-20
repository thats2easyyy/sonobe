/**
 * Headless node sizes against the patch editor's DOM. fixtures/node-sizes holds documents and the
 * sizes Chromium drew their nodes at on macOS (G1 retro: 245 nodes, Loop Builders of every type,
 * long and collapsed names, knob-style patches, layer nodes, and every patch type at its defaults),
 * measured while the prototype ran. Re-measure them when the node CSS changes.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { estimateGraphGeometry } from "./geometry.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/node-sizes");
const registry = createPatchRegistry();

interface Batch {
  doc: SonobeDocument;
  sizes: Record<string, { width: number; height: number }>;
}

describe("estimateGraphGeometry", () => {
  it("sizes nodes within 3 pt of the DOM for 98% of the fixture, with exact heights", () => {
    const rows: { id: string; dw: number; dh: number }[] = [];
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      const { doc, sizes } = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Batch;
      const geometry = estimateGraphGeometry(doc, registry, doc.project.root);
      expect(geometry.measured).toBe(false);
      for (const [id, dom] of Object.entries(sizes)) {
        const box = geometry.nodes.get(id);
        if (!box) continue;
        rows.push({ id: `${file}:${id}`, dw: box.width - dom.width, dh: box.height - dom.height });
      }
    }
    expect(rows.length).toBeGreaterThanOrEqual(240);
    const off = rows.filter((r) => Math.abs(r.dw) > 3);
    expect(
      off.length / rows.length,
      `wider than 3 pt off: ${off.map((r) => `${r.id} ${r.dw > 0 ? "+" : ""}${Math.round(r.dw)}`).join(", ")}`,
    ).toBeLessThanOrEqual(0.02);
    expect(rows.filter((r) => r.dh !== 0).map((r) => `${r.id} ${r.dh}`)).toEqual([]);
  });
});
