import { applyOps, createEmptyDocument, serializeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "../../state/document.ts";
import { createSelectionStore } from "../../state/selection.ts";
import { examplesForGuide, examplesUsingPatch, getExamples, groupExampleFiles, loadExampleDocument, openExample } from "./examples.ts";

const registry = createPatchRegistry();

function exampleFiles(folder: string, name: string, meta: Record<string, unknown> = {}) {
  let doc = createEmptyDocument({ name });
  const r = applyOps(
    doc,
    [
      { op: "addPatch", patch: { id: "tap", type: "interaction" } },
      { op: "addPatch", patch: { id: "pop", type: "popAnimation" } },
      { op: "setProject", changes: { meta } },
    ],
    { registry },
  );
  expect(r.ok).toBe(true);
  doc = r.doc;
  return Object.fromEntries(Object.entries(serializeDocument(doc)).map(([path, text]) => [`../../../../../examples/${folder}/${path}`, text]));
}

describe("examples", () => {
  it("groups files into example projects with their patch types", () => {
    const examples = groupExampleFiles({
      ...exampleFiles("tap-to-zoom.sonobe", "Tap to Zoom", { description: "Tap a photo to zoom it.", guides: ["01-first-prototype"] }),
      "../../../../../examples/stray/readme.json": "{}",
      "../../../../../examples/broken/project.json": "{ not json",
    });
    expect(examples).toHaveLength(1);
    expect(examples[0]).toMatchObject({ id: "tap-to-zoom", folder: "tap-to-zoom.sonobe", name: "Tap to Zoom", description: "Tap a photo to zoom it.", patchTypes: ["interaction", "popAnimation"], guides: ["01-first-prototype"] });
    expect(examplesUsingPatch(examples, "popAnimation")).toHaveLength(1);
    expect(examplesUsingPatch(examples, "counter")).toHaveLength(0);
    expect(examplesForGuide(examples, { slug: "01-first-prototype", markdown: "" })).toHaveLength(1);
    expect(examplesForGuide(examples, { slug: "03-states-and-pulses", markdown: "Open examples/tap-to-zoom to follow along." })).toHaveLength(1);
    expect(examplesForGuide(examples, { slug: "07-loops", markdown: "" })).toHaveLength(0);
  });

  it("loads an example as a new unsaved document", async () => {
    const [example] = groupExampleFiles(exampleFiles("tap.sonobe", "Tap"));
    expect(loadExampleDocument(example!).components.main?.patches.pop?.type).toBe("popAnimation");

    const document = createDocumentStore({ registry, document: createEmptyDocument({ name: "Mine" }), projectPath: "/tmp/Mine.sonobe" });
    const selection = createSelectionStore();
    const declined = await openExample({ document, selection, confirmDiscardChanges: async () => false }, example!);
    expect(declined).toEqual({ ok: false, cancelled: true });
    expect(document.getState().doc.project.name).toBe("Mine");

    const opened = await openExample({ document, selection, confirmDiscardChanges: async () => true }, example!);
    expect(opened).toEqual({ ok: true });
    expect(document.getState()).toMatchObject({ projectPath: null, dirty: true });
    expect(document.getState().doc.project.name).toBe("Tap");
    expect(selection.getState().componentPath).toEqual(["main"]);
  });

  it("reports examples that don't parse", async () => {
    const [example] = groupExampleFiles({ "../../../../../examples/bad/project.json": '{"formatVersion": 1}' });
    const document = createDocumentStore({ registry });
    const result = await openExample({ document, selection: createSelectionStore(), confirmDiscardChanges: async () => true }, example!);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("bundles whatever examples the repo has", () => {
    expect(Array.isArray(getExamples())).toBe(true);
  });
});
