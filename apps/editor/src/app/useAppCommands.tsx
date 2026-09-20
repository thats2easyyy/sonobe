/**
 * App commands: New (the welcome screen), Import Design, Close, Settings, Rename, Insert Layer, Use as Mask, Align
 * Right and Bottom, full-screen viewer, the knob commands, Connect Claude, lessons, About, and Report
 * an Issue; plus hidden aliases so every native menu item reaches the panel that owns it.
 */

import { AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, BookMarked, Bug, FilePlus, FileX, GraduationCap, Info, Keyboard, LayoutTemplate, Maximize, MessageSquarePlus, Pencil, ScanLine, Scissors, Settings, SquarePlus, Workflow } from "lucide-react";
import { connectClaudeCommand } from "../panels/connect/commands.ts";
import { connectClaudeStore } from "../panels/connect/connectStore.ts";
import { knobCommands } from "../panels/knobs/commands.ts";
import { layoutStore } from "../shell/layoutStore.ts";
import type { EditorSession } from "../state/session.ts";
import { useCommands, useRegisterCommands } from "../ui/commands/CommandProvider.tsx";
import type { Command, CommandRegistry } from "../ui/commands/commandRegistry.ts";
import type { Platform } from "../ui/commands/shortcutManager.ts";
import { closePrototype, insertLayer, renameSelection, reportIssue, toggleViewerFullscreen, useAsMask } from "./appActions.ts";
import { appPanels } from "./appPanels.ts";
import { learnNav } from "./learnStore.ts";
import { dialogsFor } from "./sessionServices.ts";
import { welcomeStore } from "./welcome/welcomeStore.ts";

const nextFrame = (fn: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16));

/** Run `id` once it's registered (panels load lazily and register on mount), giving up after `timeoutMs`. */
export function runWhenRegistered(registry: CommandRegistry, id: string, timeoutMs = 8000): void {
  nextFrame(() => {
    if (registry.get(id)) {
      registry.run(id);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = registry.subscribe(() => {
      if (!registry.get(id)) return;
      off();
      clearTimeout(timer);
      nextFrame(() => registry.run(id));
    });
    timer = setTimeout(off, timeoutMs);
  });
}

/** Run a panel command, showing the patch editor first when it's hidden (its commands register on mount). */
export function runInPatchEditor(registry: CommandRegistry, id: string): void {
  const layout = layoutStore.getState();
  if (layout.viewMode === "canvas") {
    layout.setViewMode("split");
    runWhenRegistered(registry, id);
    return;
  }
  if (registry.get(id)) registry.run(id);
  else runWhenRegistered(registry, id);
}

/** The zoom command for the work surface the user is in (patch editor or canvas). */
export function zoomTarget(session: EditorSession, action: "zoomIn" | "zoomOut" | "zoomToFit"): string {
  const focused = session.selection.getState().focusedPanel;
  const mode = layoutStore.getState().viewMode;
  const patches = mode === "patches" || (mode === "split" && focused === "patchEditor");
  return patches ? `patchEditor.${action}` : `canvas.${action}`;
}

export interface AppCommandOptions {
  platform?: Platform;
}

/** Commands defined by the app (not a panel), including menu aliases. */
export function appCommands(session: EditorSession, registry: CommandRegistry, options: AppCommandOptions = {}): Command[] {
  const platform = options.platform ?? "mac";
  const layout = () => layoutStore.getState();
  const sel = () => session.selection.getState();
  const showConnect = () => connectClaudeStore.getState().show();
  const alias = (id: string, target: string): Command => ({ id, title: id, hidden: true, run: () => runInPatchEditor(registry, target) });
  /**
   * A menu item's alias for a patch editor command. The palette lists it while the patch editor isn't
   * mounted (canvas only), and the patch editor's own command, with its shortcut, once it is.
   */
  const editorAlias = (id: string, target: string, shown: Pick<Command, "title" | "icon" | "keywords" | "when" | "disabledReason">): Command => ({
    id,
    category: "Patches",
    ...shown,
    hidden: () => registry.get(target) !== undefined,
    run: () => runInPatchEditor(registry, target),
  });
  const alignReason = "Select 2 or more patches";
  const singleItem = () => (sel().patches.length === 1 && sel().layers.length === 0) || (sel().layers.length === 1 && sel().patches.length === 0);
  const multiplePatches = () => sel().patches.length > 1;
  return [
    // File
    { id: "file.new", title: "New Prototype…", category: "File", description: "Blank, from a template, or a lesson", shortcut: "Mod+N", allowInInput: true, icon: FilePlus, keywords: ["blank", "create", "template", "welcome", "start"], run: () => welcomeStore.getState().show("new") },
    { id: "file.importDesign", title: "Import Design…", category: "File", description: "Screens from your running app, HTML, or Claude", icon: ScanLine, keywords: ["import", "html", "url", "code", "website", "web page", "screen", "capture", "localhost", "storybook", "paste"], run: () => appPanels.getState().show("importDesign") },
    { id: "file.close", title: "Close Prototype", category: "File", icon: FileX, keywords: ["close", "shut"], run: async () => void (await closePrototype(session)) },
    { id: "app.settings", title: "Settings…", category: "File", shortcut: "Mod+,", allowInInput: true, icon: Settings, keywords: ["preferences", "theme", "motion", "device", "permissions", "trust"], run: () => appPanels.getState().show("settings") },
    // Edit
    { id: "edit.rename", title: "Rename…", category: "Edit", shortcut: "Shift+Enter", icon: Pencil, keywords: ["name", "title"], when: singleItem, run: async () => void (await renameSelection(session, registry, dialogsFor(session))) },
    // Layer
    { id: "layer.insert", title: "Insert Layer…", category: "Layer", shortcut: "Mod+Enter", icon: SquarePlus, keywords: ["add", "new layer", "shape", "text", "image"], run: async () => void (await insertLayer(session, dialogsFor(session))) },
    {
      id: "layer.useAsMask",
      title: "Use as Mask: Clip Parent Group",
      category: "Layer",
      description: "Turns on Clip Contents for the selected layer's group, hiding anything outside its bounds",
      ...(platform === "mac" ? { shortcut: "Mod+Alt+M" } : {}),
      icon: Scissors,
      keywords: ["mask", "clip contents", "crop", "overflow"],
      when: () => sel().layers.length > 0,
      run: () => void useAsMask(session),
    },
    // Patch: menu aliases for the patch editor's own commands, which the palette lists once (under Patches).
    editorAlias("patch.insert", "patchEditor.insertPatch", { title: "Insert Patch…", icon: SquarePlus, keywords: ["add", "node", "library", "patch picker"] }),
    editorAlias("patch.tidyUp", "patchEditor.tidyUp", { title: "Tidy Up Patches", icon: Workflow, keywords: ["layout", "arrange", "clean"] }),
    editorAlias("patch.alignLeft", "patchEditor.alignLeft", { title: "Align Left Edges", icon: AlignStartVertical, keywords: ["arrange", "column"], when: multiplePatches, disabledReason: alignReason }),
    editorAlias("patch.alignRight", "patchEditor.alignRight", { title: "Align Right Edges", icon: AlignEndVertical, keywords: ["arrange", "column"], when: multiplePatches, disabledReason: alignReason }),
    editorAlias("patch.alignTop", "patchEditor.alignTop", { title: "Align Top Edges", icon: AlignStartHorizontal, keywords: ["arrange", "row"], when: multiplePatches, disabledReason: alignReason }),
    editorAlias("patch.alignBottom", "patchEditor.alignBottom", { title: "Align Bottom Edges", icon: AlignEndHorizontal, keywords: ["arrange", "row"], when: multiplePatches, disabledReason: alignReason }),
    editorAlias("patch.commentAroundSelection", "patchEditor.commentSelection", { title: "Comment Selected Patches", icon: MessageSquarePlus, keywords: ["note", "frame", "group"] }),
    // Prototype
    { id: "viewer.fullscreen", title: "Full Screen Viewer", category: "Prototype", shortcut: "Mod+Shift+F", icon: Maximize, keywords: ["present", "presentation", "demo", "fullscreen"], run: () => toggleViewerFullscreen() },
    // Knobs: Show Knobs (Mod+5), Flip Presets (Mod+'), New Knob…, New Preset, Copy Knob Differences, Convert Variables to Knobs…
    ...knobCommands(session),
    // Help
    connectClaudeCommand(showConnect),
    { id: "help.lessons", title: "Lessons", category: "Help", icon: GraduationCap, keywords: ["tutorial", "learn", "course", "beginner", "onboarding"], run: () => learnNav.getState().open({ kind: "lessons" }) },
    { id: "help.patchReference", title: "Browse Patch Reference", category: "Help", icon: BookMarked, keywords: ["docs", "patches", "library"], run: () => learnNav.getState().open({ kind: "patches" }) },
    { id: "help.welcome", title: "Welcome Screen", category: "Help", icon: LayoutTemplate, keywords: ["start", "templates", "recent"], run: () => welcomeStore.getState().show("menu") },
    { id: "help.reportIssue", title: "Report an Issue…", category: "Help", icon: Bug, keywords: ["bug", "feedback", "github"], run: () => void reportIssue(session) },
    { id: "help.about", title: "About Sonobe", category: "Help", icon: Info, keywords: ["version", "credits", "licenses", "open source"], run: () => appPanels.getState().show("about") },
    // Fallback when the Assistant panel isn't registered (EditorApp registers the real one first): the menu's Assistant item opens Connect Claude.
    { id: "ai.assistant", title: "Assistant", hidden: true, run: showConnect },
    {
      id: "help.shortcuts",
      title: "Keyboard Shortcuts",
      category: "Help",
      shortcut: platform === "mac" ? "Mod+Alt+/" : "Ctrl+Shift+/",
      icon: Keyboard,
      keywords: ["cheat sheet", "keys", "hotkeys", "gestures", "reference"],
      run: () => appPanels.getState().show("shortcuts"),
    },
    // View aliases
    { id: "view.toggleCanvas", title: "Show or Hide Canvas", hidden: true, run: () => layout().setViewMode(layout().viewMode === "patches" ? "split" : "patches") },
    { id: "view.togglePatchEditor", title: "Show or Hide Patch Editor", hidden: true, run: () => layout().setViewMode(layout().viewMode === "canvas" ? "split" : "canvas") },
    { id: "view.toggleSplitOrientation", title: "Swap Split Direction", hidden: true, run: () => layout().toggleSplitDirection() },
    { id: "view.zoomIn", title: "Zoom In", hidden: true, run: () => void registry.run(zoomTarget(session, "zoomIn")) },
    { id: "view.zoomOut", title: "Zoom Out", hidden: true, run: () => void registry.run(zoomTarget(session, "zoomOut")) },
    { id: "view.zoomToFit", title: "Zoom to Fit", hidden: true, run: () => void registry.run(zoomTarget(session, "zoomToFit")) },
  ];
}

export function useAppCommands(session: EditorSession): void {
  const { registry, platform } = useCommands();
  useRegisterCommands(() => appCommands(session, registry, { platform }).filter((c) => !registry.get(c.id)), [session, registry, platform]);
}
