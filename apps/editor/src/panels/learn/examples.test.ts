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

  it("bundles an example's knobs and asset files", async () => {
    const deck = getExamples().find((e) => e.folder === "16-noddit-deck");
    expect(deck).toBeDefined();
    const doc = loadExampleDocument(deck!);
    expect(doc.knobs?.presets.map((p) => [p.name, !!p.locked])).toEqual([
      ["Proposal", false],
      ["Shipped app", true],
    ]);
    const files = Object.values(doc.assets).map((a) => a.file);
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((file) => !deck!.assets[file])).toEqual([]);
    // A data: URL, which fetch() reads in the browser and in the desktop app's file:// pages alike.
    expect(await deck!.assets[doc.assets.malasadas!.file]!()).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("hands an example's asset files to the host before the copy opens", async () => {
    let doc = createEmptyDocument({ name: "Photo" });
    const r = applyOps(doc, [{ op: "addAsset", asset: { id: "dot", kind: "image", name: "Dot", file: "abc.svg", mime: "image/svg+xml" } }], { registry });
    expect(r.ok).toBe(true);
    doc = r.doc;
    const files = Object.fromEntries(Object.entries(serializeDocument(doc)).map(([path, text]) => [`../../../../../examples/photo/${path}`, text]));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const [example] = groupExampleFiles(files, { "../../../../../examples/photo/assets/abc.svg": async () => `data:image/svg+xml,${encodeURIComponent(svg)}` });
    expect(Object.keys(example!.assets)).toEqual(["abc.svg"]);

    const document = createDocumentStore({ registry });
    const put: { path: string | null; file: string; name: string; bytes: number }[] = [];
    const host = { putAssetBytes: (path: string | null, file: string, bytes: ArrayBuffer | Uint8Array) => void put.push({ path, file, name: document.getState().doc.project.name, bytes: bytes.byteLength }) };
    const opened = await openExample({ document, selection: createSelectionStore(), confirmDiscardChanges: async () => true, host }, example!);
    expect(opened).toEqual({ ok: true });
    // Held for the unsaved copy (path null), before the copy replaced the old document.
    expect(put).toEqual([{ path: null, file: "abc.svg", name: "Untitled", bytes: svg.length }]);

    const stored: string[] = [];
    const again = await openExample({ document, selection: createSelectionStore(), confirmDiscardChanges: async () => true, host: null, assets: { storeBytes: (file) => void stored.push(`${file} in ${document.getState().doc.project.name}`) } }, example!);
    expect(again).toEqual({ ok: true });
    expect(stored).toEqual(["abc.svg in Photo"]);
  });
});
