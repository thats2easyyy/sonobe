import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectClaudeStore } from "../panels/connect/connectStore.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { layoutStore } from "../shell/layoutStore.ts";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import { CommandRegistry } from "../ui/commands/commandRegistry.ts";
import { learnNav } from "./learnStore.ts";
import { appCommands, runInPatchEditor, zoomTarget } from "./useAppCommands.tsx";

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
});

describe("appCommands", () => {
  it("opens Connect Claude from the palette command and the Assistant menu item", () => {
    expect(registry.get("ai.connectClaude")?.hidden).toBeFalsy();
    registry.run("ai.connectClaude");
    expect(connectClaudeStore.getState().open).toBe(true);
    connectClaudeStore.getState().hide();
    expect(registry.get("ai.assistant")?.hidden).toBe(true);
    registry.run("ai.assistant");
    expect(connectClaudeStore.getState().open).toBe(true);
  });

  it("keeps menu aliases out of the palette", () => {
    const visible = registry.available().map((c) => c.id);
    expect(visible).toEqual(["ai.connectClaude", "help.patchReference"]);
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

  it("opens the patch reference and the palette for shortcuts", () => {
    registry.run("help.patchReference");
    expect(learnNav.getState().view).toEqual({ kind: "patches" });
    expect(layoutStore.getState().drawer).toBe("learn");

    const palette = vi.fn();
    registry.register({ id: "app.commandPalette", title: "Palette", run: palette });
    registry.run("help.shortcuts");
    expect(palette).toHaveBeenCalledTimes(1);
  });
});
