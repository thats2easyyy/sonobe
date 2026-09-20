/**
 * Node sizes: the shared estimate (@sonobe/core/graph, with the editor's canvas measurer and the
 * page's own live values) against the boxes the patch editor draws, for the documents in
 * packages/mcp/fixtures/node-sizes (Loop Builders of every type, long and collapsed names, knob chips
 * of every knob type, layer nodes, and every patch type at its defaults). It guards the estimate
 * against drift in the node CSS.
 *
 * SONOBE_UPDATE_NODE_SIZES=1 writes the measured sizes back into the fixture, which the headless
 * test in packages/mcp/src/geometry.test.ts compares the SF Pro table against. Update it on macOS.
 */

import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openEditor } from "./helpers.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(repo, "packages/mcp/fixtures/node-sizes");
const update = process.env.SONOBE_UPDATE_NODE_SIZES === "1";

interface Row {
  id: string;
  dom: { width: number; height: number };
  estimate: { width: number; height: number };
  /** Without live values, as inserts and Tidy Up place nodes before they run. */
  valueFree: { width: number; height: number };
}

test("the node size estimate matches what the patch editor draws", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 3400, height: 2200 });
  await openEditor(page);
  await page.evaluate(() => window.__sonobe!.layout().setViewMode("patches"));
  const all: Row[] = [];
  for (const file of readdirSync(fixtures).filter((f) => f.endsWith(".json")).sort()) {
    const fixture = JSON.parse(readFileSync(path.join(fixtures, file), "utf8"));
    await page.evaluate((doc) => window.__sonobe!.session.document.getState().replaceDocument(doc), fixture.doc);
    await page.waitForTimeout(500);
    await page.locator('[aria-label="Zoom to fit"]').first().click();
    // Let the prototype run a second (live values), then hold it so the DOM and the runtime agree.
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__sonobe!.session.runtime.pause());
    await page.waitForTimeout(600);
    const rows = await page.evaluate(
      async ({ core }) => {
        const s = window.__sonobe!;
        const graph = await import(/* @vite-ignore */ core);
        const { nodeTextMeasurer } = await import(/* @vite-ignore */ "/src/panels/patch-editor/model/measure.ts");
        const { diagnosticsFor } = await import(/* @vite-ignore */ "/src/state/registry.ts");
        const doc = s.doc();
        const diagnostics = [...diagnosticsFor(doc, s.session.registry), ...s.session.runtime.state.getState().diagnostics];
        const model = graph.deriveGraph({ doc, componentId: doc.project.root, registry: s.session.registry, diagnostics });
        const out: { id: string; dom: { width: number; height: number }; estimate: { width: number; height: number }; valueFree: { width: number; height: number } }[] = [];
        for (const node of model.nodes) {
          if (node.type === "comment") continue;
          const el = document.querySelector<HTMLElement>(`.sb-pe .react-flow__node[data-id="${CSS.escape(node.id)}"]`);
          if (!el) continue;
          const estimate = graph.estimateNodeSize(node.data, { measure: nodeTextMeasurer(), live: (address: string) => s.session.runtime.runtime.getRawValue(address) });
          const valueFree = graph.estimateNodeSize(node.data, { measure: nodeTextMeasurer() });
          out.push({ id: node.id, dom: { width: el.offsetWidth, height: el.offsetHeight }, estimate, valueFree });
        }
        return out;
      },
      { core: `/@fs${path.join(repo, "packages/core/src/graph/index.ts")}` },
    );
    all.push(...rows.map((r) => ({ ...r, id: `${file}:${r.id}` })));
    if (update) writeFileSync(path.join(fixtures, file), JSON.stringify({ ...fixture, sizes: Object.fromEntries(rows.map((r) => [r.id, r.dom])) }));
    await page.evaluate(() => window.__sonobe!.session.runtime.play());
  }
  expect(all.length).toBeGreaterThanOrEqual(240);
  const off = all.filter((r) => Math.abs(r.estimate.width - r.dom.width) > 3);
  expect(off.length / all.length, off.map((r) => `${r.id} dom ${r.dom.width} estimate ${r.estimate.width}`).join("; ")).toBeLessThanOrEqual(0.02);
  expect(all.filter((r) => Math.abs(r.estimate.height - r.dom.height) > 0.5).map((r) => `${r.id} dom ${r.dom.height} estimate ${r.estimate.height}`)).toEqual([]);
  // Live values sit in slots that are there before they arrive, so a node mounts at the width it keeps,
  // and the value-free estimate that places inserts matches it, except where json and any outputs wait
  // for their value's kind (Shape, JSON Array and the like, 8 of 254 on macOS).
  const unplaced = all.filter((r) => Math.abs(r.valueFree.width - r.dom.width) > 3);
  expect(unplaced.length / all.length, unplaced.map((r) => `${r.id} dom ${r.dom.width} value-free ${r.valueFree.width}`).join("; ")).toBeLessThanOrEqual(0.04);
});
