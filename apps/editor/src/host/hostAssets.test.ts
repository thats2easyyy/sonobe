import { applyOps, createEmptyDocument } from "@sonobe/core";
import { describe, expect, it, vi } from "vitest";
import { createDialogStore } from "../state/dialogs.ts";
import { getRegistry } from "../state/registry.ts";
import { createBrowserHost, createMemoryProjectStorage } from "./browserHost.ts";
import { createDesktopHost } from "./desktopHost.ts";
import type { DesktopHostApi } from "./types.ts";

const registry = getRegistry();
const withAsset = (file = "abc.png") => applyOps(createEmptyDocument({ name: "Assets" }), [{ op: "addAsset", asset: { id: "photo", kind: "image", name: "Photo", file } }], { registry }).doc;
const bytes = new Uint8Array([1, 2, 3]);

function fakeApi(extra: Partial<DesktopHostApi> = {}) {
  const writes: Parameters<DesktopHostApi["writeProject"]>[1][] = [];
  const disk: Record<string, { files: Record<string, string>; binaries: Record<string, ArrayBuffer> }> = {};
  const api: DesktopHostApi = {
    platform: "darwin",
    version: "0.0.0",
    openProjectDialog: async () => null,
    saveProjectDialog: async () => null,
    readProject: vi.fn(async (dir: string) => ({ files: { ...disk[dir]?.files }, binaries: { ...disk[dir]?.binaries } })),
    writeProject: vi.fn(async (dir: string, changes: Parameters<DesktopHostApi["writeProject"]>[1]) => {
      writes.push(changes);
      const target = (disk[dir] ??= { files: {}, binaries: {} });
      Object.assign(target.files, changes.files);
      for (const [path, b] of Object.entries(changes.binaries ?? {})) target.binaries[path] = b instanceof Uint8Array ? (b.slice().buffer as ArrayBuffer) : b;
    }),
    watchProject: () => () => undefined,
    revealInFinder: vi.fn(),
    recentProjects: async () => [],
    onCommand: () => () => undefined,
    onOpenProject: () => () => undefined,
    commands: () => [],
    setDocumentEdited: vi.fn(),
    setTitle: vi.fn(),
    rpc: { handle: () => () => undefined, fail: () => undefined },
    getMcpStatus: async () => ({}),
    ...extra,
  };
  return { api, writes };
}

describe("host asset bytes", () => {
  it("serves imported bytes before the first save and writes each file once", async () => {
    const { api, writes } = fakeApi();
    const host = createDesktopHost(api);
    host.putAssetBytes!(null, "abc.png", bytes);
    expect(new Uint8Array(host.peekAssetBytes!(null, "abc.png")!)).toEqual(bytes);
    expect(host.peekAssetBytes!("/p/Assets.sonobe", "abc.png")).toBeDefined();
    expect(host.resolveAssetUrl(null, "abc.png")).toMatch(/^blob:/);

    await host.writeProject("/p/Assets.sonobe", withAsset());
    expect(Object.keys(writes[0]!.binaries ?? {})).toEqual(["assets/abc.png"]);
    await host.writeProject("/p/Assets.sonobe", withAsset());
    expect(writes[1]!.binaries).toBeUndefined();
    expect(host.resolveAssetUrl("/p/Assets.sonobe", "abc.png")).toMatch(/^blob:/);

    await host.writeProject("/p/Copy.sonobe", withAsset(), { copyAssetsFrom: "/p/Assets.sonobe" });
    expect(Object.keys(writes[2]!.binaries ?? {})).toEqual(["assets/abc.png"]);

    const fresh = createDesktopHost(api);
    expect(new Uint8Array((await fresh.readAssetBytes!("/p/Copy.sonobe", "abc.png"))!)).toEqual(bytes);
    expect(fresh.peekAssetBytes!("/p/Copy.sonobe", "abc.png")).toBeDefined();
    expect(await fresh.readAssetBytes!(null, "missing.png")).toBeUndefined();
    await fresh.writeProject("/p/Other.sonobe", withAsset(), { copyAssetsFrom: "/p/Assets.sonobe" });
    expect(Object.keys(writes[3]!.binaries ?? {})).toEqual(["assets/abc.png"]);
  });

  it("pushes revisions and opens links through the preload when it can", async () => {
    const notify = vi.fn();
    const openExternal = vi.fn(async () => true);
    const host = createDesktopHost(fakeApi({ notifyDocumentChanged: notify, openExternal, muted: true }).api);
    host.notifyDocumentChanged!(7, { undo: "Undo Add Card", redo: "Redo" });
    expect(notify).toHaveBeenCalledWith(7, { undo: "Undo Add Card", redo: "Redo" });
    expect(await host.openExternal!("https://sonobe.dev")).toBe(true);
    expect(openExternal).toHaveBeenCalledWith("https://sonobe.dev");
    expect(host.muted).toBe(true);

    const legacy = createDesktopHost(fakeApi().api);
    expect(() => legacy.notifyDocumentChanged!(1)).not.toThrow();
    expect(await legacy.openExternal!("https://sonobe.dev")).toBe(false);
    expect(legacy.muted).toBe(false);
  });

  it("keeps bytes in browser storage and asks through in-app dialogs", async () => {
    const storage = createMemoryProjectStorage();
    const dialogs = createDialogStore();
    const host = createBrowserHost({ storage, channelName: null, recentKey: null, fileSystemAccess: false, dialogService: dialogs });
    host.putAssetBytes!(null, "abc.png", bytes);
    const naming = host.saveProjectDialog("Untitled");
    await vi.waitFor(() => expect(dialogs.getState().queue[0]).toMatchObject({ kind: "prompt", options: { defaultValue: "Untitled", confirmLabel: "Save" } }));
    const prompt = dialogs.getState().queue[0]!;
    expect(prompt.kind === "prompt" && prompt.options.validate?.("  ")).toBe("Enter a name.");
    dialogs.getState().settle(prompt.id, "Photo Book");
    const path = await naming;
    expect(path).toBe("browser:Photo Book");
    await host.writeProject(path!, withAsset());
    expect(new Uint8Array((await storage.read("Photo Book"))!.binaries!["assets/abc.png"]!)).toEqual(bytes);

    const other = createBrowserHost({ storage, channelName: null, recentKey: null, fileSystemAccess: false, dialogService: dialogs });
    expect(new Uint8Array((await other.readAssetBytes!(path!, "abc.png"))!)).toEqual(bytes);
    const picking = other.openProjectDialog();
    await vi.waitFor(() => expect(dialogs.getState().queue[0]).toMatchObject({ kind: "pick", options: { items: [{ value: "Photo Book", label: "Photo Book" }] } }));
    dialogs.getState().settle(dialogs.getState().queue[0]!.id, "Photo Book");
    expect(await picking).toBe("browser:Photo Book");
    host.dispose();
    other.dispose();
  });
});
