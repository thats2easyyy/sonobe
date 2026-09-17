// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, deviceScreenSize, findLayer, type Op, type SonobeDocument } from "@sonobe/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { createAssetService } from "../../state/assets.ts";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { dragMediaKinds, dropFilesOnLayers, mediaNoun, planLayerFileDrop } from "./mediaDrop.ts";

const registry = getRegistry();
let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
});

function build(ops: Op[]): SonobeDocument {
  const result = applyOps(createEmptyDocument(), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const fixture = () =>
  build([
    { op: "addLayer", layer: { id: "title", type: "text", name: "Title" } },
    { op: "addLayer", layer: { id: "card", type: "group", name: "Card", props: { size: [300, 200] }, children: [{ id: "bg", type: "rectangle", name: "Background" }, { id: "badge", type: "oval", name: "Badge" }] } },
    { op: "addLayer", layer: { id: "photo", type: "image", name: "Photo" } },
    { op: "addLayer", layer: { id: "clip", type: "video", name: "Clip" } },
    { op: "addPatch", patch: { id: "pick", type: "optionPicker", typeParam: "image", ui: { x: 0, y: 0 } } },
  ]);

describe("planLayerFileDrop", () => {
  it("replaces a media layer's content, goes into groups, and lands in front of other layers", () => {
    const doc = fixture();
    expect(planLayerFileDrop(doc, "main", registry, "photo", ["image"])).toEqual({ kind: "replace", layerId: "photo", prop: "image", label: "Replace image in Photo" });
    expect(planLayerFileDrop(doc, "main", registry, "clip", ["video"])).toMatchObject({ kind: "replace", layerId: "clip", prop: "video" });
    expect(planLayerFileDrop(doc, "main", registry, "card", ["image"])).toEqual({ kind: "insert", parentId: "card", frame: [300, 200], label: "Add image to Card", anchorName: "Card" });
    expect(planLayerFileDrop(doc, "main", registry, "bg", ["lottie"])).toEqual({ kind: "insert", parentId: "card", index: 1, frame: [300, 200], label: "Add Lottie animation above Background", anchorName: "Background" });
    expect(planLayerFileDrop(doc, "main", registry, "photo", ["video"])).toMatchObject({ kind: "insert", parentId: null, index: 3, label: "Add video above Photo" });
    expect(planLayerFileDrop(doc, "main", registry, "photo", ["image", "image"])).toMatchObject({ kind: "insert", label: "Add 2 files above Photo" });
    expect(planLayerFileDrop(doc, "main", registry, null, ["image"])).toEqual({ kind: "insert", parentId: null, frame: deviceScreenSize(doc.project.device), label: "Add image" });
    expect(planLayerFileDrop(doc, "nope", registry, null, ["image"])).toBeUndefined();
  });

  it("doesn't replace media a patch drives", () => {
    const doc = applyOps(fixture(), [{ op: "connect", from: "pick.output", to: "@photo.image" }], { registry }).doc;
    expect(findLayer(doc.components.main!.layers, "photo")!.layer.props.image).toEqual({ link: "pick.output" });
    expect(planLayerFileDrop(doc, "main", registry, "photo", ["image"])).toMatchObject({ kind: "insert", label: "Add image above Photo" });
  });

  it("names drags by kind", () => {
    expect(dragMediaKinds([{ kind: "file", type: "image/png" }, { kind: "file", type: "video/mp4" }, { kind: "file", type: "text/plain" }, { kind: "string", type: "text/uri-list" }])).toEqual(["image", "video", null]);
    expect(mediaNoun([null])).toBe("file");
    expect(mediaNoun(["video"])).toBe("video");
  });
});

describe("dropFilesOnLayers", () => {
  const png = (seed: number, name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, 2, 3])], name, { type: "image/png" });

  function setup() {
    session = createEditorSession({ host: null, registry, document: fixture(), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
    const s = session;
    const service = createAssetService({ document: s.document, host: null, probe: async () => ({ width: 600, height: 400 }) });
    vi.spyOn(s.assets, "importFile").mockImplementation((file, options) => service.importFile(file, options));
    return s;
  }

  it("replaces an image layer's content", async () => {
    const s = setup();
    const result = await dropFilesOnLayers(s, "main", "photo", [png(1, "sunset.png")]);
    expect(result).toMatchObject({ ok: true, layerIds: [], errors: [], label: "Replace image in Photo" });
    const image = findLayer(s.document.getState().doc.components.main!.layers, "photo")!.layer.props.image as { asset: string };
    expect(s.document.getState().doc.assets[image.asset]).toMatchObject({ kind: "image", name: "sunset" });
    expect(s.document.getState().historyEntries().map((e) => e.label)).toEqual(["Replace image in Photo", 'Import "sunset"']);
  });

  it("adds media layers inside a group, sized to fit, and in front of a sibling", async () => {
    const s = setup();
    const inGroup = await dropFilesOnLayers(s, "main", "card", [png(2, "hero.png")]);
    expect(inGroup.ok).toBe(true);
    const card = findLayer(s.document.getState().doc.components.main!.layers, "card")!.layer;
    const added = card.children!.at(-1)!;
    expect(inGroup.layerIds).toEqual([added.id]);
    expect(added).toMatchObject({ type: "image", name: "hero", props: { size: [300, 200], position: [0, 0] } });
    expect(s.document.getState().historyEntries()[0]!.label).toBe("Add image “hero” to Card");

    const above = await dropFilesOnLayers(s, "main", "title", [png(3, "logo.png")]);
    expect(above.ok).toBe(true);
    expect(s.document.getState().doc.components.main!.layers.map((l) => l.id).slice(0, 2)).toEqual(["title", above.layerIds[0]]);

    const unsupported = await dropFilesOnLayers(s, "main", null, [new File(["hi"], "notes.txt", { type: "text/plain" })]);
    expect(unsupported.ok).toBe(false);
    expect(unsupported.errors[0]).toContain("notes.txt");
  });
});
