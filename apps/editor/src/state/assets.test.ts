import { createEmptyDocument } from "@sonobe/core";
import { describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../host/browserHost.ts";
import { assetKindFor, createAssetDropHandlers, createAssetService, dragHasFiles, fileExtension, filesFromDataTransfer } from "./assets.ts";
import { sha256HexSync } from "./bytes.ts";
import { createDocumentStore } from "./document.ts";
import { getRegistry } from "./registry.ts";

const registry = getRegistry();
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function setup(withHost = true) {
  const storage = createMemoryProjectStorage();
  const host = withHost ? createBrowserHost({ storage, channelName: null, recentKey: null, fileSystemAccess: false, dialogs: { promptName: async () => "Assets" } }) : null;
  const store = createDocumentStore({ registry, host, document: createEmptyDocument() });
  const assets = createAssetService({ document: store, host, probe: async (_bytes, kind) => (kind === "image" ? { width: 640, height: 480 } : {}) });
  return { storage, host, store, assets };
}

describe("asset import", () => {
  it("adds a content-addressed asset in one undo step and writes its bytes on save", async () => {
    const { store, assets, host, storage } = setup();
    const sha = sha256HexSync(png);
    const result = await assets.importFile({ name: "Hero Photo.PNG", bytes: png });
    expect(result).toMatchObject({ ok: true, record: { kind: "image", name: "Hero Photo", file: `${sha}.png`, mime: "image/png", width: 640, height: 480, sha256: sha } });
    const id = result.assetId!;
    expect(store.getState().doc.assets[id]).toEqual(result.record);
    expect(store.getState().historyEntries().map((e) => e.label)).toEqual(['Import "Hero Photo"']);
    expect(new Uint8Array(assets.peekBytes(`${sha}.png`)!)).toEqual(png);
    expect(host!.resolveAssetUrl(null, `${sha}.png`)).toMatch(/^blob:/);

    const again = await assets.importFile(new File([png], "copy.png", { type: "image/png" }));
    expect(again).toMatchObject({ ok: true, assetId: id, reused: true });
    expect(store.getState().historyEntries()).toHaveLength(1);

    store.getState().undo();
    expect(store.getState().doc.assets[id]).toBeUndefined();
    store.getState().redo();
    expect(store.getState().doc.assets[id]).toEqual(result.record);

    expect((await store.getState().save()).ok).toBe(true);
    expect(new Uint8Array((await storage.read("Assets"))!.binaries![`assets/${sha}.png`]!)).toEqual(png);
    expect(new Uint8Array((await assets.readBytes(id))!)).toEqual(png);
    expect(await assets.readBytes("missing")).toBeUndefined();
  });

  it("joins the import and the edit that uses it in one undo step with a coalesce key", async () => {
    const { store, assets } = setup();
    const result = await assets.importFile({ name: "sunset.png", bytes: png }, { coalesceKey: "drop:image" });
    store.getState().apply([{ op: "addLayer", layer: { id: "hero", type: "image", name: "Hero", props: { image: { asset: result.assetId! } } } }], { label: "Set Image on Hero", coalesceKey: "drop:image" });
    expect(store.getState().historyEntries().map((e) => e.label)).toEqual(["Set Image on Hero"]);
    store.getState().undo();
    expect(store.getState().doc.assets).toEqual({});
    expect(store.getState().doc.components.main!.layers).toEqual([]);
  });

  it("explains unsupported and oversized files", async () => {
    const { store, assets } = setup();
    expect(await assets.importFile({ name: "notes.xyz", bytes: new Uint8Array([1]) })).toMatchObject({ ok: false, errorCode: "unsupported", error: expect.stringContaining(".xyz") });
    const tiny = createAssetService({ document: store, host: null, maxBytes: 2 });
    expect(await tiny.importFile({ name: "a.png", bytes: png })).toMatchObject({ ok: false, errorCode: "too_large" });
    const failing = { name: "broken.png", arrayBuffer: () => Promise.reject(new Error("gone")) };
    expect(await assets.importFile(failing)).toMatchObject({ ok: false, errorCode: "read_failed", error: expect.stringContaining("gone") });
    expect(store.getState().canUndo).toBe(false);
  });

  it("detects kinds from extensions, MIME types, and Lottie JSON", () => {
    expect(assetKindFor("clip.MOV")).toBe("video");
    expect(assetKindFor("song.m4a")).toBe("sound");
    expect(assetKindFor("Inter.woff2")).toBe("font");
    expect(assetKindFor("anim.json", "", new TextEncoder().encode('{"v":"5.7","fr":30,"layers":[]}'))).toBe("lottie");
    expect(assetKindFor("data.json", "", new TextEncoder().encode('{"items":[1,2]}'))).toBe("json");
    expect(assetKindFor("blob", "audio/webm")).toBe("sound");
    expect(assetKindFor("archive.zip")).toBeUndefined();
    expect(fileExtension("a.tar.GZ")).toBe("gz");
    expect(fileExtension("README")).toBe("");
  });

  it("holds bytes itself when the host can't", async () => {
    const { assets } = setup(false);
    const result = await assets.importFile({ name: "beep.mp3", bytes: new Uint8Array([9, 9]) });
    expect(result).toMatchObject({ ok: true, record: { kind: "sound", mime: "audio/mpeg" } });
    const url = assets.resolveUrl(result.record!.file);
    expect(url).toMatch(/^blob:/);
    expect(assets.resolveUrl(result.record!.file)).toBe(url);
    assets.storeBytes(result.record!.file, new Uint8Array([1]));
    expect(assets.resolveUrl(result.record!.file)).not.toBe(url);
    assets.dispose();
    expect(assets.peekBytes(result.record!.file)).toBeUndefined();
  });

  it("imports dropped files", async () => {
    const { assets, store } = setup(false);
    const onImported = vi.fn();
    const active = vi.fn();
    const handlers = createAssetDropHandlers(assets, { onImported, onDragActiveChange: active });
    const file = new File([png], "drop.png", { type: "image/png" });
    const dataTransfer = { types: ["Files"], files: [file], items: [{ kind: "file", getAsFile: () => file }], dropEffect: "none" };
    const event = { dataTransfer, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handlers.onDragEnter(event);
    expect(active).toHaveBeenLastCalledWith(true);
    handlers.onDragOver(event);
    expect(dataTransfer.dropEffect).toBe("copy");
    handlers.onDrop(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(active).toHaveBeenLastCalledWith(false);
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImported.mock.calls[0]![0]).toMatchObject([{ ok: true, record: { name: "drop" } }]);
    expect(Object.keys(store.getState().doc.assets)).toHaveLength(1);

    const textDrag = { dataTransfer: { types: ["text/plain"], files: [] }, preventDefault: vi.fn() };
    handlers.onDragOver(textDrag);
    handlers.onDrop(textDrag);
    expect(textDrag.preventDefault).not.toHaveBeenCalled();
    expect(dragHasFiles(null)).toBe(false);
    expect(filesFromDataTransfer({ files: [file] })).toEqual([file]);
  });
});
