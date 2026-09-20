import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
