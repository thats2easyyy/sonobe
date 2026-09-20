import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDraftStore, DRAFT_RETENTION_MS, installQuitOnSignal, registerDraftIpc, type DraftStore } from "./drafts.ts";
import { IPC } from "./ipc.ts";

let dir: string;
let now: number;
let store: DraftStore;

const WINDOW = 1;
const OTHER = 2;
const ID = "m1x2y3z4-9f8e7d6c5b4a";

const meta = (extra: Record<string, unknown> = {}) => ({
  name: "Untitled",
  projectPath: null,
  revision: 3,
  createdAt: 100,
  counts: { components: 1, layers: 2, patches: 0 },
  seenIds: { items: { main: ["card", "hero"] }, components: ["main"], knobs: [], presets: [] },
  ...extra,
});
const files = {
  "project.json": '{\n  "formatVersion": 1,\n  "name": "Untitled",\n  "root": "main"\n}\n',
  "components/main.json": '{\n  "id": "main"\n}\n',
};

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "sonobe-drafts-")), "Drafts");
  now = 1_000_000;
  store = createDraftStore({ dir, version: "0.1.0-test", now: () => now });
});
afterEach(async () => {
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe("draft store", () => {
  it("writes a project folder with draft.json last, listing every file", async () => {
    await store.write(WINDOW, ID, { files, binaries: { "assets/abc.png": new Uint8Array([1, 2, 3]) } }, meta());
    const folder = path.join(dir, `${ID}.sonobe`);
    expect((await readdir(folder)).sort()).toEqual(["assets", "components", "draft.json", "project.json"]);
    const manifest = JSON.parse(await readFile(path.join(folder, "draft.json"), "utf8"));
    expect(manifest).toMatchObject({ formatVersion: 1, id: ID, name: "Untitled", projectPath: null, revision: 3, updatedAt: now, appVersion: "0.1.0-test", seenIds: { items: { main: ["card", "hero"] } } });
    expect(Object.keys(manifest.files).sort()).toEqual(["assets/abc.png", "components/main.json", "project.json"]);

    // Later writes send only what changed; the manifest keeps track of the rest.
    now += 5000;
    await store.write(WINDOW, ID, { files: { "components/card.json": '{\n  "id": "card"\n}\n' }, deleted: ["assets/abc.png"] }, meta({ revision: 4 }));
    const next = JSON.parse(await readFile(path.join(folder, "draft.json"), "utf8"));
    expect(Object.keys(next.files).sort()).toEqual(["components/card.json", "components/main.json", "project.json"]);
    expect(existsSync(path.join(folder, "assets", "abc.png"))).toBe(false);
  });

  it("refuses bad ids and the editor writing draft.json", async () => {
    await expect(store.write(WINDOW, "../escape", { files }, meta())).rejects.toMatchObject({ code: "invalid_draft" });
    await expect(store.write(WINDOW, "short", { files }, meta())).rejects.toMatchObject({ code: "invalid_draft" });
    await expect(store.write(WINDOW, ID, { files: { "draft.json": "{}" } }, meta())).rejects.toMatchObject({ code: "invalid_draft" });
    await expect(store.write(WINDOW, ID, { files: { "../outside.json": "{}" } }, meta())).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("lists only drafts no window claims, and one window can't take another's", async () => {
    await store.write(WINDOW, ID, { files }, meta());
    expect(await store.list()).toEqual([]);
    await expect(store.write(OTHER, ID, { files }, meta())).rejects.toMatchObject({ code: "draft_in_use" });
    await expect(store.read(OTHER, ID)).rejects.toMatchObject({ code: "draft_in_use" });
    await expect(store.remove(OTHER, ID)).rejects.toMatchObject({ code: "draft_in_use" });

    // The window closed (or crashed): the draft is recoverable, and another window can open it.
    store.release(WINDOW);
    expect(await store.list()).toEqual([{ id: ID, name: "Untitled", projectPath: null, createdAt: 100, updatedAt: now, revision: 3, counts: { components: 1, layers: 2, patches: 0 } }]);
    const read = await store.read(OTHER, ID);
    expect(read.info).toMatchObject({ id: ID, name: "Untitled" });
    expect(read.info.torn).toBeUndefined();
    expect(Object.keys(read.files).sort()).toEqual(["components/main.json", "project.json"]);
    expect(read.manifest).toMatchObject({ seenIds: { items: { main: ["card", "hero"] } } });
    expect(await store.list()).toEqual([]);
    await expect(store.read(OTHER, "nope-nope-nope")).rejects.toMatchObject({ code: "unknown_draft" });
  });

  it("notices a torn draft: a file from another moment, a missing one, or no draft.json yet", async () => {
    await store.write(WINDOW, ID, { files }, meta());
    store.release(WINDOW);
    const folder = path.join(dir, `${ID}.sonobe`);
    // A write cut off after main.json changed but before draft.json.
    await writeFile(path.join(folder, "components", "main.json"), '{\n  "id": "main",\n  "layers": []\n}\n');
    expect((await store.list())[0]).toMatchObject({ id: ID, torn: true });
    expect((await store.read(OTHER, ID)).info.torn).toBe(true);
    store.release(OTHER);

    // A component added by a cut-off write.
    await store.write(WINDOW, ID, { files }, meta());
    store.release(WINDOW);
    await writeFile(path.join(folder, "components", "card.json"), '{\n  "id": "card"\n}\n');
    expect((await store.list())[0]).toMatchObject({ torn: true });

    // The first write cut off before its manifest: named from project.json.
    const other = "abcdefgh-0000";
    await mkdir(path.join(dir, `${other}.sonobe`, "components"), { recursive: true });
    await writeFile(path.join(dir, `${other}.sonobe`, "project.json"), '{ "formatVersion": 1, "name": "Checkout", "root": "main" }\n');
    expect((await store.list()).find((d) => d.id === other)).toMatchObject({ name: "Checkout", torn: true });
  });

  it("is whole again once a recovered torn draft is written, with or without a draft.json", async () => {
    const folder = path.join(dir, `${ID}.sonobe`);
    await store.write(WINDOW, ID, { files: { ...files, "scripts/js_1.js": "one();\n", "scripts/js_2.js": "two();\n" } }, meta());
    store.release(WINDOW);
    // A write cut off after js_1.js landed, before draft.json.
    await writeFile(path.join(folder, "scripts", "js_1.js"), "one(later);\n");
    expect((await store.read(OTHER, ID)).info.torn).toBe(true);
    // The editor carries on from the files it read and later sends only what it changes.
    await store.write(OTHER, ID, { files: { "scripts/js_2.js": "two(edited);\n" } }, meta({ revision: 4 }));
    store.release(OTHER);
    expect((await store.list())[0]!.torn).toBeUndefined();
    expect((await createDraftStore({ dir, version: "0.1.0-test", now: () => now }).read(WINDOW, ID)).info.torn).toBeUndefined();

    // The first write cut off before its manifest: the next one lists the files it didn't send too.
    const other = "abcdefgh-0000";
    await mkdir(path.join(dir, `${other}.sonobe`, "components"), { recursive: true });
    await writeFile(path.join(dir, `${other}.sonobe`, "project.json"), files["project.json"]);
    await writeFile(path.join(dir, `${other}.sonobe`, "components", "main.json"), files["components/main.json"]);
    expect((await store.read(OTHER, other)).info).toMatchObject({ name: "Untitled", torn: true });
    await store.write(OTHER, other, { files: { "components/card.json": '{\n  "id": "card"\n}\n' } }, meta());
    store.release(OTHER);
    expect((await store.list()).find((d) => d.id === other)!.torn).toBeUndefined();
  });

  it("gives back a draft the editor couldn't use: it's listed again, and a closing window doesn't delete it", async () => {
    // A first write cut off after project.json: listed, but its files don't make a document.
    await mkdir(path.join(dir, `${ID}.sonobe`), { recursive: true });
    await writeFile(path.join(dir, `${ID}.sonobe`, "project.json"), files["project.json"]);
    await store.read(WINDOW, ID);
    expect(await store.list()).toEqual([]);
    store.release(WINDOW, ID);
    expect((await store.list()).map((d) => d.id)).toEqual([ID]);

    // Only that one: the window's own draft stays claimed, and closing after Don't Save deletes only it.
    const own = "keptkept-0001";
    await store.write(WINDOW, own, { files }, meta());
    await store.read(WINDOW, ID);
    store.release(WINDOW, ID);
    expect(store.holder(own)).toBe(WINDOW);
    expect(store.holder(ID)).toBeUndefined();
    await store.discard(WINDOW);
    expect(existsSync(path.join(dir, `${own}.sonobe`))).toBe(false);
    expect(existsSync(path.join(dir, `${ID}.sonobe`, "project.json"))).toBe(true);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("keeps a draft at launch whose files are there but can't be read", async () => {
    const warnings: string[] = [];
    const folder = path.join(dir, `${ID}.sonobe`);
    await store.write(WINDOW, ID, { files, binaries: { "assets/abc.png": new Uint8Array([1, 2, 3]) } }, meta());
    store.release(WINDOW);
    await chmod(path.join(folder, "draft.json"), 0o000);
    await chmod(path.join(folder, "project.json"), 0o000);
    try {
      const launch = createDraftStore({ dir, version: "0.1.0-test", now: () => now + 1000, log: (_level, message) => warnings.push(message) });
      expect(await launch.prune()).toBe(0);
      expect(existsSync(path.join(folder, "assets", "abc.png"))).toBe(true);
      expect(warnings).toEqual([`Kept draft ${ID}: its files are there but couldn't be read`]);
    } finally {
      await chmod(path.join(folder, "draft.json"), 0o644);
      await chmod(path.join(folder, "project.json"), 0o644);
    }
  });

  it("tells its own draft folders from projects", async () => {
    await store.write(WINDOW, ID, { files }, meta());
    const folder = path.join(dir, `${ID}.sonobe`);
    expect(await store.idAt(folder)).toBe(ID);
    expect(await store.idAt(`${folder}/`)).toBe(ID);
    // Not written yet, but a folder this store would take for a draft (a Save As into Drafts).
    expect(await store.idAt(path.join(dir, "Mockups1.sonobe"))).toBe("Mockups1");
    const link = path.join(path.dirname(dir), "linked");
    await symlink(dir, link);
    expect(await store.idAt(path.join(link, `${ID}.sonobe`))).toBe(ID);

    expect(await store.idAt(path.join(dir, "My Mockups.sonobe"))).toBeNull();
    expect(await store.idAt(path.join(folder, "components"))).toBeNull();
    expect(await store.idAt(path.join(path.dirname(dir), `${ID}.sonobe`))).toBeNull();
    expect(await store.idAt(path.join(dir, ID))).toBeNull();
    expect(await store.idAt(`Drafts/${ID}.sonobe`)).toBeNull();
  });

  it("removes a draft, discards a closing window's drafts, and prunes empty and old ones at launch", async () => {
    await store.write(WINDOW, ID, { files }, meta());
    await store.remove(WINDOW, ID);
    expect(existsSync(path.join(dir, `${ID}.sonobe`))).toBe(false);

    await store.write(WINDOW, ID, { files }, meta());
    await store.discard(WINDOW);
    expect(existsSync(path.join(dir, `${ID}.sonobe`))).toBe(false);

    const kept = "keptkept-0001";
    const old = "oldoldol-0002";
    const empty = "emptyemp-0003";
    await store.write(WINDOW, kept, { files }, meta());
    await store.write(WINDOW, old, { files }, meta());
    await mkdir(path.join(dir, `${empty}.sonobe`, "assets"), { recursive: true });
    store.release(WINDOW);
    now += DRAFT_RETENTION_MS - 1000;
    await store.write(OTHER, kept, { files }, meta());
    store.release(OTHER);
    now += 2000;
    expect(await store.prune()).toBe(2);
    expect((await store.list()).map((d) => d.id)).toEqual([kept]);
  });

  it("answers the editor over IPC with codes the context bridge keeps", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const revealed: string[] = [];
    registerDraftIpc({ handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void handlers.set(channel, fn) } as never, store, {
      requireWindow: (event) => ({ webContents: { id: (event as unknown as { id: number }).id } }),
      reveal: (folder) => revealed.push(folder),
    });
    const call = (channel: string, id: number, ...args: unknown[]) => handlers.get(channel)!({ id }, ...args);
    expect(await call(IPC.draftsWrite, WINDOW, ID, { files }, meta())).toEqual({ ok: true });
    expect(await call(IPC.draftsWrite, OTHER, ID, { files }, meta())).toMatchObject({ ok: false, code: "draft_in_use" });
    expect(await call(IPC.draftsRead, OTHER, "../nope")).toMatchObject({ ok: false, code: "invalid_draft" });
    expect(await call(IPC.draftsList, OTHER)).toEqual([]);
    await call(IPC.draftsRelease, OTHER, ID);
    expect(await call(IPC.draftsList, OTHER)).toEqual([]);
    await call(IPC.draftsRelease, WINDOW, ID);
    expect(await call(IPC.draftsList, OTHER)).toMatchObject([{ id: ID }]);
    await call(IPC.draftsReveal, WINDOW, ID);
    expect(revealed).toEqual([path.join(dir, `${ID}.sonobe`)]);
    expect(await call(IPC.draftsRemove, WINDOW, ID)).toEqual({ ok: true });
  });
});

describe("quitting on a signal", () => {
  it("writes drafts, then exits; a second signal exits at once; a hung flush waits at most the timeout", async () => {
    vi.useFakeTimers();
    try {
      const exits: string[] = [];
      let finish!: () => void;
      const flush = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      const uninstall = installQuitOnSignal({ flush, exit: () => exits.push("exit"), signals: ["SIGUSR2"], timeoutMs: 1500 });
      process.emit("SIGUSR2", "SIGUSR2");
      expect(flush).toHaveBeenCalledTimes(1);
      expect(exits).toEqual([]);
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(exits).toEqual(["exit"]);
      process.emit("SIGUSR2", "SIGUSR2");
      expect(exits).toEqual(["exit", "exit"]);
      uninstall();

      const hung: string[] = [];
      const off = installQuitOnSignal({ flush: () => new Promise(() => undefined), exit: () => hung.push("exit"), signals: ["SIGUSR2"], timeoutMs: 1500 });
      process.emit("SIGUSR2", "SIGUSR2");
      await vi.advanceTimersByTimeAsync(1499);
      expect(hung).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(hung).toEqual(["exit"]);
      off();
    } finally {
      vi.useRealTimers();
    }
  });
});
