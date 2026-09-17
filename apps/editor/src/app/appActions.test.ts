import { findLayer, type Id } from "@sonobe/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { layoutStore } from "../shell/layoutStore.ts";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import { CommandRegistry } from "../ui/commands/commandRegistry.ts";
import { alignSelection, closePrototype, insertLayer, renameSelection, useAsMask } from "./appActions.ts";
import { clipParentPlan, insertLayerOps, insertParentFor, layerPickItems, prototypeSize } from "./layerActions.ts";
import { issueUrl } from "./about.ts";

let session: EditorSession;
const notify = vi.fn();

beforeEach(() => {
  session = createEditorSession({ host: null, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  notify.mockReset();
});

afterEach(() => {
  session.dispose();
  layoutStore.getState().reset();
});

const root = () => session.document.getState().doc.components[session.document.getState().doc.project.root]!;

describe("layer actions", () => {
  it("lists insertable layer types without component instances", () => {
    const items = layerPickItems(session.registry);
    expect(items.some((i) => i.value === "rectangle")).toBe(true);
    expect(items.some((i) => i.value === "componentInstance")).toBe(false);
  });

  it("centers a new layer on the prototype screen", () => {
    const doc = session.document.getState().doc;
    expect(prototypeSize(doc)).toEqual([402, 874]);
    const [op] = insertLayerOps(doc, doc.project.root, "rectangle", session.registry);
    expect(op).toMatchObject({ op: "addLayer", parent: null, layer: { ref: "inserted", type: "rectangle", name: "Rectangle" } });
    const position = (op as unknown as { layer: { props: { position: [number, number] } } }).layer.props.position;
    expect(position[0]).toBeGreaterThan(0);
    expect(position[1]).toBeGreaterThan(0);
  });

  it("inserts into a selected group", () => {
    expect(insertParentFor(root(), ["card"], session.registry)).toBe("card");
    expect(insertParentFor(root(), ["title"], session.registry)).toBeNull();
    expect(insertParentFor(root(), ["card", "title"], session.registry)).toBeNull();
  });

  it("plans clipping for parent groups", () => {
    const plan = clipParentPlan(root(), ["sun"], session.registry);
    expect(plan).toMatchObject({ ok: true, clip: false, groups: [{ id: "photo", name: "Photo" }] });
    expect(clipParentPlan(root(), ["title"], session.registry)).toMatchObject({ ok: false, message: expect.stringContaining("group") });
  });
});

describe("app actions", () => {
  it("toggles Clip Contents on the parent group", () => {
    session.document.getState().apply([{ op: "updateLayer", component: "main", id: "photo", props: { clip: false } }], { label: "unclip" });
    session.selection.getState().select({ layers: ["sun"] });
    expect(useAsMask(session, notify)).toBe(true);
    expect(findLayer(root().layers, "photo")?.layer.props.clip).toBe(true);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "success", title: expect.stringContaining("Photo") }));
    expect(useAsMask(session, notify)).toBe(true);
    expect(findLayer(root().layers, "photo")?.layer.props.clip).toBe(false);
    session.selection.getState().select({ layers: ["title"] });
    expect(useAsMask(session, notify)).toBe(false);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Put the layer inside a group first" }));
  });

  it("inserts a picked layer and selects it", async () => {
    const id = await insertLayer(session, { pick: async () => "oval" }, notify);
    expect(id).toBeTruthy();
    expect(findLayer(root().layers, id as Id)?.layer.type).toBe("oval");
    expect(session.selection.getState().layers).toEqual([id]);
    expect(await insertLayer(session, { pick: async () => null }, notify)).toBeNull();
  });

  it("renames a layer through the dialog", async () => {
    const registry = new CommandRegistry();
    session.selection.getState().select({ layers: ["title"] });
    const prompt = vi.fn(async (options: { defaultValue?: string; validate?: (v: string) => string | null }) => {
      expect(options.defaultValue).toBe("Title");
      expect(options.validate?.("  ")).toBeTruthy();
      return "Headline";
    });
    await renameSelection(session, registry, { prompt }, notify);
    expect(findLayer(root().layers, "title")?.layer.name).toBe("Headline");
  });

  it("renames a patch inline when the patch editor can", async () => {
    const registry = new CommandRegistry();
    const inline = vi.fn();
    registry.register({ id: "patchEditor.rename", title: "Rename Patch", run: inline });
    session.selection.getState().select({ patches: ["zoomed"] });
    const prompt = vi.fn(async () => "Nope");
    await renameSelection(session, registry, { prompt }, notify);
    expect(inline).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
    layoutStore.getState().setViewMode("canvas");
    await renameSelection(session, registry, { prompt: async () => "Zoom State" }, notify);
    expect(root().patches.zoomed?.name).toBe("Zoom State");
  });

  it("aligns selected patches on their right and bottom edges", () => {
    session.selection.getState().select({ patches: ["tap_photo", "zoomed", "zoom_spring"] });
    expect(alignSelection(session, "bottom", null)).toBe(true);
    const ys = ["tap_photo", "zoomed", "zoom_spring"].map((id) => root().patches[id]!.ui.y);
    expect(new Set(ys).size).toBeGreaterThanOrEqual(1);
    expect(session.document.getState().undoLabel).toContain("Align bottom edges");
    expect(alignSelection(session, "right", null)).toBe(true);
    const xs = ["tap_photo", "zoomed", "zoom_spring"].map((id) => root().patches[id]!.ui.x);
    expect(new Set(xs).size).toBe(1);
    session.selection.getState().select({ patches: ["zoomed"] });
    expect(alignSelection(session, "right", null)).toBe(false);
  });

  it("closes the prototype into an empty one and shows the welcome screen", async () => {
    const show = vi.fn();
    expect(await closePrototype(session, show)).toBe(true);
    expect(Object.keys(root().patches)).toEqual([]);
    expect(show).toHaveBeenCalledWith("close");
  });

  it("fills the issue link", () => {
    const url = issueUrl({ version: "1.2.3", platform: "darwin", host: "desktop" }, "https://example.test/new");
    expect(url.startsWith("https://example.test/new?body=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("Sonobe 1.2.3 · desktop · darwin");
  });
});
