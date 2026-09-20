import { createEmptyDocument, findLayer, serializeDocument, type Op } from "@sonobe/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage, type LockManagerLike, type ProjectStorage } from "../host/browserHost.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { getRegistry } from "./registry.ts";
import { createEditorSession, type ConfirmDiscard, type EditorSession } from "./session.ts";

const registry = getRegistry();
const sessions: EditorSession[] = [];
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
});

/** Web Locks shared by every "tab" in a test. */
function sharedLocks(): LockManagerLike {
  const held = new Set<string>();
  return {
    async request(name, options, callback) {
      if (held.has(name) && options.ifAvailable) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
    query: async () => ({ held: [...held].map((name) => ({ name })) }),
  };
}

/** A window (tab) over shared project and draft storage. */
function tab(storage: ProjectStorage, drafts: ProjectStorage, locks: LockManagerLike | null, confirmDiscard: ConfirmDiscard = async () => "discard") {
  const host = createBrowserHost({ storage, drafts, locks, channelName: null, recentKey: null, fileSystemAccess: false });
  const session = createEditorSession({ host, registry, document: createEmptyDocument({ name: "Start" }), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate", confirmDiscard, drafts: { debounceMs: 0, maxWaitMs: 0 } });
  sessions.push(session);
  return session;
}

const addRect = (name: string, id?: string): Op => ({ op: "addLayer", layer: { type: "rectangle", name, ...(id ? { id } : {}) } });

describe("restoring drafts", () => {
  it("asks about unsaved changes first, and restores an Untitled draft as unsaved work", async () => {
    const storage = createMemoryProjectStorage();
    const drafts = createMemoryProjectStorage();
    const lost = tab(storage, drafts, null);
    lost.document.getState().newDocument();
    lost.document.getState().apply([addRect("Card", "card")], { label: "Add Card" });
    await lost.drafts!.flush();

    const confirm = vi.fn<ConfirmDiscard>(async () => "cancel");
    const next = tab(storage, drafts, null, confirm);
    next.document.getState().apply([addRect("Mine")], { label: "Add Mine" });
    const [draft] = await next.recoverableDrafts();
    expect(draft).toMatchObject({ name: "Untitled", projectPath: null, counts: { layers: 1 } });

    expect(await next.restoreDraft(draft!.id)).toEqual({ ok: false, cancelled: true });
    expect(confirm).toHaveBeenCalledWith({ name: "Start", action: "open" });
    // Still there to recover later.
    expect((await next.recoverableDrafts()).map((d) => d.id)).toEqual([draft!.id]);

    confirm.mockImplementation(async () => "discard");
    const restored = await next.restoreDraft(draft!.id);
    expect(restored).toMatchObject({ ok: true, draft: { id: draft!.id } });
    const s = next.document.getState();
    expect(s).toMatchObject({ dirty: true, projectPath: null, canUndo: false });
    expect(s.lastChange).toMatchObject({ kind: "replace", label: "Recovered “Untitled”" });
    expect(findLayer(s.doc.components.main!.layers, "card")).toBeDefined();
    expect(next.drafts!.current()?.id).toBe(draft!.id);
    expect(await next.recoverableDrafts()).toEqual([]);
  });

  it("puts unsaved changes back over their saved project, with the assets that weren't saved yet", async () => {
    const storage = createMemoryProjectStorage();
    const drafts = createMemoryProjectStorage();
    const saved = tab(storage, drafts, null);
    await saved.document.getState().saveTo("browser:Deck");
    saved.host!.putAssetBytes!("browser:Deck", "new.png", new Uint8Array([4, 5, 6]));
    saved.document.getState().apply([{ op: "addAsset", asset: { id: "photo", kind: "image", name: "Photo", file: "new.png" } }, addRect("Unsaved Card")], { label: "Add Photo" });
    await saved.drafts!.flush();

    const next = tab(storage, drafts, null);
    const [draft] = await next.recoverableDrafts();
    expect(draft).toMatchObject({ name: "Start", projectPath: "browser:Deck" });
    const restored = await next.restoreDraft(draft!.id);
    expect(restored).toMatchObject({ ok: true, path: "browser:Deck" });
    const s = next.document.getState();
    expect(s).toMatchObject({ projectPath: "browser:Deck", dirty: true, externalChange: null });
    expect(s.doc.components.main!.layers.map((l) => l.name)).toEqual(["Unsaved Card"]);
    expect([...new Uint8Array(next.host!.peekAssetBytes!("browser:Deck", "new.png")!)]).toEqual([4, 5, 6]);

    // Saving writes the asset the project didn't have, and removes the draft.
    expect(await next.document.getState().save()).toMatchObject({ ok: true, written: expect.arrayContaining(["assets/new.png"]) });
    await next.drafts!.flush();
    expect(await drafts.list()).toEqual([]);
  });

  it("asks which version to keep when the project changed after the draft, and falls back when it's gone", async () => {
    const storage = createMemoryProjectStorage();
    const drafts = createMemoryProjectStorage();
    const saved = tab(storage, drafts, null);
    await saved.document.getState().saveTo("browser:Deck");
    saved.document.getState().apply([addRect("Mine")], { label: "Add Mine" });
    await saved.drafts!.flush();
    // Someone changes the project on disk afterwards.
    const theirs = saved.document.getState().doc;
    const edited = { ...theirs, project: { ...theirs.project, name: "Deck (theirs)" } };
    await storage.write("Deck", { files: serializeDocument(edited), deleted: [] });

    const next = tab(storage, drafts, null);
    const [draft] = await next.recoverableDrafts();
    await next.restoreDraft(draft!.id);
    expect(next.document.getState().externalChange).toMatchObject({ path: "browser:Deck" });
    expect(next.document.getState().doc.components.main!.layers.map((l) => l.name)).toEqual(["Mine"]);

    // A draft whose project folder is gone comes back unsaved, and says so.
    const gone = tab(createMemoryProjectStorage(), drafts, null);
    gone.document.getState().replaceDocument(createEmptyDocument({ name: "Moved" }), { projectPath: "browser:Moved", saved: true });
    gone.document.getState().apply([addRect("Card")], { label: "Add Card" });
    await gone.drafts!.flush();
    const last = tab(createMemoryProjectStorage(), drafts, null);
    const moved = (await last.recoverableDrafts()).find((d) => d.name === "Moved")!;
    const result = await last.restoreDraft(moved.id);
    expect(result).toMatchObject({ ok: true, notes: [expect.stringContaining("couldn't be opened")] });
    expect(last.document.getState()).toMatchObject({ projectPath: null, dirty: true });
  });

  it("still asks about an outside change the lost tab had noticed, and moves on after its own saves", async () => {
    const storage = createMemoryProjectStorage();
    const drafts = createMemoryProjectStorage();
    const lost = tab(storage, drafts, null);
    await lost.document.getState().saveTo("browser:Deck");
    const saved = lost.document.getState().doc;
    lost.document.getState().apply([addRect("Mine")], { label: "Add Mine" });
    await lost.drafts!.flush();
    // A teammate saves the project, and the tab notices while it has unsaved edits.
    await storage.write("Deck", { files: serializeDocument({ ...saved, project: { ...saved.project, name: "Deck (theirs)" } }), deleted: [] });
    await lost.document.getState().checkExternalChanges(["project.json"]);
    expect(lost.document.getState().externalChange).toMatchObject({ path: "browser:Deck" });
    // More edits reach the draft before the tab goes away.
    lost.document.getState().apply([addRect("Mine 2")], { label: "Add Mine 2" });
    await lost.drafts!.flush();

    const next = tab(storage, drafts, null);
    const [draft] = await next.recoverableDrafts();
    await next.restoreDraft(draft!.id);
    expect(next.document.getState().externalChange).toMatchObject({ path: "browser:Deck" });
    expect(await next.document.getState().save()).toMatchObject({ ok: false, errorCode: "disk_changed" });

    // A save while edits keep coming leaves the document dirty: its draft now starts from what was saved.
    const busyStorage = createMemoryProjectStorage();
    const busyDrafts = createMemoryProjectStorage();
    const busy = tab(busyStorage, busyDrafts, null);
    await busy.document.getState().saveTo("browser:Busy");
    busy.document.getState().apply([addRect("Before")], { label: "Add Before" });
    await busy.drafts!.flush();
    const saving = busy.document.getState().save();
    busy.document.getState().apply([addRect("During")], { label: "Add During" });
    expect(await saving).toMatchObject({ ok: true });
    expect(busy.document.getState().dirty).toBe(true);
    await busy.drafts!.flush();

    const after = tab(busyStorage, busyDrafts, null);
    const [kept] = await after.recoverableDrafts();
    await after.restoreDraft(kept!.id);
    expect(after.document.getState()).toMatchObject({ externalChange: null, dirty: true });
    expect(after.document.getState().doc.components.main!.layers.map((l) => l.name)).toEqual(["Before", "During"]);
  });

  it("lets only one tab have a draft, and discards drafts on request", async () => {
    const storage = createMemoryProjectStorage();
    const drafts = createMemoryProjectStorage();
    const locks = sharedLocks();
    const lost = tab(storage, drafts, locks);
    lost.document.getState().apply([addRect("Card")], { label: "Add Card" });
    await lost.drafts!.flush();
    // The first tab still holds it: nobody else sees it.
    const other = tab(storage, drafts, locks);
    expect(await other.recoverableDrafts()).toEqual([]);
    expect(await other.restoreDraft(lost.drafts!.current()!.id)).toMatchObject({ ok: false, errorCode: "unknown_draft", error: expect.stringContaining("another window") });

    // The first tab goes away (its locks are released): now it's recoverable, and discarding deletes it.
    lost.host!.dispose();
    const [draft] = await other.recoverableDrafts();
    expect(draft).toBeDefined();
    await other.discardDraft(draft!.id);
    expect(await other.recoverableDrafts()).toEqual([]);
    expect(await drafts.list()).toEqual([]);
  });

  it("leaves a draft it can't read listed, for a newer Sonobe", async () => {
    const storage = createMemoryProjectStorage();
    const drafts = createMemoryProjectStorage();
    const locks = sharedLocks();
    const lost = tab(storage, drafts, locks);
    lost.document.getState().apply([addRect("Card")], { label: "Add Card" });
    await lost.drafts!.flush();
    const id = lost.drafts!.current()!.id;
    lost.host!.dispose();
    const project = (await drafts.read(id))!.files["project.json"]!;
    await drafts.write(id, { files: { "project.json": project.replace(/"formatVersion": \d+/, '"formatVersion": 999') }, deleted: [] });

    const next = tab(storage, drafts, locks);
    expect(await next.restoreDraft(id)).toMatchObject({ ok: false, errorCode: "tooNew" });
    expect((await next.recoverableDrafts()).map((d) => d.id)).toEqual([id]);
    expect((await tab(storage, drafts, locks).recoverableDrafts()).map((d) => d.id)).toEqual([id]);
  });

  it("keeps a draft whose files don't make a document recoverable after it fails to open", async () => {
    const drafts = createMemoryProjectStorage();
    // A first write cut off after project.json, before components/main.json.
    const id = "m1x2y3z4-0badf11e";
    await drafts.write(id, { files: { "project.json": serializeDocument(createEmptyDocument({ name: "Cut Off" }))["project.json"]! }, deleted: [] });
    const next = tab(createMemoryProjectStorage(), drafts, sharedLocks());
    expect((await next.recoverableDrafts()).map((d) => d.id)).toEqual([id]);
    expect(await next.restoreDraft(id)).toMatchObject({ ok: false, errorCode: "invalidFormat" });
    expect((await next.recoverableDrafts()).map((d) => d.id)).toEqual([id]);
  });

  it("notices a draft cut off mid-write and still restores what's there", async () => {
    const storage = createMemoryProjectStorage();
    const drafts = createMemoryProjectStorage();
    const lost = tab(storage, drafts, null);
    lost.document.getState().apply([addRect("Card")], { label: "Add Card" });
    await lost.drafts!.flush();
    const id = lost.drafts!.current()!.id;
    const main = (await drafts.read(id))!.files["components/main.json"]!;
    await drafts.write(id, { files: { "components/main.json": main.replace('"Card"', '"Card from later"') }, deleted: [] });

    const next = tab(storage, drafts, null);
    expect((await next.recoverableDrafts())[0]).toMatchObject({ id, torn: true });
    expect(await next.restoreDraft(id)).toMatchObject({ ok: true, notes: [expect.stringContaining("last few changes may be missing")] });
    expect(next.document.getState().doc.components.main!.layers[0]!.name).toBe("Card from later");
  });
});
