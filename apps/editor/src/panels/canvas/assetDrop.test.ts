import { applyOps, createEmptyDocument, createRegistry, findLayer, type AssetRecord, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it, vi } from "vitest";
import type { EditorSession } from "../../state/session.ts";
import {
  classifyMediaFile,
  dragHasFiles,
  dropLabel,
  dropUndoLabel,
  fitMediaSize,
  getAssetImporter,
  isLottieJson,
  lottieSize,
  mediaLayerName,
  mediaLayerOps,
  normalizeImportResult,
  prepareDroppedFiles,
  type PreparedMedia,
} from "./assetDrop.ts";

const LOTTIE = { v: "5.7.4", fr: 30, w: 512, h: 256, layers: [] };
const photo: AssetRecord = { id: "sunset", kind: "image", name: "sunset.png", file: "sunset.png", width: 800, height: 600 };

const fileOf = (name: string, type: string, body: string = "x") => new File([body], name, { type });
const sessionFor = (doc: SonobeDocument, assets?: unknown) => ({ document: { getState: () => ({ doc }) }, ...(assets ? { assets } : {}) }) as unknown as EditorSession;

describe("classifying files", () => {
  it("recognizes images, videos, and Lottie files by type or extension", () => {
    expect(classifyMediaFile({ name: "photo.PNG", type: "" })).toBe("image");
    expect(classifyMediaFile({ name: "shot", type: "image/heic" })).toBe("image");
    expect(classifyMediaFile({ name: "clip.MOV", type: "" })).toBe("video");
    expect(classifyMediaFile({ name: "loader.json", type: "application/json" })).toBe("lottie");
    expect(classifyMediaFile({ name: "confetti.lottie", type: "" })).toBe("lottie");
    expect(classifyMediaFile({ name: "notes.pdf", type: "application/pdf" })).toBeNull();
  });

  it("checks Lottie JSON and reads its size", () => {
    expect(isLottieJson(LOTTIE)).toBe(true);
    expect(isLottieJson({ layers: [] })).toBe(false);
    expect(isLottieJson({ name: "package", version: "1" })).toBe(false);
    expect(lottieSize(LOTTIE)).toEqual([512, 256]);
    expect(lottieSize({ w: 0, h: 10 })).toBeNull();
  });

  it("names layers after files and fits media to the artboard", () => {
    expect(mediaLayerName("hero-photo@2x.png", "image")).toBe("hero-photo@2x");
    expect(mediaLayerName(".png", "image")).toBe("Image");
    expect(fitMediaSize([800, 600], [402, 874])).toEqual([402, 302]);
    expect(fitMediaSize([100, 50], [402, 874])).toEqual([100, 50]);
    expect(fitMediaSize(null, [402, 874])).toBeNull();
    expect(fitMediaSize([0, 10], [402, 874])).toBeNull();
  });

  it("describes a drag before the drop", () => {
    expect(dragHasFiles({ types: ["Files"] })).toBe(true);
    expect(dragHasFiles({ types: ["text/plain"] })).toBe(false);
    expect(dropLabel({ items: [{ kind: "file", type: "image/png" }] })).toBe("Add image");
    expect(dropLabel({ items: [{ kind: "file", type: "video/mp4" }] })).toBe("Add video");
    expect(dropLabel({ items: [{ kind: "file", type: "application/json" }] })).toBe("Add Lottie animation");
    expect(dropLabel({ items: [{ kind: "file", type: "" }, { kind: "file", type: "image/png" }, { kind: "string", type: "text/plain" }] })).toBe("Add 2 files");
  });
});

describe("the asset importer", () => {
  const doc = { ...createEmptyDocument(), assets: { sunset: photo } };

  it("reads records, ids, and { ok, asset(s) } results", () => {
    expect(normalizeImportResult(photo, doc).records).toEqual([photo]);
    expect(normalizeImportResult({ ok: true, assets: [photo, photo] }, doc).records).toEqual([photo]);
    expect(normalizeImportResult("sunset", doc).records).toEqual([photo]);
    expect(normalizeImportResult({ assetId: "sunset" }, doc).records).toEqual([photo]);
    expect(normalizeImportResult({ ok: false, error: { message: "That file is too large." } }, doc)).toEqual({ records: [], error: "That file is too large." });
  });

  it("reads the editor asset service's { ok, assetId, record } results and errors", async () => {
    expect(normalizeImportResult({ ok: true, assetId: "sunset", record: photo, reused: true }, doc).records).toEqual([photo]);
    expect(normalizeImportResult([{ ok: false, errorCode: "unsupported", error: "Sonobe can't use .xyz files." }], doc)).toEqual({ records: [], error: "Sonobe can't use .xyz files." });
    const importFile = vi.fn(async () => ({ ok: true, assetId: "sunset", record: photo }));
    const importFiles = vi.fn(async () => []);
    const file = fileOf("sunset.png", "image/png");
    expect((await getAssetImporter(sessionFor(doc, { importFile, importFiles }))!.importFile(file)).records).toEqual([photo]);
    // The service gets raw bytes, never the File: Chromium Files have a bytes() method that reads as "bytes".
    const arg = (importFile.mock.calls[0] as unknown[])[0] as { name: string; bytes: Uint8Array; mime: string };
    expect(arg).toMatchObject({ name: "sunset.png", mime: "image/png" });
    expect(arg.bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(arg.bytes)).toBe("x");
    expect(importFiles).not.toHaveBeenCalled();
  });

  it("detects the importer's shape", async () => {
    expect(getAssetImporter(sessionFor(doc))).toBeNull();
    const importFiles = vi.fn(async () => [photo]);
    const file = fileOf("sunset.png", "image/png");
    expect((await getAssetImporter(sessionFor(doc, { importFiles }))!.importFile(file)).records).toEqual([photo]);
    expect(importFiles).toHaveBeenCalledWith([expect.objectContaining({ name: "sunset.png", mime: "image/png", bytes: expect.any(Uint8Array) })]);
    // A batch-only import(files) that returns nothing for a single file gets the file in an array.
    const batch = vi.fn(async (arg: unknown) => (Array.isArray(arg) ? { ok: true, assets: [photo] } : undefined));
    expect((await getAssetImporter(sessionFor(doc, { import: batch }))!.importFile(file)).records).toEqual([photo]);
    expect(batch).toHaveBeenCalledTimes(2);
  });
});

describe("prepareDroppedFiles", () => {
  it("imports media through the importer and adds assets the importer didn't", async () => {
    const empty = createEmptyDocument();
    const importFile = vi.fn(async () => photo);
    const r = await prepareDroppedFiles(sessionFor(empty, { importFile }), [fileOf("sunset.png", "image/png"), fileOf("sunset copy.png", "image/png")]);
    expect(r.errors).toEqual([]);
    expect(r.items).toEqual([
      { kind: "image", name: "sunset", value: { asset: "sunset" }, natural: [800, 600] },
      { kind: "image", name: "sunset copy", value: { asset: "sunset" }, natural: [800, 600] },
    ]);
    expect(r.assetOps).toEqual([{ op: "addAsset", asset: photo }]);
    const inDoc = await prepareDroppedFiles(sessionFor({ ...empty, assets: { sunset: photo } }, { importFile }), [fileOf("sunset.png", "image/png")]);
    expect(inDoc.assetOps).toEqual([]);
  });

  it("measures media the importer didn't size", async () => {
    const record: AssetRecord = { id: "clip", kind: "video", name: "clip.mp4", file: "clip.mp4" };
    const measure = vi.fn(async () => [1920, 1080] as [number, number]);
    const r = await prepareDroppedFiles(sessionFor(createEmptyDocument(), { importFile: async () => record }), [fileOf("clip.mp4", "video/mp4")], { measure });
    expect(r.items[0]).toMatchObject({ kind: "video", natural: [1920, 1080] });
    expect(measure).toHaveBeenCalledOnce();
  });

  it("embeds small Lottie JSON without an importer and explains everything else", async () => {
    const r = await prepareDroppedFiles(sessionFor(createEmptyDocument()), [
      fileOf("loader.json", "application/json", JSON.stringify(LOTTIE)),
      fileOf("photo.png", "image/png"),
      fileOf("package.json", "application/json", '{"name":"x"}'),
      fileOf("notes.pdf", "application/pdf"),
    ]);
    expect(r.items).toEqual([{ kind: "lottie", name: "loader", value: { json: LOTTIE }, natural: [512, 256] }]);
    expect(r.errors).toEqual([
      "Couldn't add “photo.png”: this build of Sonobe can't import media files yet.",
      "“package.json” isn't a Lottie animation.",
      "“notes.pdf” isn't an image, a video, or a Lottie animation.",
    ]);
  });

  it("reports importer failures", async () => {
    const r = await prepareDroppedFiles(
      sessionFor(createEmptyDocument(), {
        importFile: async () => {
          throw new Error("Disk full");
        },
      }),
      [fileOf("photo.png", "image/png")],
    );
    expect(r.errors).toEqual(["Couldn't add “photo.png”: Disk full"]);
  });
});

describe("mediaLayerOps", () => {
  const items: PreparedMedia[] = [
    { kind: "image", name: "sunset", value: { asset: "sunset" }, natural: [800, 600] },
    { kind: "lottie", name: "loader", value: { json: LOTTIE }, natural: null },
  ];

  it("centers the first layer on the drop point, cascades the rest, and applies cleanly", () => {
    const doc = createEmptyDocument();
    const { ops, refs } = mediaLayerOps(items, { componentId: doc.project.root, center: [200, 300], parentId: null, parentWorld: null, artboard: [402, 874] });
    expect(refs).toEqual(["dropped0", "dropped1"]);
    const r = applyOps(doc, [{ op: "addAsset", asset: photo }, ...ops], { registry: createRegistry() });
    expect(r.errors).toEqual([]);
    const image = findLayer(r.doc.components[doc.project.root]!.layers, r.idMap.dropped0!)!.layer;
    expect(image).toMatchObject({ type: "image", name: "sunset", props: { position: [-1, 149], size: [402, 302], image: { asset: "sunset" } } });
    const lottie = findLayer(r.doc.components[doc.project.root]!.layers, r.idMap.dropped1!)!.layer;
    expect(lottie).toMatchObject({ type: "lottie", props: { position: [100, 200], size: [240, 240], animation: { json: LOTTIE } } });
  });

  it("converts into the parent group's space", () => {
    const world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 50, 0, 1];
    const { ops } = mediaLayerOps([items[0]!], { componentId: "main", center: [301, 201], parentId: "group", parentWorld: world, artboard: [402, 874] });
    expect(ops[0]).toMatchObject({ op: "addLayer", parent: "group", layer: { props: { position: [0, 0], size: [402, 302] } } });
  });

  it("labels the undo step", () => {
    expect(dropUndoLabel([items[0]!])).toBe("Add image “sunset”");
    expect(dropUndoLabel([items[1]!])).toBe("Add Lottie animation “loader”");
    expect(dropUndoLabel(items)).toBe("Add 2 media layers");
  });
});
