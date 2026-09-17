/**
 * Document commands and shortcuts (undo, redo, files, clipboard, grouping, components, arrange,
 * prototype transport) registered in the editor's CommandRegistry; desktop menu command ids mapped
 * onto them; and DOM copy/cut/paste handling (Electron uses native menu roles for the clipboard).
 */

import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  FilePlus,
  FolderOpen,
  FolderSearch,
  Group,
  Lock,
  LogIn,
  LogOut,
  Play,
  Redo2,
  RotateCcw,
  Save,
  SaveAll,
  Scissors,
  Trash2,
  Undo2,
  Ungroup,
} from "lucide-react";
import { COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, findLayer } from "@sonobe/core";
import type { Command, CommandRegistry } from "../ui/commands/commandRegistry.ts";
import { isEditableTarget, type Platform } from "../ui/commands/shortcutManager.ts";
import { toast, type ToastOptions } from "../ui/Toast.tsx";
import { CLIPBOARD_MIME, parseClipboardFragment, serializeClipboardFragment, type ClipboardFragment } from "./clipboard.ts";
import type { FileResult } from "./document.ts";
import {
  arrangeLayers,
  copySelection,
  createComponentFromSelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  enterSelectedComponent,
  exitComponent,
  groupSelection,
  pasteFragment,
  selectAll,
  toggleLayerLock,
  toggleLayerVisibility,
  ungroupSelection,
  type ActionResult,
} from "./editActions.ts";
import { currentComponentId, hasSelection } from "./selection.ts";
import type { EditorSession } from "./session.ts";

export type Notify = (options: ToastOptions) => void;

export interface DocumentCommandOptions {
  platform?: Platform;
  /** Toasts for failures and file results. Default: the UI kit toast. */
  notify?: Notify;
  /** Register prototype.restart and prototype.togglePlay. Default true. */
  transport?: boolean;
  /** System clipboard access for palette copy/paste. Default navigator.clipboard. */
  clipboard?: { writeText(text: string): Promise<void>; readText(): Promise<string> } | null;
}

/** Desktop menu ids (apps/desktop/electron/commands.ts) whose editor command id differs. */
export const DESKTOP_COMMAND_MAP: Readonly<Record<string, string>> = {
  "viewer.restart": "prototype.restart",
  "view.commandPalette": "app.commandPalette",
  "view.toggleConsole": "view.toggleHud",
  "view.toggleAssistant": "ai.assistant",
  "help.connectClaude": "ai.connectClaude",
};

/** Commands that edit text instead when focus is in a text field. */
const TEXT_EDIT_COMMANDS: Readonly<Record<string, string>> = {
  "edit.undo": "undo",
  "edit.redo": "redo",
  "edit.selectAll": "selectAll",
  "edit.delete": "delete",
};

function reportAction(notify: Notify, result: ActionResult): void {
  if (result.ok || !result.message) return;
  notify({ title: result.message, ...(result.hint ? { description: result.hint } : {}), tone: "warn" });
}

function reportFile(notify: Notify, verb: string, result: FileResult): void {
  if (result.ok || result.cancelled) return;
  notify({ title: `Couldn't ${verb}`, description: result.error ?? "Something went wrong.", tone: "danger" });
}

const defaultClipboard = () => {
  const nav = globalThis.navigator as Navigator | undefined;
  return nav?.clipboard ? { writeText: (t: string) => nav.clipboard.writeText(t), readText: () => nav.clipboard.readText() } : null;
};

/** Register document commands. Ids that are already registered are skipped. Returns unregister. */
export function registerDocumentCommands(registry: CommandRegistry, session: EditorSession, options: DocumentCommandOptions = {}): () => void {
  const notify = options.notify ?? ((o: ToastOptions) => void toast(o));
  const platform = options.platform ?? "mac";
  const clipboard = options.clipboard === undefined ? defaultClipboard() : options.clipboard;
  const doc = () => session.document.getState();
  const sel = () => session.selection.getState();
  const selectedLayers = () => sel().layers.length > 0;

  const writeClipboard = async (fragment: ClipboardFragment) => {
    try {
      await clipboard?.writeText(serializeClipboardFragment(fragment));
    } catch {
      // Permission denied: the session clipboard still holds it.
    }
  };

  const commands: Command[] = [
    {
      id: "edit.undo",
      title: "Undo",
      category: "Edit",
      shortcut: "Mod+Z",
      icon: Undo2,
      keywords: ["back", "revert"],
      when: () => doc().canUndo,
      run: () => {
        const result = doc().undo();
        if (!result.ok && result.errors[0]) notify({ title: result.errors[0].message, tone: "warn" });
      },
    },
    {
      id: "edit.redo",
      title: "Redo",
      category: "Edit",
      shortcut: platform === "mac" ? "Mod+Shift+Z" : ["Mod+Shift+Z", "Ctrl+Y"],
      icon: Redo2,
      when: () => doc().canRedo,
      run: () => {
        const result = doc().redo();
        if (!result.ok && result.errors[0]) notify({ title: result.errors[0].message, tone: "warn" });
      },
    },
    { id: "file.new", title: "New Prototype", category: "File", shortcut: "Mod+N", allowInInput: true, icon: FilePlus, keywords: ["blank", "create"], run: async () => void (await session.newProject()) },
    { id: "file.open", title: "Open…", category: "File", shortcut: "Mod+O", allowInInput: true, icon: FolderOpen, keywords: ["project", "load"], when: () => session.host !== null, run: async () => reportFile(notify, "open the project", await session.openProject()) },
    {
      id: "file.save",
      title: "Save",
      category: "File",
      shortcut: "Mod+S",
      allowInInput: true,
      icon: Save,
      when: () => session.host !== null,
      run: async () => {
        const result = await doc().save();
        reportFile(notify, "save", result);
      },
    },
    { id: "file.saveAs", title: "Save As…", category: "File", shortcut: "Mod+Shift+S", allowInInput: true, icon: SaveAll, when: () => session.host !== null, run: async () => reportFile(notify, "save", await doc().saveAs()) },
    {
      id: "file.reveal",
      title: platform === "mac" ? "Show in Finder" : "Show in Folder",
      category: "File",
      icon: FolderSearch,
      when: () => !!session.host?.capabilities.reveal && doc().projectPath !== null,
      run: () => {
        const path = doc().projectPath;
        if (path) session.host?.revealInFinder(path);
      },
    },
    {
      id: "edit.copy",
      title: "Copy",
      category: "Edit",
      icon: Copy,
      when: () => hasSelection(sel()),
      run: async () => {
        const fragment = copySelection(session);
        if (fragment) await writeClipboard(fragment);
      },
    },
    {
      id: "edit.cut",
      title: "Cut",
      category: "Edit",
      icon: Scissors,
      when: () => hasSelection(sel()),
      run: async () => {
        const result = cutSelection(session);
        reportAction(notify, result);
        if (result.fragment) await writeClipboard(result.fragment);
      },
    },
    {
      id: "edit.paste",
      title: "Paste",
      category: "Edit",
      icon: ClipboardPaste,
      run: async () => {
        let fragment: ClipboardFragment | null = null;
        try {
          fragment = parseClipboardFragment(await clipboard?.readText());
        } catch {
          // Permission denied: fall back to the session clipboard.
        }
        fragment ??= session.clipboard;
        if (!fragment) {
          notify({ title: "There's nothing to paste.", description: "Copy layers or patches first.", tone: "neutral" });
          return;
        }
        reportAction(notify, pasteFragment(session, fragment));
      },
    },
    { id: "edit.delete", title: "Delete", category: "Edit", shortcut: ["Backspace", "Delete"], icon: Trash2, keywords: ["remove"], when: () => hasSelection(sel()), run: () => reportAction(notify, deleteSelection(session)) },
    { id: "edit.duplicate", title: "Duplicate", category: "Edit", shortcut: "Mod+D", icon: CopyPlus, keywords: ["copy"], when: () => sel().layers.length > 0 || sel().patches.length > 0, run: () => reportAction(notify, duplicateSelection(session)) },
    { id: "edit.selectAll", title: "Select All", category: "Edit", shortcut: "Mod+A", run: () => selectAll(session) },
    { id: "edit.deselectAll", title: "Deselect All", category: "Edit", shortcut: "Mod+Shift+A", when: () => hasSelection(sel()), run: () => sel().clear() },
    { id: "layer.group", title: "Group Layers", category: "Layer", shortcut: "Mod+G", icon: Group, when: selectedLayers, run: () => reportAction(notify, groupSelection(session)) },
    {
      id: "layer.ungroup",
      title: "Ungroup",
      category: "Layer",
      shortcut: "Mod+Shift+G",
      icon: Ungroup,
      when: () => {
        const component = doc().doc.components[currentComponentId(sel())];
        return !!component && sel().layers.some((id) => findLayer(component.layers, id)?.layer.type === "group");
      },
      run: () => reportAction(notify, ungroupSelection(session)),
    },
    {
      id: "layer.createComponent",
      title: "Create Component",
      category: "Layer",
      shortcut: platform === "mac" ? "Mod+Ctrl+G" : "Ctrl+Alt+G",
      keywords: ["reuse", "symbol", "extract"],
      when: () => sel().layers.length > 0 || sel().patches.length > 0,
      run: () => reportAction(notify, createComponentFromSelection(session)),
    },
    {
      id: "layer.enterComponent",
      title: "Enter Component",
      category: "Layer",
      shortcut: "Alt+Down",
      icon: LogIn,
      when: () => {
        const component = doc().doc.components[currentComponentId(sel())];
        const s = sel();
        if (!component) return false;
        const layer = s.layers.length === 1 ? findLayer(component.layers, s.layers[0]!)?.layer : undefined;
        const patch = s.patches.length === 1 ? component.patches[s.patches[0]!] : undefined;
        return layer?.type === COMPONENT_INSTANCE_LAYER_TYPE || patch?.type === COMPONENT_PATCH_TYPE;
      },
      run: () => void enterSelectedComponent(session),
    },
    { id: "layer.exitComponent", title: "Exit Component", category: "Layer", shortcut: "Alt+Up", icon: LogOut, when: () => sel().componentPath.length > 1, run: () => void exitComponent(session) },
    { id: "layer.toggleVisibility", title: "Hide or Show Layers", category: "Layer", shortcut: "Mod+Shift+H", icon: Eye, when: selectedLayers, run: () => reportAction(notify, toggleLayerVisibility(session)) },
    { id: "layer.toggleLock", title: "Lock or Unlock Layers", category: "Layer", shortcut: "Mod+Shift+L", icon: Lock, when: selectedLayers, run: () => reportAction(notify, toggleLayerLock(session)) },
    { id: "layer.bringForward", title: "Bring Forward", category: "Layer", shortcut: "Mod+Alt+Up", when: selectedLayers, run: () => reportAction(notify, arrangeLayers(session, "forward")) },
    { id: "layer.sendBackward", title: "Send Backward", category: "Layer", shortcut: "Mod+Alt+Down", when: selectedLayers, run: () => reportAction(notify, arrangeLayers(session, "backward")) },
    { id: "layer.bringToFront", title: "Bring to Front", category: "Layer", shortcut: "Mod+Alt+Shift+Up", when: selectedLayers, run: () => reportAction(notify, arrangeLayers(session, "front")) },
    { id: "layer.sendToBack", title: "Send to Back", category: "Layer", shortcut: "Mod+Alt+Shift+Down", when: selectedLayers, run: () => reportAction(notify, arrangeLayers(session, "back")) },
  ];
  if (options.transport !== false) {
    commands.push(
      { id: "prototype.restart", title: "Restart Prototype", category: "Prototype", shortcut: "Mod+R", icon: RotateCcw, keywords: ["reload", "reset"], run: () => session.runtime.restart() },
      { id: "prototype.togglePlay", title: "Play or Pause Prototype", category: "Prototype", shortcut: "Mod+Alt+P", icon: Play, keywords: ["stop", "freeze"], run: () => session.runtime.togglePlay() },
    );
  }
  return registry.register(commands.filter((c) => !registry.get(c.id)));
}

export interface HostCommandOptions {
  map?: Readonly<Record<string, string>>;
  /** Document whose focused text field receives text-edit commands. Default globalThis.document. */
  document?: Document;
}

/** Route desktop menu commands to registered commands (text fields keep native undo/select all). */
export function bindHostCommands(host: EditorSession["host"], registry: CommandRegistry, options: HostCommandOptions = {}): () => void {
  if (!host) return () => undefined;
  const map = options.map ?? DESKTOP_COMMAND_MAP;
  return host.onCommand((id) => {
    const dom = options.document ?? (typeof document === "undefined" ? undefined : document);
    const textCommand = TEXT_EDIT_COMMANDS[id];
    if (textCommand && dom && isEditableTarget(dom.activeElement)) {
      (dom as Document & { execCommand?: (command: string) => boolean }).execCommand?.(textCommand);
      return;
    }
    registry.run(map[id] ?? id);
  });
}

export interface ClipboardEventOptions {
  notify?: Notify;
}

function hasTextSelection(target: Document): boolean {
  const selection = target.defaultView?.getSelection?.();
  return !!selection && !selection.isCollapsed && selection.toString().length > 0;
}

/** Handle DOM copy, cut, and paste for layers and patches (skipped while editing or selecting text). */
export function attachClipboardEvents(target: Document, session: EditorSession, options: ClipboardEventOptions = {}): () => void {
  const notify = options.notify ?? ((o: ToastOptions) => void toast(o));
  const write = (event: ClipboardEvent, fragment: ClipboardFragment) => {
    const text = serializeClipboardFragment(fragment);
    event.clipboardData?.setData("text/plain", text);
    try {
      event.clipboardData?.setData(CLIPBOARD_MIME, text);
    } catch {
      // Custom types unsupported: text/plain still carries it.
    }
    event.preventDefault();
  };
  const skip = (event: ClipboardEvent) => event.defaultPrevented || isEditableTarget(event.target) || isEditableTarget(target.activeElement) || hasTextSelection(target);

  const onCopy = (event: Event) => {
    const e = event as ClipboardEvent;
    if (skip(e)) return;
    const fragment = copySelection(session);
    if (fragment) write(e, fragment);
  };
  const onCut = (event: Event) => {
    const e = event as ClipboardEvent;
    if (skip(e) || !hasSelection(session.selection.getState())) return;
    const result = cutSelection(session);
    if (result.fragment) write(e, result.fragment);
    reportAction(notify, result);
  };
  const onPaste = (event: Event) => {
    const e = event as ClipboardEvent;
    if (e.defaultPrevented || isEditableTarget(e.target) || isEditableTarget(target.activeElement)) return;
    const data = e.clipboardData;
    const fragment = parseClipboardFragment(data?.getData(CLIPBOARD_MIME) || data?.getData("text/plain") || "");
    if (!fragment) return;
    e.preventDefault();
    reportAction(notify, pasteFragment(session, fragment));
  };
  target.addEventListener("copy", onCopy);
  target.addEventListener("cut", onCut);
  target.addEventListener("paste", onPaste);
  return () => {
    target.removeEventListener("copy", onCopy);
    target.removeEventListener("cut", onCut);
    target.removeEventListener("paste", onPaste);
  };
}
