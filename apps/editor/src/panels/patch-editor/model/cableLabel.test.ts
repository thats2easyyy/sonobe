import { getDiagnostics } from "@sonobe/core";
import { deriveGraph } from "@sonobe/core/graph";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { cableLabel, nodeTitles } from "./cableLabel.ts";

const registry = createPatchRegistry();
const doc = createDemoDocument(registry);
const model = deriveGraph({ doc, componentId: "main", registry, diagnostics: getDiagnostics(doc, registry) });

describe("cableLabel", () => {
  it("names both ends by the titles and port names people see, then the type", () => {
    const titles = nodeTitles(model);
    const labels = model.edges.map((e) => cableLabel(model, titles, e));
    expect(labels.every((l) => !/\b(zoom_spring|zoomed|@photo)\b/.test(l))).toBe(true);
    const cable = model.edges.find((e) => e.data.to === "zoom_spring.number")!;
    const label = cableLabel(model, titles, cable);
    expect(label).toBe("Zoomed On to Zoom Spring Number, on/off");
  });
});
