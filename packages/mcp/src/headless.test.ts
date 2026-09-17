import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadProjectFromDisk } from "@sonobe/core/node";
import { afterEach, describe, expect, it } from "vitest";
import { createHeadlessHost } from "./headless.ts";
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
