/** Headless graph drawings: drawComponentGraph draws what the patch editor does, issues included. */

import { buildDoc } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { drawComponentGraph } from "./componentViews.ts";
import { estimateGraphGeometry } from "./geometry.ts";

const registry = createPatchRegistry();

/** The markup of one node in a drawing. */
const nodeMarkup = (svg: string, id: string) => {
  const start = svg.indexOf(`<g data-node="${id}"`);
  return start < 0 ? "" : svg.slice(start, svg.indexOf("</g>", start));
};

describe("drawComponentGraph", () => {
  it("draws a node's issue badge and outline, as the editor does, in the box sized for them", () => {
    const doc = buildDoc({ patches: { t: { type: "switch", name: "Flip" }, ok: { type: "switch", name: "Fine" } } }, registry);
    // A cable from a patch that isn't there: an error on t.
    (doc.components.main!.patches.t!.inputs as Record<string, unknown>).flip = { link: "gone.output" };
    const geometry = estimateGraphGeometry(doc, registry, "main");
    const { svg } = drawComponentGraph(doc, registry, "main", geometry);
    const broken = nodeMarkup(svg, "t");
    expect(broken).toMatch(/<circle[^>]*r="5"/);
    expect(broken).toContain('stroke-opacity="0.55"');
    const fine = nodeMarkup(svg, "ok");
    expect(fine).not.toMatch(/<circle[^>]*r="5"/);
    expect(fine).not.toContain('stroke-opacity="0.55"');
  });
});
