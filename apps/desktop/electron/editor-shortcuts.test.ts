/**
 * Native menu accelerators against the shortcuts the editor registers. Document commands come from the
 * real registerDocumentCommands; commands registered inside React components (shell, panels, app
 * aliases) are listed below with their source, so a change on either side shows up here.
 */

import { createPatchRegistry } from "@sonobe/patches";
import { afterAll, describe, expect, it } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../../editor/src/host/browserHost.ts";
import { createManualScheduler } from "../../editor/src/runtime/scheduler.ts";
import { DESKTOP_COMMAND_MAP, registerDocumentCommands } from "../../editor/src/state/commands.ts";
import { createDemoDocument } from "../../editor/src/state/demoDocument.ts";
import { createEditorSession } from "../../editor/src/state/session.ts";
import { CommandRegistry } from "../../editor/src/ui/commands/commandRegistry.ts";
import type { Platform } from "../../editor/src/ui/commands/shortcutManager.ts";
import { COMMAND_IDS, COMMANDS, isNativeAccelerator, resolveAccelerator, type HostPlatform } from "./commands.ts";
import { normalizeAccelerator } from "./menu.ts";

type Shortcut = string | readonly string[];

/**
 * Editor commands a menu item reaches (after DESKTOP_COMMAND_MAP and app aliases) that are registered
 * inside React components, by desktop command id.
 */
const COMPONENT_SHORTCUTS: Partial<Record<string, Shortcut>> = {
  "view.commandPalette": ["Mod+K", "Mod+Shift+P"], // shell/useShellCommands.tsx app.commandPalette
  "view.toggleLayers": "Mod+1", // shell/useShellCommands.tsx
  "view.toggleViewer": "Mod+2",
  "view.toggleInspector": "Mod+7",
  "view.toggleConsole": "Mod+J", // view.toggleHud
  "help.learn": "Mod+/",
  "help.shortcuts": ["Mod+Alt+/", "Ctrl+Shift+/"], // app/useAppCommands.tsx (macOS first, then Windows and Linux)
  "patch.insert": "Alt+Enter", // app/useAppCommands.tsx alias → panels/patch-editor/PatchEditor.tsx patchEditor.insertPatch
  "patch.tidyUp": "Ctrl+T",
  "patch.commentAroundSelection": "Ctrl+Alt+C",
  "patch.alignLeft": "Mod+[",
  "patch.alignRight": "Mod+]", // app alias → patchEditor.alignRight
  "patch.alignTop": "Mod+Shift+[",
  "patch.alignBottom": "Mod+Shift+]",
  "view.zoomIn": ["Mod+=", "Mod++"], // app alias → patchEditor.zoomIn / canvas.zoomIn
  "view.zoomOut": "Mod+-",
  "view.zoomToFit": "Shift+1", // patchEditor.zoomToFit / canvas.zoomToFit
  "viewer.toggleDeviceFrame": "Alt+D", // panels/viewer/ViewerPanel.tsx
};

/** Editor shortcuts with no menu item: native accelerators must not take these keys. */
const EDITOR_ONLY_SHORTCUTS: Record<string, Shortcut> = {
  "view.showDiagnostics": "Mod+Shift+M",
  "view.canvasOnly": "Alt+1",
  "view.split": "Alt+2",
  "view.patchesOnly": "Alt+3",
  "patchEditor.zoomReset": "Mod+0",
  "patchEditor.patchInfo": "Mod+I",
  "patchEditor.publishPort": "Alt+P",
  "patchEditor.toggleMinimap": "Shift+M",
  "canvas.zoomToSelection": "Shift+2",
  "canvas.actualSize": "Shift+0",
};

/** Deliberate differences, each with its reason. Empty: every menu accelerator matches the editor. */
const KNOWN_DIFFERENCES: Record<string, string> = {};

const PLATFORMS: [HostPlatform, Platform][] = [
  ["darwin", "mac"],
  ["win32", "windows"],
  ["linux", "linux"],
];

const ARROWS: Record<string, string> = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };

/** "Mod+Shift+ArrowUp" → "CmdOrCtrl+Shift+Up". */
function toAccelerator(shortcut: string): string {
  return shortcut
    .split(/\+(?!$)/)
    .map((part) => (part === "Mod" ? "CmdOrCtrl" : (ARROWS[part] ?? part)))
    .join("+");
}

const list = (shortcut: Shortcut | undefined): string[] => (shortcut === undefined ? [] : typeof shortcut === "string" ? [shortcut] : [...shortcut]);

const sessions: { dispose(): void }[] = [];
afterAll(() => {
  for (const s of sessions.splice(0)) s.dispose();
});

const patchRegistry = createPatchRegistry();

/** Editor shortcuts by editor command id, from the real document commands. */
function documentShortcuts(platform: Platform): Map<string, string[]> {
  const host = createBrowserHost({ storage: createMemoryProjectStorage(), channelName: null, recentKey: null, fileSystemAccess: false });
  const session = createEditorSession({ host, registry: patchRegistry, document: createDemoDocument(patchRegistry), autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  sessions.push(session);
  const registry = new CommandRegistry();
  registerDocumentCommands(registry, session, { platform, notify: () => undefined, clipboard: null });
  const out = new Map<string, string[]>();
  for (const id of new Set([...COMMAND_IDS.map((c) => DESKTOP_COMMAND_MAP[c] ?? c), "prototype.togglePlay", "edit.copy", "edit.paste"])) {
    const command = registry.get(id);
    if (command?.shortcut) out.set(id, list(command.shortcut));
  }
  return out;
}

describe("menu accelerators and editor shortcuts", () => {
  it.each(PLATFORMS)("match on %s", (platform, editorPlatform) => {
    const fromDocument = documentShortcuts(editorPlatform);
    const mismatches: string[] = [];
    let compared = 0;
    for (const id of COMMAND_IDS) {
      if (KNOWN_DIFFERENCES[id]) continue;
      const accelerator = resolveAccelerator(COMMANDS[id].accelerator, platform);
      const editorId = DESKTOP_COMMAND_MAP[id] ?? id;
      const editor = [...(fromDocument.get(editorId) ?? []), ...list(COMPONENT_SHORTCUTS[id])];
      if (!accelerator || editor.length === 0) continue;
      compared++;
      const normalized = editor.map((s) => normalizeAccelerator(toAccelerator(s), platform));
      if (!normalized.includes(normalizeAccelerator(accelerator, platform))) mismatches.push(`${id}: menu ${accelerator}, editor ${editor.join(" or ")}`);
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(25);
  });

  it.each(PLATFORMS)("don't take keys the editor uses for other commands on %s", (platform, editorPlatform) => {
    const owners = new Map<string, string>();
    const claim = (owner: string, shortcut: Shortcut | undefined) => {
      for (const s of list(shortcut)) owners.set(normalizeAccelerator(toAccelerator(s), platform), owner);
    };
    for (const [id, shortcut] of documentShortcuts(editorPlatform)) claim(id, shortcut);
    for (const [id, shortcut] of Object.entries(COMPONENT_SHORTCUTS)) claim(DESKTOP_COMMAND_MAP[id] ?? id, shortcut);
    for (const [id, shortcut] of Object.entries(EDITOR_ONLY_SHORTCUTS)) claim(id, shortcut);

    const clashes: string[] = [];
    for (const id of COMMAND_IDS) {
      const accelerator = resolveAccelerator(COMMANDS[id].accelerator, platform);
      if (!accelerator || !isNativeAccelerator(COMMANDS[id], platform) || KNOWN_DIFFERENCES[id]) continue;
      const owner = owners.get(normalizeAccelerator(accelerator, platform));
      if (owner && owner !== (DESKTOP_COMMAND_MAP[id] ?? id)) clashes.push(`${id} (${accelerator}) is the editor's ${owner}`);
    }
    expect(clashes).toEqual([]);
  });
});
