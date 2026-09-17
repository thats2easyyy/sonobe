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
  });
});
