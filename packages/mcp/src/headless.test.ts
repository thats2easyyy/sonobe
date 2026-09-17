import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyOps, createEmptyDocument, findLayer, type Op } from "@sonobe/core";
import { loadProjectFromDisk, saveProjectToDisk } from "@sonobe/core/node";
import { afterEach, describe, expect, it } from "vitest";
import { createHeadlessHost, type HeadlessHost, type HeadlessHostOptions } from "./headless.ts";
import { isHostError } from "./host.ts";
import { connectClient, tempProject, type TempProject } from "./test-helpers.ts";

let project: TempProject | undefined;
const dirs: string[] = [];

afterEach(async () => {
  await project?.cleanup();
  project = undefined;
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const tmp = async () => {
  const d = await mkdtemp(path.join(tmpdir(), "sonobe-headless-"));
  dirs.push(d);
  return d;
};

describe("HeadlessHost", () => {
  it("creates projects from templates that validate cleanly", async () => {
    project = await tempProject({ template: "photo-zoom" });
    const diagnostics = await project.host.diagnostics();
    expect(diagnostics.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const disk = await loadProjectFromDisk(project.project);
    expect(Object.keys(disk.components.main!.patches).sort()).toEqual([
      "tap_photo",
      "zoom_scale",
      "zoom_spring",
      "zoomed",
    ]);
    expect((await project.host.listDocuments())[0]).toMatchObject({
      docId: "test",
      active: true,
      dirty: false,
      revision: 0,
    });
  });

  it("autosaves writes and undo when enabled", async () => {
    project = await tempProject({ autosave: true });
    const client = await connectClient(project.host);
    const r = await client.call("add_layers", { layers: [{ type: "oval", name: "Dot" }] });
    expect(r.text).toContain("Saved to disk.");
    expect(
      (await loadProjectFromDisk(project.project)).components.main!.layers.map((l) => l.id),
    ).toEqual(["dot"]);
    await client.call("undo", {});
    expect((await loadProjectFromDisk(project.project)).components.main!.layers).toEqual([]);
    await client.close();
  });

  it("tracks unsaved changes and saves on request", async () => {
    project = await tempProject();
    const client = await connectClient(project.host);
    await client.call("add_layers", { layers: [{ type: "oval", name: "Dot" }] });
    expect((await client.call("get_document_info", {})).structured.dirty).toBe(true);
    expect((await loadProjectFromDisk(project.project)).components.main!.layers).toEqual([]);
    const saved = await client.call("save_document", {});
    expect(saved.text).toContain("wrote components/main.json");
    expect((await client.call("get_document_info", {})).structured.dirty).toBe(false);
    const text = await readFile(path.join(project.project, "components", "main.json"), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    await client.close();
  });

  it("opens by path or docId and explains folders that aren't projects", async () => {
    const dir = await tmp();
    const host = createHeadlessHost();
    const created = await host.createDocument({ path: path.join(dir, "One.sonobe"), open: false });
    expect(created.active).toBe(false);
    await expect(host.getDocument()).rejects.toMatchObject({ code: "no_document" });
    const opened = await host.openDocument(path.join(dir, "One.sonobe"));
    expect(opened).toMatchObject({ docId: "one", active: true });
    expect((await host.openDocument("one")).docId).toBe("one");

    await mkdir(path.join(dir, "Empty"));
    const err = await host.openDocument(path.join(dir, "Empty")).catch((e: unknown) => e);
    expect(isHostError(err)).toBe(true);
    expect(err).toMatchObject({
      code: "not_a_project",
      hint: expect.stringContaining("create_document"),
    });

    await writeFile(path.join(dir, "One.sonobe", "components", "main.json"), "{ nope");
    const corrupt = createHeadlessHost();
    await expect(corrupt.openDocument(path.join(dir, "One.sonobe"))).rejects.toMatchObject({
      code: "invalid_project",
    });

    await expect(host.createDocument({ path: path.join(dir, "One.sonobe") })).rejects.toMatchObject(
      { code: "already_exists" },
    );
    await expect(
      host.createDocument({ path: path.join(dir, "Two.sonobe"), template: "carousel" }),
    ).rejects.toMatchObject({ code: "unknown_template" });
    await expect(host.getDocument("nope")).rejects.toMatchObject({
      code: "unknown_document",
      hint: expect.stringContaining("one"),
    });
    await host.close();
  });

  it("keeps folders it didn't load in scripts/ when it saves", async () => {
    project = await tempProject();
    await project.host.apply([{ op: "setScript", file: "js_1.js", source: "// one\n" }], { label: "script", author: AGENT });
    await project.host.saveDocument();
    const scripts = path.join(project.project, "scripts");
    await mkdir(path.join(scripts, "lib"), { recursive: true });
    await writeFile(path.join(scripts, "lib", "math.js"), "export const x = 1;\n");
    const reopened = createHeadlessHost();
    await reopened.openDocument(project.project);
    await reopened.apply([{ op: "setScript", file: "js_1.js", source: null }], { label: "remove script", author: AGENT });
    expect((await reopened.saveDocument()).removed).toEqual(["scripts/js_1.js"]);
    expect(await readdir(scripts)).toEqual(["lib"]);
    await reopened.close();
  });

  it("records presence and attributes writes to the client", async () => {
    project = await tempProject();
    const client = await connectClient(project.host, "cursor-agent");
    await client.call("begin_work", { intent: "Adding a card", ids: ["card"] });
    expect((await client.call("get_document_info", {})).text).toContain(
      "Working: Cursor Agent — Adding a card",
    );
    await client.call("add_layers", { layers: [{ type: "rectangle", name: "Card" }] });
    expect((await client.call("list_history", {})).text).toContain("Cursor Agent: added 1 layer");
    await client.call("finish_work", { summary: "Added a card." });
    expect((await client.call("get_document_info", {})).text).not.toContain("Working:");
    expect((await client.call("reveal", { ids: ["card"] })).text).toContain(
      "Not revealed: Headless mode",
    );
    await client.close();
  });
});

const AGENT = { kind: "agent" as const, name: "Claude" };

describe("HeadlessHost with other writers in the same folder", () => {
  const hosts: HeadlessHost[] = [];
  afterEach(async () => {
    for (const h of hosts.splice(0)) await h.close();
  });

  const setup = async (options: HeadlessHostOptions = {}) => {
    const project = path.join(await tmp(), "Shared.sonobe");
    await saveProjectToDisk(project, createEmptyDocument({ name: "Shared" }));
    const host = createHeadlessHost(options);
    hosts.push(host);
    await host.openDocument(project);
    return { project, host };
  };

  /** Another writer (the app, git, a person) saves the project through core. */
  const outsideEdit = async (host: HeadlessHost, project: string, ops: Op[]) => {
    const r = applyOps(await loadProjectFromDisk(project), ops, { registry: host.registry });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    await saveProjectToDisk(project, r.doc);
  };
  const diskLayers = async (project: string) =>
    (await loadProjectFromDisk(project)).components.main!.layers.map((l) => l.id);

  it("refuses to save over outside changes, and force never deletes files it didn't load", async () => {
    const { project, host } = await setup();
    await outsideEdit(host, project, [
      { op: "addLayer", layer: { type: "rectangle", id: "hero", name: "Hero" } },
      { op: "addComponent", component: { id: "button", name: "Button", kind: "layerComponent" } },
      { op: "setScript", file: "helper.js", source: "export const x = 1;" },
    ]);
    await host.apply([{ op: "addPatch", patch: { type: "switch", id: "toggle" } }], { label: "add toggle", author: AGENT });

    const err = await host.saveDocument().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "disk_changed", hint: expect.stringContaining("force: true"), data: { paths: ["components/button.json", "components/main.json", "scripts/helper.js"] } });
    expect(await diskLayers(project)).toEqual(["hero"]);

    const forced = await host.saveDocument(undefined, { force: true });
    expect(forced).toMatchObject({ written: ["components/main.json"], removed: [], overwritten: ["components/button.json", "components/main.json", "scripts/helper.js"] });
    expect(await readdir(path.join(project, "components"))).toEqual(["button.json", "main.json"]);
    expect(existsSync(path.join(project, "scripts", "helper.js"))).toBe(true);

    // What force kept is part of the folder now: the next save doesn't conflict or delete it.
    await host.apply([{ op: "addPatch", patch: { type: "switch", id: "second" } }], { label: "add second", author: AGENT });
    expect((await host.saveDocument()).removed).toEqual([]);
    expect(existsSync(path.join(project, "components", "button.json"))).toBe(true);
  });

  it("explains the conflict through save_document", async () => {
    const { project, host } = await setup();
    const client = await connectClient(host);
    await outsideEdit(host, project, [{ op: "addLayer", layer: { type: "oval", id: "dot", name: "Dot" } }]);
    const r = await client.call("save_document", {});
    expect(r.isError).toBe(true);
    expect(r.text).toContain("disk_changed");
    expect(r.text).toContain("reload: true");
    const reloaded = await client.call("open_document", { ref: project, reload: true });
    expect(reloaded.text).toContain("Reloaded from disk");
    expect((await host.getDocument()).doc.components.main!.layers.map((l) => l.id)).toEqual(["dot"]);
    expect((await client.call("save_document", {})).isError).toBe(false);
    await client.close();
  });

  it("(a) keeps an outside edit to a file it knows", async () => {
    const { project, host } = await setup();
    await outsideEdit(host, project, [{ op: "addLayer", layer: { type: "rectangle", id: "theirs", name: "Theirs" } }]);
    await host.apply([{ op: "addLayer", layer: { type: "oval", id: "mine", name: "Mine" } }], { label: "add mine", author: AGENT });
    await expect(host.saveDocument()).rejects.toMatchObject({ code: "disk_changed" });
    expect(await diskLayers(project)).toEqual(["theirs"]);
  });

  it("(b) autosave reports the conflict without saving or losing the in-memory edit", async () => {
    const { project, host } = await setup({ autosave: true });
    const client = await connectClient(host);
    await outsideEdit(host, project, [{ op: "addLayer", layer: { type: "rectangle", id: "theirs", name: "Theirs" } }]);
    const r = await client.call("add_layers", { layers: [{ type: "oval", name: "Mine" }] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Not saved to disk (disk_changed)");
    expect(r.structured).toMatchObject({ saved: false, saveError: { code: "disk_changed" } });
    expect(await diskLayers(project)).toEqual(["theirs"]);
    expect(findLayer((await host.getDocument()).doc.components.main!.layers, "mine")).toBeDefined();

    const undone = await client.call("undo", {});
    expect(undone.text).toContain("Not saved to disk (disk_changed)");
    expect(await diskLayers(project)).toEqual(["theirs"]);
    await client.close();
  });

  it("(c) a second session's save doesn't erase the first session's saved work", async () => {
    const { project, host: first } = await setup();
    const second = createHeadlessHost();
    hosts.push(second);
    await second.openDocument(project);
    await first.apply([{ op: "addLayer", layer: { type: "rectangle", id: "one", name: "One" } }], { label: "one", author: AGENT });
    await first.saveDocument();
    await second.apply([{ op: "addLayer", layer: { type: "rectangle", id: "two", name: "Two" } }], { label: "two", author: AGENT });
    await expect(second.saveDocument()).rejects.toMatchObject({ code: "disk_changed" });
    expect(await diskLayers(project)).toEqual(["one"]);
  });

  it("(d) a save with nothing unsaved still doesn't write over outside changes", async () => {
    const { project, host } = await setup();
    await outsideEdit(host, project, [{ op: "addLayer", layer: { type: "rectangle", id: "theirs", name: "Theirs" } }]);
    expect((await host.listDocuments())[0]!.dirty).toBe(false);
    await expect(host.saveDocument()).rejects.toMatchObject({ code: "disk_changed" });
    expect(await diskLayers(project)).toEqual(["theirs"]);
  });

  it("creating a project in a folder never deletes what's already there", async () => {
    const dir = await tmp();
    const project = path.join(dir, "New.sonobe");
    await mkdir(path.join(project, "components"), { recursive: true });
    await writeFile(path.join(project, "components", "draft.json"), "{}\n");
    const host = createHeadlessHost();
    hosts.push(host);
    await host.createDocument({ path: project });
    expect(existsSync(path.join(project, "components", "draft.json"))).toBe(true);
  });
});
