/**
 * App commands: Connect Claude, Learn shortcuts, and hidden aliases so every native menu item
 * reaches the panel that owns it (patch editor, canvas, layout).
 */

import { BookMarked } from "lucide-react";
import { connectClaudeCommand } from "../panels/connect/commands.ts";
import { connectClaudeStore } from "../panels/connect/connectStore.ts";
import { layoutStore } from "../shell/layoutStore.ts";
import type { EditorSession } from "../state/session.ts";
import { useCommands, useRegisterCommands } from "../ui/commands/CommandProvider.tsx";
import type { Command, CommandRegistry } from "../ui/commands/commandRegistry.ts";
import { learnNav } from "./learnStore.ts";

const nextFrame = (fn: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16));

/** Run a panel command, showing the patch editor first when it's hidden (its commands register on mount). */
export function runInPatchEditor(registry: CommandRegistry, id: string): void {
  const layout = layoutStore.getState();
  if (layout.viewMode === "canvas") {
    layout.setViewMode("split");
    nextFrame(() => registry.run(id));
    return;
  }
  registry.run(id);
}

/** The zoom command for the work surface the user is in (patch editor or canvas). */
export function zoomTarget(session: EditorSession, action: "zoomIn" | "zoomOut" | "zoomToFit"): string {
  const focused = session.selection.getState().focusedPanel;
  const mode = layoutStore.getState().viewMode;
  const patches = mode === "patches" || (mode === "split" && focused === "patchEditor");
  return patches ? `patchEditor.${action}` : `canvas.${action}`;
}

/** Commands defined by the app (not a panel), including menu aliases. */
export function appCommands(session: EditorSession, registry: CommandRegistry): Command[] {
  const layout = () => layoutStore.getState();
  const showConnect = () => connectClaudeStore.getState().show();
  const alias = (id: string, target: string): Command => ({ id, title: id, hidden: true, run: () => runInPatchEditor(registry, target) });
  return [
    connectClaudeCommand(showConnect),
    { id: "help.patchReference", title: "Browse Patch Reference", category: "Help", icon: BookMarked, keywords: ["docs", "patches", "library"], run: () => learnNav.getState().open({ kind: "patches" }) },
    // No in-app assistant yet: the menu's Assistant item opens Connect Claude.
    { id: "ai.assistant", title: "Assistant", hidden: true, run: showConnect },
    { id: "help.shortcuts", title: "Keyboard Shortcuts", hidden: true, run: () => void registry.run("app.commandPalette") },
    alias("patch.insert", "patchEditor.insertPatch"),
    alias("patch.tidyUp", "patchEditor.tidyUp"),
    alias("patch.alignLeft", "patchEditor.alignLeft"),
    alias("patch.alignTop", "patchEditor.alignTop"),
    alias("patch.commentAroundSelection", "patchEditor.commentSelection"),
    { id: "view.toggleCanvas", title: "Show or Hide Canvas", hidden: true, run: () => layout().setViewMode(layout().viewMode === "patches" ? "split" : "patches") },
    { id: "view.togglePatchEditor", title: "Show or Hide Patch Editor", hidden: true, run: () => layout().setViewMode(layout().viewMode === "canvas" ? "split" : "canvas") },
    { id: "view.toggleSplitOrientation", title: "Swap Split Direction", hidden: true, run: () => layout().toggleSplitDirection() },
    { id: "view.zoomIn", title: "Zoom In", hidden: true, run: () => void registry.run(zoomTarget(session, "zoomIn")) },
    { id: "view.zoomOut", title: "Zoom Out", hidden: true, run: () => void registry.run(zoomTarget(session, "zoomOut")) },
    { id: "view.zoomToFit", title: "Zoom to Fit", hidden: true, run: () => void registry.run(zoomTarget(session, "zoomToFit")) },
  ];
}

export function useAppCommands(session: EditorSession): void {
  const { registry } = useCommands();
  useRegisterCommands(() => appCommands(session, registry).filter((c) => !registry.get(c.id)), [session, registry]);
}
