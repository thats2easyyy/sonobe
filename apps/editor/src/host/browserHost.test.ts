// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, serializeDocument, type SonobeDocument } from "@sonobe/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRegistry } from "../state/registry.ts";
import { createBrowserHost, createDirectoryProjectStorage, createLocalStorageProjectStorage, createMemoryProjectStorage, type DirectoryHandleLike, type FileHandleLike } from "./browserHost.ts";

const registry = getRegistry();

function withComponent(doc: SonobeDocument): SonobeDocument {
  const result = applyOps(
    doc,
    [
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
      { op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent" } },
    ],
    { registry },
  );
  if (!result.ok) throw new Error(result.errors[0]!.message);
  return result.doc;
}

/** An in-memory FileSystemDirectoryHandle stand-in. */
function memoryDirectory(name = "root"): DirectoryHandleLike & { dump(): Record<string, string | ArrayBuffer> } {
  const dirs = new Map<string, ReturnType<typeof memoryDirectory>>();
  const files = new Map<string, string | ArrayBuffer>();
  const handle = {
    kind: "directory" as const,
    name,
    async getDirectoryHandle(child: string, options?: { create?: boolean }) {
      let dir = dirs.get(child);
      if (!dir) {
        if (!options?.create) throw Object.assign(new Error("NotFound"), { name: "NotFoundError" });
        dirs.set(child, (dir = memoryDirectory(child)));
      }
      return dir;
    },
    async getFileHandle(child: string, options?: { create?: boolean }): Promise<FileHandleLike> {
      if (!files.has(child) && !options?.create) throw Object.assign(new Error("NotFound"), { name: "NotFoundError" });
      return {
        kind: "file",
        name: child,
        getFile: async () => {
          const v = files.get(child) ?? "";
          return { text: async () => (typeof v === "string" ? v : new TextDecoder().decode(v)), arrayBuffer: async () => (typeof v === "string" ? (new TextEncoder().encode(v).buffer as ArrayBuffer) : v) };
        },
        createWritable: async () => {
          let data: string | ArrayBuffer = "";
          return {
            write: async (d: string | ArrayBuffer | Uint8Array) => {
              data = d instanceof Uint8Array ? (d.slice().buffer as ArrayBuffer) : d;
            },
            close: async () => void files.set(child, data),
          };
        },
      };
    },
    async removeEntry(child: string) {
      if (!files.delete(child) && !dirs.delete(child)) throw new Error("NotFound");
    },
    async *entries(): AsyncGenerator<[string, DirectoryHandleLike | FileHandleLike]> {
      for (const [n, d] of dirs) yield [n, d];
      for (const n of files.keys()) yield [n, await handle.getFileHandle(n)];
    },
    dump() {
      const out: Record<string, string | ArrayBuffer> = {};
      for (const [n, v] of files) out[n] = v;
      for (const [n, d] of dirs) for (const [p, v] of Object.entries(d.dump())) out[`${n}/${p}`] = v;
      return out;
    },
  };
  return handle;
}

const hosts: { dispose(): void }[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  localStorage.clear();
});

describe("browser host", () => {
  it("saves and loads a project round trip, removing stale files", async () => {
    const storage = createMemoryProjectStorage();
    const host = createBrowserHost({ storage, channelName: null, fileSystemAccess: false, dialogs: { promptName: async () => "Checkout Flow" } });
    hosts.push(host);
    const doc = withComponent(createEmptyDocument({ name: "Checkout Flow" }));
    const path = await host.saveProjectDialog(doc.project.name);
    expect(path).toBe("browser:Checkout Flow");
    const first = await host.writeProject(path!, doc);
    expect(first.written.sort()).toEqual(["assets/assets.json", "components/button.json", "components/main.json", "project.json"]);

    const loaded = await host.readProject(path!);
    expect(serializeDocument(loaded)).toEqual(serializeDocument(doc));

    const removed = applyOps(loaded, [{ op: "removeComponent", id: "button" }], { registry }).doc;
    const second = await host.writeProject(path!, removed);
    expect(second).toEqual({ written: [], deleted: ["components/button.json"], unchanged: 3 });
    expect(Object.keys((await storage.read("Checkout Flow"))!.files).sort()).toEqual(["assets/assets.json", "components/main.json", "project.json"]);
    expect(host.displayName(path!)).toBe("Checkout Flow");
  });

  it("stores projects in localStorage and lists recents", async () => {
    const storage = createLocalStorageProjectStorage();
    const host = createBrowserHost({ storage, channelName: null, fileSystemAccess: false, dialogs: { pickProject: async (names) => names.at(-1) ?? null } });
    hosts.push(host);
    await host.writeProject("browser:Alpha", createEmptyDocument({ name: "Alpha" }));
    await host.writeProject("browser:Beta", withComponent(createEmptyDocument({ name: "Beta" })));
    expect(await host.listProjects()).toEqual(["Alpha", "Beta"]);
    expect(await host.openProjectDialog()).toBe("browser:Beta");
    expect((await host.readProject("browser:Beta")).components.main!.layers).toHaveLength(1);
    expect(await host.recentProjects()).toEqual(["browser:Beta", "browser:Alpha"]);
    await expect(host.readProject("browser:Gamma")).rejects.toThrow(/no project called "Gamma"/);
  });

  it("reads and writes folders through directory handles, assets included", async () => {
    const root = memoryDirectory();
    const storage = createDirectoryProjectStorage(root, "opfs");
    const host = createBrowserHost({ storage, channelName: null, fileSystemAccess: false });
    hosts.push(host);
    const withAsset = applyOps(createEmptyDocument(), [{ op: "addAsset", asset: { id: "photo", kind: "image", name: "Photo", file: "abc.png" } }], { registry, lenient: true }).doc;
    await storage.write("Media", { files: {}, deleted: [], binaries: { "assets/abc.png": new Uint8Array([1, 2, 3]) } });
    await host.writeProject("browser:Media", withAsset);
    const stored = await storage.read("Media");
    expect(Object.keys(stored!.files).sort()).toEqual(["assets/assets.json", "components/main.json", "project.json"]);
    expect(new Uint8Array(stored!.binaries!["assets/abc.png"]!)).toEqual(new Uint8Array([1, 2, 3]));

    const loaded = await host.readProject("browser:Media");
    expect(loaded.assets.photo?.file).toBe("abc.png");
    expect(await storage.list()).toEqual(["Media"]);

    await host.writeProject("browser:Copy", loaded, { copyAssetsFrom: "browser:Media" });
    expect(new Uint8Array((await storage.read("Copy"))!.binaries!["assets/abc.png"]!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("opens real folders with the File System Access API", async () => {
    const folder = memoryDirectory("Picked.sonobe");
    const showDirectoryPicker = vi.fn(async () => folder);
    const host = createBrowserHost({ storage: createMemoryProjectStorage(), channelName: null, window: { showDirectoryPicker } });
    hosts.push(host);
    const path = await host.openProjectDialog();
    expect(path).toBe("fsa:1/Picked.sonobe");
    await host.writeProject(path!, createEmptyDocument({ name: "Picked" }));
    expect(Object.keys(folder.dump()).sort()).toEqual(["assets/assets.json", "components/main.json", "project.json"]);
    expect((await host.readProject(path!)).project.name).toBe("Picked");

    showDirectoryPicker.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    expect(await host.openProjectDialog()).toBeNull();
  });

  it("tells other tabs about writes", async () => {
    const storage = createMemoryProjectStorage();
    const channelName = `sonobe-test-${Math.random()}`;
    const writer = createBrowserHost({ storage, channelName, fileSystemAccess: false });
    const reader = createBrowserHost({ storage, channelName, fileSystemAccess: false });
    hosts.push(writer, reader);
    const seen = vi.fn();
    reader.watchProject("browser:Shared", seen);
    const own = vi.fn();
    writer.watchProject("browser:Shared", own);
    await writer.writeProject("browser:Shared", createEmptyDocument());
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(["assets/assets.json", "components/main.json", "project.json"]));
    expect(own).not.toHaveBeenCalled();
  });

  it("updates the title and guards unload while edited", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const fakeDocument = { title: "" };
    const host = createBrowserHost({ storage: createMemoryProjectStorage(), channelName: null, window: { addEventListener, removeEventListener, document: fakeDocument } });
    hosts.push(host);
    host.setTitle("Photo Zoom — Sonobe");
    expect(fakeDocument.title).toBe("Photo Zoom — Sonobe");
    host.setDocumentEdited(true);
    host.setDocumentEdited(true);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    host.setDocumentEdited(false);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(host.rpc).toBeNull();
    expect(host.capabilities.persistent).toBe(false);
  });
});
