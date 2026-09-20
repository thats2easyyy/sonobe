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
import { estimateGraphGeometry, resolveGraphGeometry } from "./geometry.ts";
import type { SonobeHost } from "./host.ts";

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
      expect(geometry.measured.size).toBe(0);
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

describe("resolveGraphGeometry", () => {
  const file = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()[0]!;
  const { doc } = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Batch;
  const snap = { docId: "doc", doc, revision: 7, dirty: false };

  it("reuses the estimate for a revision and lays the editor's measured boxes over it", async () => {
    const plain = { registry } as unknown as SonobeHost;
    const first = await resolveGraphGeometry(plain, snap, doc.project.root);
    expect(await resolveGraphGeometry(plain, snap, doc.project.root)).toBe(first);
    const [id, box] = [...first.nodes].find(([key]) => !key.startsWith("@") && !key.startsWith("$"))!;
    let revision = 7;
    const measuring = {
      registry,
      graphGeometry: async ({ component }: { component: string }) => ({
        docId: "doc",
        component,
        revision,
        nodes: { [id]: { x: box.x + 500, y: box.y, width: box.width + 30.2, height: box.height, measured: true } },
      }),
    } as unknown as SonobeHost;
    const resolved = await resolveGraphGeometry(measuring, snap, doc.project.root);
    // A patch keeps its ui position; its size is what the editor measured (rounded up).
    expect(resolved.nodes.get(id)).toEqual({ ...box, width: box.width + 31 });
    expect([...resolved.measured]).toEqual([id]);
    expect(first.nodes.get(id)).toEqual(box);
    revision = 6;
    expect(await resolveGraphGeometry(measuring, snap, doc.project.root)).toBe(first);
  });
});
