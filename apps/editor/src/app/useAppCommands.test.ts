import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectClaudeStore } from "../panels/connect/connectStore.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { layoutStore } from "../shell/layoutStore.ts";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import { CommandRegistry } from "../ui/commands/commandRegistry.ts";
import { appPanels } from "./appPanels.ts";
import { learnNav } from "./learnStore.ts";
import { appCommands, runInPatchEditor, runWhenRegistered, zoomTarget } from "./useAppCommands.tsx";
import { welcomeStore } from "./welcome/welcomeStore.ts";

let session: EditorSession;
let registry: CommandRegistry;

beforeEach(() => {
  session = createEditorSession({ host: null, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  registry = new CommandRegistry();
  registry.register(appCommands(session, registry));
});

afterEach(() => {
  vi.useRealTimers();
  session.dispose();
  layoutStore.getState().reset();
  connectClaudeStore.getState().hide();
  welcomeStore.getState().hide();
  appPanels.getState().hide();
});

describe("appCommands", () => {
  it("opens Connect Claude from the palette command and the Assistant menu item", () => {
    expect(registry.get("ai.connectClaude")?.hidden).toBeFalsy();
    expect(registry.get("ai.connectClaude")?.category).toBe("Help");
    registry.run("ai.connectClaude");
    expect(connectClaudeStore.getState().open).toBe(true);
    connectClaudeStore.getState().hide();
    expect(registry.get("ai.assistant")?.hidden).toBe(true);
    registry.run("ai.assistant");
    expect(connectClaudeStore.getState().open).toBe(true);
  });

  it("keeps menu aliases out of the palette, listing patch editor aliases only while the patch editor isn't mounted", () => {
    const visible = () => registry.available().map((c) => c.id);
    expect(visible()).toEqual(["file.new", "file.close", "app.settings", "layer.insert", "patch.insert", "patch.tidyUp", "patch.commentAroundSelection", "viewer.fullscreen", "ai.connectClaude", "help.lessons", "help.patchReference", "help.welcome", "help.reportIssue", "help.about", "help.shortcuts"]);
    expect(registry.get("patch.alignRight")).toMatchObject({ title: "Align Right Edges", category: "Patches", disabledReason: "Select 2 or more patches" });
    session.selection.getState().select({ patches: ["tap_photo", "zoomed"] });
    expect(visible()).toContain("patch.alignBottom");
    // Once the patch editor registers its own commands (with shortcuts), each align command is listed once.
    for (const id of ["insertPatch", "tidyUp", "commentSelection", "alignLeft", "alignRight", "alignTop", "alignBottom"]) registry.register({ id: `patchEditor.${id}`, title: id, run: () => undefined });
    expect(visible().filter((id) => id.startsWith("patch."))).toEqual([]);
  });

  it("registers a command for every desktop menu item that had none", () => {
    for (const id of ["file.close", "app.settings", "edit.rename", "layer.insert", "layer.useAsMask", "patch.alignBottom", "patch.alignRight", "viewer.fullscreen", "help.reportIssue"]) expect(registry.get(id), id).toBeDefined();
  });

  it("enables selection commands only with a selection", () => {
    expect(registry.isEnabled("edit.rename")).toBe(false);
    expect(registry.isEnabled("layer.useAsMask")).toBe(false);
    expect(registry.isEnabled("patch.alignRight")).toBe(false);
    session.selection.getState().select({ layers: ["photo"] });
    expect(registry.isEnabled("edit.rename")).toBe(true);
    expect(registry.isEnabled("layer.useAsMask")).toBe(true);
    session.selection.getState().select({ patches: ["tap_photo", "zoomed"] });
    expect(registry.isEnabled("patch.alignBottom")).toBe(true);
    expect(registry.isEnabled("edit.rename")).toBe(false);
  });

  it("binds Use as Mask only on macOS, where it doesn't collide with Show Diagnostics", () => {
    expect(appCommands(session, registry, { platform: "mac" }).find((c) => c.id === "layer.useAsMask")?.shortcut).toBe("Mod+Alt+M");
    expect(appCommands(session, registry, { platform: "windows" }).find((c) => c.id === "layer.useAsMask")?.shortcut).toBeUndefined();
  });

  it("opens the welcome screen for New, and Settings and About", () => {
    registry.run("file.new");
    expect(welcomeStore.getState()).toMatchObject({ open: true, reason: "new" });
    registry.run("app.settings");
    expect(appPanels.getState().open).toBe("settings");
    registry.run("help.about");
    expect(appPanels.getState().open).toBe("about");
    registry.run("help.lessons");
    expect(learnNav.getState().view).toEqual({ kind: "lessons" });
  });

  it("routes patch menu items to the patch editor, showing it first when hidden", () => {
    vi.useFakeTimers();
    const insert = vi.fn();
    registry.register({ id: "patchEditor.insertPatch", title: "Insert Patch", run: insert });
    layoutStore.getState().setViewMode("split");
    registry.run("patch.insert");
    expect(insert).toHaveBeenCalledTimes(1);

    layoutStore.getState().setViewMode("canvas");
    runInPatchEditor(registry, "patchEditor.insertPatch");
    expect(layoutStore.getState().viewMode).toBe("split");
    expect(insert).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("waits for a lazily loaded panel to register its command", () => {
    vi.useFakeTimers();
    const tidy = vi.fn();
    layoutStore.getState().setViewMode("split");
    registry.run("patch.tidyUp");
    vi.advanceTimersByTime(40);
    expect(tidy).not.toHaveBeenCalled();
    registry.register({ id: "patchEditor.tidyUp", title: "Tidy Up", run: tidy });
    vi.advanceTimersByTime(20);
    expect(tidy).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    runWhenRegistered(registry, "never.registered", 100);
    vi.advanceTimersByTime(200);
    registry.register({ id: "never.registered", title: "Late", run: late });
    vi.advanceTimersByTime(40);
    expect(late).not.toHaveBeenCalled();
  });

  it("toggles the canvas and patch editor view modes", () => {
    layoutStore.getState().setViewMode("split");
    registry.run("view.toggleCanvas");
    expect(layoutStore.getState().viewMode).toBe("patches");
    registry.run("view.toggleCanvas");
    expect(layoutStore.getState().viewMode).toBe("split");
    registry.run("view.togglePatchEditor");
    expect(layoutStore.getState().viewMode).toBe("canvas");
    registry.run("view.togglePatchEditor");
    expect(layoutStore.getState().viewMode).toBe("split");
    registry.run("view.toggleSplitOrientation");
    expect(layoutStore.getState().splitDirection).toBe("columns");
  });

  it("zooms the surface you're working in", () => {
    layoutStore.getState().setViewMode("split");
    session.selection.getState().setFocusedPanel("patchEditor");
    expect(zoomTarget(session, "zoomIn")).toBe("patchEditor.zoomIn");
    session.selection.getState().setFocusedPanel("canvas");
    expect(zoomTarget(session, "zoomToFit")).toBe("canvas.zoomToFit");
    layoutStore.getState().setViewMode("patches");
    expect(zoomTarget(session, "zoomOut")).toBe("patchEditor.zoomOut");

    const zoom = vi.fn();
    registry.register({ id: "patchEditor.zoomOut", title: "Zoom Out", run: zoom });
    registry.run("view.zoomOut");
    expect(zoom).toHaveBeenCalledTimes(1);
  });

  it("opens the patch reference, and a keyboard shortcuts cheat sheet (not the palette)", () => {
    registry.run("help.patchReference");
    expect(learnNav.getState().view).toEqual({ kind: "patches" });
    expect(layoutStore.getState().drawer).toBe("learn");

    const palette = vi.fn();
    registry.register({ id: "app.commandPalette", title: "Palette", run: palette });
    registry.run("help.shortcuts");
    expect(palette).not.toHaveBeenCalled();
    expect(appPanels.getState().open).toBe("shortcuts");
    expect(appCommands(session, registry, { platform: "mac" }).find((c) => c.id === "help.shortcuts")?.shortcut).toBe("Mod+Alt+/");
    expect(appCommands(session, registry, { platform: "windows" }).find((c) => c.id === "help.shortcuts")?.shortcut).toBe("Ctrl+Shift+/");
  });
});
