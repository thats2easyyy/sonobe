import { applyOps, createEmptyDocument, serializeDocument, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it, vi } from "vitest";
import { getRegistry } from "../state/registry.ts";
import { createDesktopHost } from "./desktopHost.ts";
import type { DesktopHostApi } from "./types.ts";

const registry = getRegistry();

function fakeApi(projects: Record<string, { files: Record<string, string>; binaries?: Record<string, ArrayBuffer> }>) {
  const writes: { dir: string; changes: Parameters<DesktopHostApi["writeProject"]>[1] }[] = [];
  const rpc = { handle: vi.fn(() => () => undefined), fail: vi.fn() };
  const api: DesktopHostApi = {
    platform: "darwin",
    version: "0.1.0",
    openProjectDialog: vi.fn(async () => "/p/Opened.sonobe"),
    saveProjectDialog: vi.fn(async (name: string) => `/p/${name}.sonobe`),
    readProject: vi.fn(async (dir: string) => ({ files: { ...projects[dir]!.files }, binaries: { ...projects[dir]!.binaries } })),
    writeProject: vi.fn(async (dir, changes) => void writes.push({ dir, changes })),
    watchProject: vi.fn((dir: string, cb: (change: { dir: string; paths: string[] }) => void) => {
      cb({ dir, paths: ["components/main.json"] });
      return () => undefined;
    }),
    revealInFinder: vi.fn(),
    recentProjects: vi.fn(async () => ["/p/A.sonobe"]),
    onCommand: vi.fn(() => () => undefined),
    onOpenProject: vi.fn(() => () => undefined),
    commands: () => [],
    setDocumentEdited: vi.fn(),
    setTitle: vi.fn(),
    rpc,
    getMcpStatus: async () => ({}),
  };
  return { api, writes };
}

const edit = (doc: SonobeDocument) => {
  const result = applyOps(doc, [{ op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } }, { op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent" } }], { registry });
  return result.doc;
};

describe("desktop host", () => {
  it("reads projects and writes only what changed", async () => {
    const original = createEmptyDocument({ name: "Checkout" });
    const { api, writes } = fakeApi({ "/p/Checkout.sonobe": { files: { ...serializeDocument(original), ".sonobe/session.json": "{}" } } });
    const host = createDesktopHost(api);
    const doc = await host.readProject("/p/Checkout.sonobe");
    expect(doc.project.name).toBe("Checkout");

    const edited = edit(doc);
    const summary = await host.writeProject("/p/Checkout.sonobe", edited);
    expect(Object.keys(writes[0]!.changes.files!).sort()).toEqual(["components/button.json", "components/main.json"]);
    expect(writes[0]!.changes.deleted).toEqual([]);
    expect(summary).toEqual({ written: expect.arrayContaining(["components/button.json", "components/main.json"]), deleted: [], unchanged: 2 });

    const removed = applyOps(edited, [{ op: "removeComponent", id: "button" }], { registry }).doc;
    await host.writeProject("/p/Checkout.sonobe", removed);
    expect(writes[1]!.changes).toEqual({ files: {}, deleted: ["components/button.json"] });
  });

  it("copies asset binaries on Save As", async () => {
    const withAsset = applyOps(createEmptyDocument(), [{ op: "addAsset", asset: { id: "photo", kind: "image", name: "Photo", file: "abc.png" } }], { registry, lenient: true }).doc;
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    const { api, writes } = fakeApi({ "/p/Old.sonobe": { files: serializeDocument(withAsset), binaries: { "assets/abc.png": bytes, "assets/unused.png": bytes } } });
    const host = createDesktopHost(api);
    const doc = await host.readProject("/p/Old.sonobe");
    await host.writeProject("/p/New.sonobe", doc, { copyAssetsFrom: "/p/Old.sonobe" });
    expect(Object.keys(writes[0]!.changes.files!).sort()).toEqual(["assets/assets.json", "components/main.json", "project.json"]);
    expect(writes[0]!.changes.binaries).toEqual({ "assets/abc.png": bytes });
  });

  it("replaces an existing prototype on Save As instead of merging into it", async () => {
    const old = applyOps(createEmptyDocument({ name: "Old" }), [{ op: "addComponent", component: { id: "legacy", name: "Legacy", kind: "layerComponent" } }, { op: "setScript", file: "x.js", source: "// old" }], { registry }).doc;
    const { api, writes } = fakeApi({ "/p/Old.sonobe": { files: { ...serializeDocument(old), "scripts/.eslintrc.json": "{}", "notes.md": "keep me" } } });
    const host = createDesktopHost(api);
    const summary = await host.writeProject("/p/Old.sonobe", createEmptyDocument({ name: "New" }));
    expect(summary.deleted).toEqual(["components/legacy.json", "scripts/x.js"]);
    expect(writes[0]!.changes.deleted).toEqual(["components/legacy.json", "scripts/x.js"]);

    const fresh = createDesktopHost(fakeApi({}).api);
    expect((await fresh.writeProject("/p/Brand New.sonobe", createEmptyDocument())).deleted).toEqual([]);
  });

  it("remembers what's on disk even when a file doesn't parse, so the next save rewrites it", async () => {
    const doc = createEmptyDocument({ name: "Checkout" });
    const { api, writes } = fakeApi({ "/p/C.sonobe": { files: { ...serializeDocument(doc), "assets/assets.json": "<<<<<<< HEAD\n{}\n" } } });
    const host = createDesktopHost(api);
    await expect(host.readProject("/p/C.sonobe")).rejects.toMatchObject({ code: "corrupt" });
    await host.writeProject("/p/C.sonobe", doc);
    expect(writes[0]!.changes).toEqual({ files: { "assets/assets.json": serializeDocument(doc)["assets/assets.json"] }, deleted: [] });
  });

  it("passes window chrome, commands, watching, and RPC through", () => {
    const { api } = fakeApi({});
    const host = createDesktopHost(api);
    host.setTitle("Checkout — Sonobe");
    host.setDocumentEdited(true);
    const cb = vi.fn();
    host.watchProject("/p/A.sonobe", cb);
    expect(cb).toHaveBeenCalledWith(["components/main.json"]);
    host.onCommand(() => undefined);
    expect(api.setTitle).toHaveBeenCalledWith("Checkout — Sonobe");
    expect(api.setDocumentEdited).toHaveBeenCalledWith(true);
    expect(api.onCommand).toHaveBeenCalled();
    expect(host.rpc).toBe(api.rpc);
    expect(host.kind).toBe("desktop");
    expect(host.displayName("/Users/me/Checkout Flow.sonobe")).toBe("Checkout Flow");
    expect(host.drafts).toBeUndefined();
  });

  it("keeps drafts through the app: only what changed, assets once, and failures with their code", async () => {
    const saved = applyOps(createEmptyDocument({ name: "Checkout" }), [{ op: "addAsset", asset: { id: "old", kind: "image", name: "Old", file: "old.png" } }], { registry, lenient: true }).doc;
    const { api } = fakeApi({ "/p/Checkout.sonobe": { files: serializeDocument(saved), binaries: { "assets/old.png": new Uint8Array([1]).buffer } } });
    const draftWrites: { id: string; changes: { files: Record<string, string>; binaries?: Record<string, unknown>; deleted: string[] }; meta: Record<string, unknown> }[] = [];
    api.drafts = {
      write: vi.fn(async (id, changes, meta) => {
        draftWrites.push({ id, changes, meta: meta as unknown as Record<string, unknown> });
        return { ok: true as const };
      }),
      remove: vi.fn(async () => ({ ok: false as const, code: "draft_in_use", message: "Another Sonobe window has this draft open." })),
      list: vi.fn(async () => []),
      read: vi.fn(async () => ({ ok: false as const, code: "unknown_draft", message: "There's no draft." })),
      release: vi.fn(async () => undefined),
      reveal: vi.fn(),
    };
    const host = createDesktopHost(api);
    const doc = await host.readProject("/p/Checkout.sonobe");
    host.putAssetBytes!("/p/Checkout.sonobe", "new.png", new Uint8Array([7, 7]));
    const edited = applyOps(doc, [{ op: "addAsset", asset: { id: "photo", kind: "image", name: "Photo", file: "new.png" } }, { op: "addLayer", layer: { type: "rectangle", name: "Card" } }], { registry, lenient: true }).doc;
    const meta = { name: "Checkout", projectPath: "/p/Checkout.sonobe", revision: 2, createdAt: 1, counts: { components: 1, layers: 1, patches: 0 }, seenIds: { items: {}, components: [], knobs: [], presets: [] } };

    await host.drafts!.write("draft-0001", edited, meta);
    // A draft is a whole project, but only the asset the project folder doesn't have yet.
    expect(Object.keys(draftWrites[0]!.changes.files).sort()).toEqual(["assets/assets.json", "components/main.json", "project.json"]);
    expect(Object.keys(draftWrites[0]!.changes.binaries ?? {})).toEqual(["assets/new.png"]);
    // It records what the project looked like, to notice outside changes on restore.
    expect(Object.keys(draftWrites[0]!.meta.base as object).sort()).toEqual(["assets/assets.json", "components/main.json", "project.json"]);

    const renamed = applyOps(edited, [{ op: "setProject", changes: { name: "Checkout 2" } }], { registry }).doc;
    await host.drafts!.write("draft-0001", renamed, { ...meta, revision: 3 });
    expect(draftWrites[1]!.changes).toEqual({ files: { "project.json": serializeDocument(renamed)["project.json"] }, deleted: [] });

    await expect(host.drafts!.remove("draft-0001")).rejects.toMatchObject({ code: "draft_in_use" });
    await expect(host.drafts!.open("draft-0002")).rejects.toMatchObject({ code: "unknown_draft", message: "There's no draft." });
    expect(api.drafts.release).not.toHaveBeenCalled();
    host.drafts!.reveal!("draft-0001");
    expect(api.drafts.reveal).toHaveBeenCalledWith("draft-0001");

    // A draft read (and claimed) whose files don't make a document, like a first write cut off after project.json: the claim goes back.
    const info = { id: "draft-0003", name: "Checkout", projectPath: null, createdAt: 1, updatedAt: 2, revision: 1, counts: { components: 1, layers: 0, patches: 0 }, torn: true };
    vi.mocked(api.drafts.read).mockResolvedValueOnce({ ok: true, info, manifest: {}, files: { "project.json": serializeDocument(saved)["project.json"]! }, binaries: {} });
    await expect(host.drafts!.open("draft-0003")).rejects.toMatchObject({ code: "invalidFormat" });
    expect(api.drafts.release).toHaveBeenCalledWith("draft-0003");
  });
});
