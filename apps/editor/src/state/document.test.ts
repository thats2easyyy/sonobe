import { applyOps, createEmptyDocument, findLayer, parseDocumentFiles, serializeDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { ID_SCENARIO_SETUP, ID_SCENARIOS, runIdScenario, type IdScenarioHost } from "@sonobe/core/testing";
import { describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../host/browserHost.ts";
import { createDesktopHost } from "../host/desktopHost.ts";
import type { DesktopHostApi } from "../host/types.ts";
import { CLAUDE_AUTHOR, createDocumentStore } from "./document.ts";
import { getRegistry } from "./registry.ts";
import { saveDocumentInteractively } from "./saveFlow.ts";

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
    expect(store.getState().isRetiredId("main", "card")).toBe(true);
    expect(store.getState().isRetiredId("main", "card_2")).toBe(false);
    expect(store.getState().retiredIds()).toEqual({ main: ["card"] });
  });

  describe("shared id scenarios (ARCHITECTURE §3.2)", () => {
    const setup = () => {
      const r = applyOps(createEmptyDocument(), ID_SCENARIO_SETUP, { registry });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      return r.doc;
    };
    for (const scenario of ID_SCENARIOS) {
      it(scenario.name, async () => {
        const store = createDocumentStore({ registry, document: setup() });
        const host: IdScenarioHost = {
          apply: async (ops, { dryRun }) => store.getState().apply(ops, { label: "edit", author: CLAUDE_AUTHOR, dryRun }),
          undo: async () => void store.getState().undo(CLAUDE_AUTHOR),
        };
        expect(await runIdScenario(host, scenario)).toEqual(scenario.expected);
      });
    }
  });

  it("amends a gesture's steps into one group that can create the same items again", () => {
    const store = createDocumentStore({ registry, document: createEmptyDocument() });
    store.getState().apply([addRect("Sticker")], { label: "Insert" });
    const txnId = store.getState().lastChange!.txnId!;
    const amended = store.getState().amend(txnId, [addRect("Sticker", { id: "sticker", props: { opacity: 0.5 } })], { label: "Insert Sticker" });
    expect(amended.ok).toBe(true);
    expect(layerIds(store)).toEqual(["sticker"]);
    expect(store.getState().historyEntries().map((e) => e.label)).toEqual(["Insert Sticker"]);
    // Derived ids too: the undone layer's id is free for the final version.
    store.getState().apply([addRect("Label")], { label: "Insert" });
    expect(store.getState().amend(store.getState().lastChange!.txnId!, [addRect("Label")], { label: "Insert Label" }).results[0]!.ids).toEqual(["label"]);
    // A failing amend puts the undone groups back.
    const before = store.getState().doc;
    const failed = store.getState().amend(store.getState().lastChange!.txnId!, [{ op: "removeLayer", id: "ghost" }], { label: "Broken" });
    expect(failed.ok).toBe(false);
    expect(store.getState().doc.components.main).toEqual(before.components.main);
    expect(store.getState().historyEntries().map((e) => e.label)).toEqual(["Insert Label", "Insert Sticker"]);
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

describe("document store: open gestures", () => {
  it("publishes the open gesture's key while a scrub runs, and null once it ends", () => {
    const doc = applyOps(createEmptyDocument({ name: "Proj" }), [addRect("Card")], { registry }).doc;
    const store = createDocumentStore({ registry, document: doc });
    const move = (x: number, gesture?: "begin" | "update" | "end") =>
      store.getState().apply([{ op: "updateLayer", id: "card", props: { position: [x, 0] } }], { label: "Move Card", coalesceKey: "scrub:@card.position", ...(gesture ? { gesture } : {}) });
    const seen: (string | null)[] = [];
    const off = store.subscribe((s, prev) => {
      if (s.gesture !== prev.gesture) seen.push(s.gesture);
    });
    expect(store.getState().gesture).toBeNull();
    move(1, "begin");
    expect(store.getState().gesture).toBe("scrub:@card.position");
    move(2, "update");
    move(3, "update");
    store.getState().endGesture("scrub:@card.position");
    expect(store.getState().gesture).toBeNull();
    move(4, "begin");
    move(5, "end");
    expect(store.getState().gesture).toBeNull();
    move(6, "begin");
    store.getState().apply([addRect("Chip")], { label: "Add Chip" });
    expect(store.getState().gesture).toBeNull();
    // Only begins and ends notify; the updates in between don't.
    expect(seen).toEqual(["scrub:@card.position", null, "scrub:@card.position", null, "scrub:@card.position", null]);
    off();
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
    expect(result).toEqual({ ok: true, path: "browser:Photo Zoom", written: ["project.json", "components/main.json", "assets/assets.json"], deleted: [] });
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

/** A project folder behind the desktop host: `files` is the disk, `hold()` makes the next writes wait. */
function diskProject(initial: SonobeDocument) {
  const dir = "/p/Proj.sonobe";
  const files: Record<string, string> = serializeDocument(initial);
  const writes: { files?: Record<string, string>; deleted?: string[] }[] = [];
  let gate: Promise<void> | null = null;
  const api: DesktopHostApi = {
    platform: "darwin",
    version: "0.1.0",
    openProjectDialog: async () => dir,
    saveProjectDialog: async () => dir,
    readProject: async () => ({ files: { ...files }, binaries: {} }),
    writeProject: async (_dir, changes) => {
      if (gate) await gate;
      writes.push(changes);
      for (const [path, text] of Object.entries(changes.files ?? {})) files[path] = text as string;
      for (const path of changes.deleted ?? []) delete files[path];
    },
    watchProject: () => () => undefined,
    revealInFinder: () => undefined,
    recentProjects: async () => [],
    onCommand: () => () => undefined,
    onOpenProject: () => () => undefined,
    commands: () => [],
    setDocumentEdited: () => undefined,
    setTitle: () => undefined,
    rpc: { handle: () => () => undefined, fail: () => undefined },
    getMcpStatus: async () => ({}),
  };
  const store = createDocumentStore({ registry, host: createDesktopHost(api) });
  /** Another tool saves the project: `ops` applied to what's on disk. */
  const outsideEdit = (ops: Op[]) => {
    const next = applyOps(parseDocumentFiles(files), ops, { registry });
    if (!next.ok) throw new Error(JSON.stringify(next.errors));
    Object.assign(files, serializeDocument(next.doc));
  };
  const hold = () => {
    let release!: () => void;
    gate = new Promise((resolve) => (release = resolve));
    return () => {
      gate = null;
      release();
    };
  };
  return { dir, files, writes, store, outsideEdit, hold };
}

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const withCard = () => applyOps(createEmptyDocument({ name: "Proj" }), [addRect("Card")], { registry }).doc;
const cardOf = (store: ReturnType<typeof createDocumentStore>) => findLayer(store.getState().doc.components.main!.layers, "card")?.layer;

describe("document store: outside changes", () => {
  it("says when an outside change leaves a file it can't read, and the next save rewrites it", async () => {
    const p = diskProject(withCard());
    expect((await p.store.getState().open(p.dir)).ok).toBe(true);
    const good = p.files["assets/assets.json"]!;
    p.files["assets/assets.json"] = "<<<<<<< HEAD\n{}\n=======\n{ }\n>>>>>>> theirs\n";
    await p.store.getState().checkExternalChanges(["assets/assets.json"]);
    expect(p.store.getState()).toMatchObject({ dirty: true, externalChange: null, diskProblem: { paths: ["assets/assets.json"], code: "corrupt", message: expect.stringContaining("assets/assets.json") } });

    // A later good read clears it.
    p.files["assets/assets.json"] = good;
    await p.store.getState().checkExternalChanges(["assets/assets.json"]);
    expect(p.store.getState()).toMatchObject({ dirty: false, diskProblem: null });

    p.files["assets/assets.json"] = "{ nope";
    await p.store.getState().checkExternalChanges(["assets/assets.json"]);
    p.store.getState().apply([{ op: "updateLayer", id: "card", props: { opacity: 0.5 } }], { label: "Set opacity" });
    expect(await p.store.getState().save()).toMatchObject({ ok: true });
    expect(Object.keys(p.writes.at(-1)!.files!).sort()).toEqual(["assets/assets.json", "components/main.json"]);
    expect(parseDocumentFiles(p.files).components.main!.layers[0]!.props.opacity).toBe(0.5);
    expect(p.store.getState()).toMatchObject({ dirty: false, diskProblem: null });
  });

  it("rewrites a broken file on save even with no edits", async () => {
    const p = diskProject(withCard());
    await p.store.getState().open(p.dir);
    p.files["project.json"] = "{";
    await p.store.getState().checkExternalChanges(["project.json"]);
    expect(p.store.getState().dirty).toBe(true);
    expect(await p.store.getState().save()).toMatchObject({ ok: true });
    expect(Object.keys(p.writes.at(-1)!.files!)).toEqual(["project.json"]);
    expect(() => parseDocumentFiles(p.files)).not.toThrow();
  });

  it("checks outside changes that arrive while saving once the save is done", async () => {
    const p = diskProject(withCard());
    await p.store.getState().open(p.dir);
    p.store.getState().apply([{ op: "setProject", changes: { fps: 120 } }], { label: "120 fps" });
    const release = p.hold();
    const saving = p.store.getState().save();
    expect(p.store.getState().status).toBe("saving");
    const theirs = applyOps(parseDocumentFiles(p.files), [addRect("External Dot")], { registry }).doc;
    p.files["components/main.json"] = serializeDocument(theirs)["components/main.json"]!;
    await p.store.getState().checkExternalChanges(["components/main.json"]);
    release();
    expect((await saving).ok).toBe(true);
    await flush();
    expect(layerIds(p.store)).toEqual(["card", "external_dot"]);
    expect(p.store.getState()).toMatchObject({ dirty: false, externalChange: null, lastChange: { kind: "reload" } });
    expect(p.store.getState().doc.project.fps).toBe(120);
  });

  it("won't save over an outside change until the person decides", async () => {
    const p = diskProject(withCard());
    await p.store.getState().open(p.dir);
    p.store.getState().apply([addRect("Mine")], { label: "Add Mine" });
    p.outsideEdit([addRect("Theirs")]);
    await p.store.getState().checkExternalChanges(["components/main.json"]);
    expect(p.store.getState().externalChange?.paths).toEqual(["components/main.json"]);

    expect(await p.store.getState().save()).toMatchObject({ ok: false, errorCode: "disk_changed", error: expect.stringContaining("changed outside Sonobe") });
    expect(parseDocumentFiles(p.files).components.main!.layers.map((l) => l.id)).toEqual(["card", "theirs"]);
    expect(p.store.getState().externalChange).not.toBeNull();

    expect(await p.store.getState().save({ overwriteExternal: true })).toMatchObject({ ok: true });
    expect(parseDocumentFiles(p.files).components.main!.layers.map((l) => l.id)).toEqual(["card", "mine"]);
    expect(p.store.getState()).toMatchObject({ dirty: false, externalChange: null });

    p.store.getState().apply([addRect("Second")], { label: "Add Second" });
    p.outsideEdit([addRect("Theirs Again")]);
    await p.store.getState().checkExternalChanges(["components/main.json"]);
    p.store.getState().dismissExternalChange();
    expect(await p.store.getState().save()).toMatchObject({ ok: true });
  });

  it("asks which version to keep when the person saves", async () => {
    const p = diskProject(withCard());
    await p.store.getState().open(p.dir);
    const setup = async () => {
      p.store.getState().apply([addRect("Mine")], { label: "Add Mine" });
      p.outsideEdit([addRect("Theirs")]);
      await p.store.getState().checkExternalChanges(["components/main.json"]);
    };
    await setup();
    const choose = vi.fn(async () => "reload" as const);
    expect(await saveDocumentInteractively(p.store, { choose } as never)).toMatchObject({ ok: false, cancelled: true, reloaded: true });
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining("changed outside Sonobe"), actions: expect.arrayContaining([expect.objectContaining({ value: "overwrite" })]) }));
    expect(layerIds(p.store)).toEqual(["card", "theirs"]);
    expect(p.store.getState().dirty).toBe(false);

    await setup();
    expect(await saveDocumentInteractively(p.store, { choose: async () => "overwrite" } as never)).toMatchObject({ ok: true });
    // "mine" was removed by the reload, and removed ids aren't reused within a session.
    expect(parseDocumentFiles(p.files).components.main!.layers.map((l) => l.id)).toEqual(["card", "theirs", "mine_2"]);
  });

  it("keeps undo and redo from reverting outside changes after a reload", async () => {
    const p = diskProject(createEmptyDocument({ name: "Proj" }));
    await p.store.getState().open(p.dir);
    p.store.getState().apply([addRect("Card", { props: { opacity: 0.5 } })], { label: "Add Card" });
    await p.store.getState().save();
    p.outsideEdit([{ op: "updateLayer", id: "card", name: "Hero Card", props: { opacity: 0.8 } }]);
    await p.store.getState().checkExternalChanges(["components/main.json"]);
    expect(cardOf(p.store)).toMatchObject({ name: "Hero Card", props: { opacity: 0.8 } });
    expect(p.store.getState()).toMatchObject({ dirty: false, canUndo: true, undoLabel: "Outside Sonobe: Reloaded from disk" });
    const reloaded = p.store.getState().doc;

    expect(p.store.getState().undo().ok).toBe(true);
    expect(cardOf(p.store)).toMatchObject({ name: "Card", props: { opacity: 0.5 } });
    expect(p.store.getState().dirty).toBe(true);
    expect(p.store.getState().redo().ok).toBe(true);
    expect(p.store.getState().doc).toBe(reloaded);
    expect(p.store.getState().dirty).toBe(false);

    p.store.getState().undo();
    p.store.getState().undo();
    expect(cardOf(p.store)).toBeUndefined();
    p.store.getState().redo();
    p.store.getState().redo();
    expect(cardOf(p.store)).toMatchObject({ name: "Hero Card", props: { opacity: 0.8 } });
    expect(serializeDocument(p.store.getState().doc)).toEqual(p.files);
    expect(p.store.getState().dirty).toBe(false);

    // Reloading over unsaved edits: undo brings the edits back as they were.
    p.store.getState().apply([{ op: "updateLayer", id: "card", props: { opacity: 0.2 } }], { label: "Fade" });
    p.outsideEdit([{ op: "updateLayer", id: "card", props: { opacity: 1 } }]);
    await p.store.getState().checkExternalChanges(["components/main.json"]);
    p.store.getState().acceptExternalChange();
    expect(cardOf(p.store)!.props.opacity).toBe(1);
    p.store.getState().undo();
    expect(cardOf(p.store)!.props.opacity).toBe(0.2);
    p.store.getState().redo();
    expect(cardOf(p.store)!.props.opacity).toBe(1);
    expect(p.store.getState().dirty).toBe(false);
  });
});
