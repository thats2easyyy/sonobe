import { createEmptyDocument, seenIdsFromJSON, type Op, type SeenIdsJSON, type SonobeDocument } from "@sonobe/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../host/browserHost.ts";
import type { DraftWriteMeta, HostDrafts } from "../host/types.ts";
import { createDocumentStore } from "./document.ts";
import { createDraftKeeper, draftCounts } from "./drafts.ts";
import { getRegistry } from "./registry.ts";

const registry = getRegistry();
const addRect = (name: string, id?: string): Op => ({ op: "addLayer", layer: { type: "rectangle", name, ...(id ? { id } : {}) } });

/** HostDrafts that records what the keeper asks for. */
function fakeDrafts() {
  const writes: (DraftWriteMeta & { id: string; layers: string[] })[] = [];
  const removed: string[] = [];
  const drafts: HostDrafts = {
    write: vi.fn(async (id: string, doc: SonobeDocument, meta: DraftWriteMeta) => {
      writes.push({ id, ...meta, layers: doc.components[doc.project.root]!.layers.map((l) => l.name) });
    }),
    remove: vi.fn(async (id) => {
      removed.push(id);
    }),
    list: async () => [],
    open: async () => {
      throw new Error("not used");
    },
    diskChanged: () => false,
  };
  return { drafts, writes, removed };
}

function setup(options: { host?: ReturnType<typeof createBrowserHost> } = {}) {
  const document = createDocumentStore({ registry, document: createEmptyDocument(), ...(options.host ? { host: options.host } : {}) });
  const fake = fakeDrafts();
  let n = 0;
  const keeper = createDraftKeeper({ document, drafts: fake.drafts, newId: () => `draft-000${++n}` });
  return { document, keeper, ...fake };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("draft keeper", () => {
  it("writes an Untitled edit a second after it, and edits that keep coming within five seconds", async () => {
    const { document, writes } = setup();
    document.getState().apply([addRect("Card")], { label: "Add Card" });
    await vi.advanceTimersByTimeAsync(999);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toMatchObject([{ id: "draft-0001", name: "Untitled", projectPath: null, revision: 1, layers: ["Card"], counts: { components: 1, layers: 1, patches: 0 } }]);

    // Constant edits never go quiet for a second, but they're written by five seconds.
    for (let i = 0; i < 12; i++) {
      document.getState().apply([addRect(`Dot ${i}`)], { label: "Add Dot" });
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(writes.length).toBe(2);
    expect(writes[1]).toMatchObject({ id: "draft-0001", revision: 11 });
  });

  it("waits for an open gesture to end", async () => {
    const { document, writes } = setup();
    document.getState().apply([addRect("Card", "card")], { label: "Add Card" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      document.getState().apply([{ op: "updateLayer", id: "card", props: { opacity: i / 20 } }], { label: "Scrub Opacity", coalesceKey: "opacity", gesture: i === 0 ? "begin" : "update" });
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(writes).toHaveLength(1);
    document.getState().endGesture("opacity");
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toHaveLength(2);
  });

  it("removes the draft once the document is clean: undone to the saved state, saved, or replaced", async () => {
    const host = createBrowserHost({ storage: createMemoryProjectStorage(), channelName: null, recentKey: null, fileSystemAccess: false });
    const { document, writes, removed } = setup({ host });
    document.getState().apply([addRect("Card")], { label: "Add Card" });
    await vi.advanceTimersByTimeAsync(1000);
    document.getState().undo();
    await vi.advanceTimersByTimeAsync(0);
    expect(removed).toEqual(["draft-0001"]);

    // Redo starts a new draft; saving removes it.
    document.getState().redo();
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes.at(-1)).toMatchObject({ id: "draft-0002" });
    await document.getState().saveTo("browser:Card");
    await vi.advanceTimersByTimeAsync(0);
    expect(removed).toEqual(["draft-0001", "draft-0002"]);

    // Don't Save, then a new document: the draft goes with the old one.
    document.getState().apply([addRect("Other")], { label: "Add Other" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes.at(-1)).toMatchObject({ id: "draft-0003", projectPath: "browser:Card" });
    document.getState().newDocument();
    await vi.advanceTimersByTimeAsync(0);
    expect(removed).toEqual(["draft-0001", "draft-0002", "draft-0003"]);
    host.dispose();
  });

  it("never removes a draft it didn't start writing, and never races a write it queued", async () => {
    const { document, drafts, writes, removed } = setup();
    let finish!: () => void;
    vi.mocked(drafts.write).mockImplementationOnce(async (id, _doc, meta) => {
      await new Promise<void>((resolve) => (finish = resolve));
      writes.push({ id, ...meta, layers: [] });
    });
    document.getState().apply([addRect("Card")], { label: "Add Card" });
    await vi.advanceTimersByTimeAsync(1000);
    // Undone while the write is still on its way: the remove waits for it.
    document.getState().undo();
    await vi.advanceTimersByTimeAsync(0);
    expect(removed).toEqual([]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    expect(removed).toEqual(["draft-0001"]);

    // A document that was clean the whole time never had a draft to remove.
    document.getState().newDocument();
    await vi.advanceTimersByTimeAsync(0);
    expect(removed).toEqual(["draft-0001"]);
  });

  it("keeps no draft of a copy that's only marked unsaved, and flush writes edits at once", async () => {
    const { document, keeper, writes } = setup();
    // An example opens as an unsaved copy: nothing's been done to it yet.
    document.getState().replaceDocument(createEmptyDocument({ name: "Tap to Grow" }), { projectPath: null, saved: false, label: "Opened example" });
    await vi.advanceTimersByTimeAsync(10_000);
    await keeper.flush();
    expect(writes).toEqual([]);
    document.getState().apply([addRect("Card")], { label: "Add Card" });
    await keeper.flush();
    expect(writes).toMatchObject([{ name: "Tap to Grow", revision: 2 }]);
    expect(keeper.current()).toEqual({ id: "draft-0001", updatedAt: expect.any(Number) });
    // Nothing new: another flush writes nothing.
    await keeper.flush();
    expect(writes).toHaveLength(1);
  });

  it("records the ids the session has seen, and continues a restored draft under its own id", async () => {
    const { document, keeper, writes, removed } = setup();
    document.getState().apply([addRect("Hero", "hero")], { label: "Add Hero" });
    document.getState().apply([{ op: "removeLayer", id: "hero" }], { label: "Remove Hero" });
    document.getState().apply([addRect("Card")], { label: "Add Card" });
    await keeper.flush();
    const seen: SeenIdsJSON = writes[0]!.seenIds;
    expect(seen.items.main).toContain("hero");

    // Restoring: the replace adopts the draft instead of starting (and later removing) another one.
    keeper.adopt("restored-draft", { createdAt: 5, projectPath: null });
    document.getState().replaceDocument(document.getState().doc, { projectPath: null, saved: false, seenIds: seenIdsFromJSON(seen), label: "Recovered" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(removed).toEqual(["draft-0001"]);
    expect(writes).toHaveLength(1);
    expect(keeper.current()).toMatchObject({ id: "restored-draft" });
    // The retired id survived the restore.
    expect(document.getState().isRetiredId("main", "hero")).toBe(true);
    document.getState().apply([addRect("Badge")], { label: "Add Badge" });
    await keeper.flush();
    expect(writes.at(-1)).toMatchObject({ id: "restored-draft", createdAt: 5 });
  });

  it("counts components, layers and patches", () => {
    const { document } = setup();
    document.getState().apply([addRect("Card"), addRect("Dot"), { op: "addPatch", patch: { type: "switch" } }], { label: "Add" });
    expect(draftCounts(document.getState().doc)).toEqual({ components: 1, layers: 2, patches: 1 });
  });
});
