import { createEmptyDocument, findLayer, type Op } from "@sonobe/core";
import { describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../host/browserHost.ts";
import { CLAUDE_AUTHOR, createDocumentStore } from "./document.ts";
import { getRegistry } from "./registry.ts";

const registry = getRegistry();
const addRect = (name: string, extra: Partial<Extract<Op, { op: "addLayer" }>["layer"]> = {}): Op => ({ op: "addLayer", layer: { type: "rectangle", name, ...extra } });
const layerIds = (store: ReturnType<typeof createDocumentStore>) => store.getState().doc.components.main!.layers.map((l) => l.id);

describe("document store: apply, undo, redo", () => {
  it("applies a batch, then undoes and redoes it", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    const result = store.getState().apply([addRect("Card")], { label: "Add Card" });
    expect(result.ok).toBe(true);
    expect(layerIds(store)).toEqual(["card"]);
    expect(store.getState()).toMatchObject({ revision: 1, dirty: true, canUndo: true, canRedo: false, undoLabel: "You: Add Card" });

    expect(store.getState().undo().ok).toBe(true);
    expect(layerIds(store)).toEqual([]);
    expect(store.getState()).toMatchObject({ revision: 2, dirty: false, canUndo: false, canRedo: true, redoLabel: "You: Add Card" });
    expect(store.getState().lastChange).toMatchObject({ kind: "undo", label: "Undo You: Add Card" });

    expect(store.getState().redo().ok).toBe(true);
    expect(layerIds(store)).toEqual(["card"]);
    expect(store.getState()).toMatchObject({ revision: 3, dirty: true, canUndo: true, canRedo: false });
  });

  it("returns failures without changing anything", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    const before = store.getState().doc;
    const result = store.getState().apply([addRect("Card"), { op: "removeLayer", id: "ghost" }], { label: "Broken" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: "not_found", opIndex: 1 });
    expect(store.getState().doc).toBe(before);
    expect(store.getState()).toMatchObject({ revision: 0, canUndo: false, dirty: false });
  });

  it("dry runs report the preview without committing", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    const result = store.getState().apply([addRect("Card")], { label: "Try", dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.preview?.components.main!.layers).toHaveLength(1);
    expect(layerIds(store)).toEqual([]);
    expect(store.getState().revision).toBe(0);
  });

  it("rejects a stale expectedRevision", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    store.getState().apply([addRect("Card")], { label: "Add Card" });
    const result = store.getState().apply([addRect("Other")], { label: "Add Other", expectedRevision: 0 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("revision_mismatch");
    expect(layerIds(store)).toEqual(["card"]);
    expect(store.getState().apply([addRect("Other")], { label: "Add Other", expectedRevision: 1 }).ok).toBe(true);
  });

  it("coalesces applies with the same key inside the window", () => {
    let t = 0;
    const store = createDocumentStore({ registry, document: createEmptyDocument(), now: () => t });
    store.getState().apply([addRect("Card")], { label: "Add Card" });
    const move = (x: number) => store.getState().apply([{ op: "updateLayer", id: "card", props: { position: [x, 0] } }], { label: "Move Card", coalesceKey: "scrub:@card.position" });
    t = 100;
    move(10);
    t = 400;
    move(20);
    t = 800;
    move(30);
    expect(store.getState().historyEntries().map((e) => e.label)).toEqual(["Move Card", "Add Card"]);
    const layer = () => findLayer(store.getState().doc.components.main!.layers, "card")?.layer;
    expect(layer()?.props.position).toEqual([30, 0]);

    store.getState().undo();
    expect(layer()).toBeDefined();
    expect(layer()?.props.position).toBeUndefined();

    store.getState().redo();
    t = 5000;
    move(40);
    expect(store.getState().historyEntries()).toHaveLength(3);
  });

  it("attributes agent changes in history", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    store.getState().apply([addRect("Card"), addRect("Badge")], { label: "added press animation", author: CLAUDE_AUTHOR });
    expect(store.getState().historyEntries()[0]).toMatchObject({ author: { kind: "agent", name: "Claude" }, opCount: 2, description: "Claude: added press animation (2 ops)" });
    expect(store.getState().lastChange).toMatchObject({ kind: "apply", author: CLAUDE_AUTHOR, opCount: 2 });
    expect(store.getState().undoLabel).toBe("Claude: added press animation (2 ops)");
  });

  it("never generates an id that was removed this session", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    store.getState().apply([addRect("Card")], { label: "Add Card" });
    store.getState().apply([{ op: "removeLayer", id: "card" }], { label: "Delete Card" });
    store.getState().apply([addRect("Card")], { label: "Add Card" });
    expect(layerIds(store)).toEqual(["card_2"]);
  });

  it("undoTo undoes several groups at once", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    store.getState().apply([addRect("A")], { label: "Add A" });
    const first = store.getState().historyEntries()[0]!.txnId;
    store.getState().apply([addRect("B")], { label: "Add B" });
    store.getState().apply([addRect("C")], { label: "Add C" });
    const result = store.getState().undoTo(first);
    expect(result.ok).toBe(true);
    expect(result.entries.map((e) => e.label)).toEqual(["Add C", "Add B", "Add A"]);
    expect(layerIds(store)).toEqual([]);
    expect(store.getState().undoTo("txn_missing").errors[0]?.code).toBe("not_found");
  });

  it("notifies revision subscribers once per change", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    const cb = vi.fn();
    const off = store.getState().subscribeRevision(cb);
    store.getState().apply([addRect("Card")], { label: "Add Card" });
    store.getState().apply([{ op: "removeLayer", id: "ghost" }], { label: "Nope" });
    store.getState().undo();
    off();
    store.getState().redo();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[0]![0].revision).toBe(1);
  });
});

describe("document store: files", () => {
  const makeHost = (storage = createMemoryProjectStorage(), name: string | null = "Photo Zoom") =>
    createBrowserHost({ storage, dialogs: { promptName: async () => name, pickProject: async (names) => names[0] ?? null }, channelName: null, recentKey: null, fileSystemAccess: false });

  it("saves through the host, names the prototype, and tracks dirty", async () => {
    const host = makeHost();
    const store = createDocumentStore({ registry, host, document: createEmptyDocument() });
    store.getState().apply([addRect("Card")], { label: "Add Card" });
    const result = await store.getState().save();
    expect(result).toEqual({ ok: true, path: "browser:Photo Zoom" });
    expect(store.getState()).toMatchObject({ projectPath: "browser:Photo Zoom", dirty: false });
    expect(store.getState().doc.project.name).toBe("Photo Zoom");

    store.getState().apply([addRect("Badge")], { label: "Add Badge" });
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    expect(store.getState().dirty).toBe(false);

    const reopened = createDocumentStore({ registry, host: makeHost((await host.storage) as never) });
    expect((await reopened.getState().open("browser:Photo Zoom")).ok).toBe(true);
    expect(layerIds(reopened)).toEqual(["card"]);
    expect(reopened.getState()).toMatchObject({ dirty: false, canUndo: false, projectPath: "browser:Photo Zoom" });
  });

  it("reports cancelled dialogs and open failures", async () => {
    const store = createDocumentStore({ registry, host: makeHost(createMemoryProjectStorage(), null), document: createEmptyDocument() });
    expect(await store.getState().saveAs()).toEqual({ ok: false, cancelled: true });
    const missing = await store.getState().open("browser:Nope");
    expect(missing.ok).toBe(false);
    expect(missing.errorCode).toBe("invalidFormat");
    expect(await createDocumentStore({ registry }).getState().save()).toMatchObject({ ok: false, errorCode: "no_host" });
  });

  it("reloads external edits when clean and holds them when dirty", async () => {
    const storage = createMemoryProjectStorage();
    const hostA = makeHost(storage);
    const store = createDocumentStore({ registry, host: hostA, document: createEmptyDocument() });
    await store.getState().save();
    const path = store.getState().projectPath!;

    const hostB = makeHost(storage);
    const other = createDocumentStore({ registry, host: hostB });
    await other.getState().open(path);
    other.getState().apply([addRect("From Disk")], { label: "Add" });
    await other.getState().save();

    await store.getState().checkExternalChanges(["components/main.json"]);
    expect(layerIds(store)).toEqual(["from_disk"]);
    expect(store.getState()).toMatchObject({ dirty: false, externalChange: null });
    expect(store.getState().lastChange?.kind).toBe("reload");

    store.getState().apply([addRect("Local")], { label: "Add Local" });
    other.getState().apply([addRect("Second")], { label: "Add Second" });
    await other.getState().save();
    await store.getState().checkExternalChanges();
    expect(layerIds(store)).toEqual(["from_disk", "local"]);
    expect(store.getState().externalChange?.paths).toEqual(["."]);

    store.getState().acceptExternalChange();
    expect(layerIds(store)).toEqual(["from_disk", "second"]);
    expect(store.getState()).toMatchObject({ dirty: false, externalChange: null });

    store.getState().apply([addRect("Mine")], { label: "Add Mine" });
    other.getState().apply([addRect("Theirs")], { label: "Add Theirs" });
    await other.getState().save();
    await store.getState().checkExternalChanges();
    store.getState().dismissExternalChange();
    expect(store.getState()).toMatchObject({ dirty: true, externalChange: null });
  });
});
