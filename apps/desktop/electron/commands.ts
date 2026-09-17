import type { SonobeCommandId, SonobeCommandInfo } from "./host-api.d.ts";

export type HostPlatform = "darwin" | "win32" | "linux";

/** One accelerator for all platforms, or per platform (`other` covers win32 + linux). */
export type AcceleratorSpec = string | { mac?: string; win?: string; linux?: string; other?: string };

export interface CommandSpec {
  label: string;
  /** Per-platform label overrides. */
  labels?: Partial<Record<HostPlatform, string>>;
  accelerator?: AcceleratorSpec;
  /** Defaults to true. False = shown in the menu but left to the editor keymap. */
  nativeAccelerator?: boolean;
}

/** Placeholder until the public repository URL is final. */
export const ISSUES_URL = "https://github.com/sonobe-app/sonobe/issues/new";

/**
 * Every command the native menus can send. Shortcuts follow Origami Studio where they exist
 * (docs/research/ui-controls.md §26) and platform conventions otherwise. Ctrl+Alt combos are
 * avoided on Windows/Linux because they collide with AltGr characters.
 */
export const COMMANDS: Readonly<Record<SonobeCommandId, CommandSpec>> = {
  "file.new": { label: "New Prototype", accelerator: "CmdOrCtrl+N" },
  "file.open": { label: "Open…", accelerator: "CmdOrCtrl+O" },
  "file.save": { label: "Save", accelerator: "CmdOrCtrl+S" },
  "file.saveAs": { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S" },
  "file.reveal": { label: "Show in Folder", labels: { darwin: "Show in Finder", win32: "Show in File Explorer", linux: "Show in File Manager" } },
  "file.close": { label: "Close", accelerator: "CmdOrCtrl+W" },
  "app.settings": { label: "Settings…", accelerator: "CmdOrCtrl+," },

  "edit.undo": { label: "Undo", accelerator: "CmdOrCtrl+Z" },
  "edit.redo": { label: "Redo", accelerator: { mac: "Cmd+Shift+Z", win: "Ctrl+Y", linux: "Ctrl+Shift+Z" } },
  "edit.duplicate": { label: "Duplicate", accelerator: "CmdOrCtrl+D" },
  "edit.delete": { label: "Delete", accelerator: { mac: "Backspace", other: "Delete" }, nativeAccelerator: false },
  "edit.selectAll": { label: "Select All", accelerator: "CmdOrCtrl+A" },
  "edit.deselectAll": { label: "Deselect All", accelerator: "CmdOrCtrl+Shift+A" },
  "edit.rename": { label: "Rename", accelerator: "Shift+Enter", nativeAccelerator: false },

  "view.commandPalette": { label: "Command Palette…", accelerator: "CmdOrCtrl+K" },
  "view.toggleLayers": { label: "Layers", accelerator: "CmdOrCtrl+1" },
  "view.toggleViewer": { label: "Viewer", accelerator: "CmdOrCtrl+2" },
  "view.toggleCanvas": { label: "Canvas", accelerator: "CmdOrCtrl+3" },
  "view.togglePatchEditor": { label: "Patch Editor", accelerator: "CmdOrCtrl+4" },
  "view.toggleConsole": { label: "Console & Diagnostics", accelerator: "CmdOrCtrl+5" },
  "view.toggleAssistant": { label: "Assistant", accelerator: "CmdOrCtrl+6" },
  "view.toggleInspector": { label: "Inspector", accelerator: "CmdOrCtrl+7" },
  "view.toggleSplitOrientation": { label: "Toggle Split Orientation", accelerator: "CmdOrCtrl+\\" },
  "view.zoomIn": { label: "Zoom In", accelerator: "CmdOrCtrl+=" },
  "view.zoomOut": { label: "Zoom Out", accelerator: "CmdOrCtrl+-" },
  "view.zoomToFit": { label: "Zoom to Fit", accelerator: "CmdOrCtrl+0" },

  "layer.insert": { label: "Insert Layer…", accelerator: "CmdOrCtrl+Enter" },
  "layer.group": { label: "Group", accelerator: "CmdOrCtrl+G" },
  "layer.ungroup": { label: "Ungroup", accelerator: "CmdOrCtrl+Shift+G" },
  "layer.createComponent": { label: "Create Component", accelerator: { mac: "Cmd+Ctrl+G", other: "Ctrl+Alt+G" } },
  "layer.enterComponent": { label: "Enter Component", accelerator: "Alt+Down", nativeAccelerator: false },
  "layer.exitComponent": { label: "Exit Component", accelerator: "Alt+Up", nativeAccelerator: false },
  "layer.toggleVisibility": { label: "Hide/Show", accelerator: "CmdOrCtrl+Shift+H" },
  "layer.toggleLock": { label: "Lock/Unlock", accelerator: "CmdOrCtrl+Shift+L" },
  "layer.useAsMask": { label: "Use as Mask", accelerator: { mac: "Cmd+Alt+M", other: "Ctrl+Shift+M" } },
  "layer.bringForward": { label: "Bring Forward", accelerator: "CmdOrCtrl+Alt+Up", nativeAccelerator: false },
  "layer.sendBackward": { label: "Send Backward", accelerator: "CmdOrCtrl+Alt+Down", nativeAccelerator: false },
  "layer.bringToFront": { label: "Bring to Front", accelerator: "CmdOrCtrl+Alt+Shift+Up", nativeAccelerator: false },
  "layer.sendToBack": { label: "Send to Back", accelerator: "CmdOrCtrl+Alt+Shift+Down", nativeAccelerator: false },

  "patch.insert": { label: "Insert Patch…", accelerator: "Alt+Enter", nativeAccelerator: false },
  "patch.tidyUp": { label: "Tidy Up", accelerator: { mac: "Ctrl+T", other: "Ctrl+Shift+T" } },
  "patch.commentAroundSelection": { label: "Comment Around Selection", accelerator: { mac: "Ctrl+Alt+C", other: "Ctrl+Shift+C" } },
  "patch.alignLeft": { label: "Align Left", accelerator: "CmdOrCtrl+[" },
  "patch.alignRight": { label: "Align Right", accelerator: "CmdOrCtrl+]" },
  "patch.alignTop": { label: "Align Top", accelerator: "CmdOrCtrl+Shift+[" },
  "patch.alignBottom": { label: "Align Bottom", accelerator: "CmdOrCtrl+Shift+]" },

  "viewer.restart": { label: "Restart Prototype", accelerator: "CmdOrCtrl+R" },
  "viewer.toggleDeviceFrame": { label: "Toggle Device Frame", accelerator: "Alt+D", nativeAccelerator: false },
  "viewer.toggleHitTargets": { label: "Show Hit Targets" },
  "viewer.actualSize": { label: "Actual Size", accelerator: { mac: "Cmd+Alt+0" } },
  "viewer.rotateDevice": { label: "Rotate Device", accelerator: "CmdOrCtrl+Alt+Right", nativeAccelerator: false },
  "viewer.fullscreen": { label: "Fullscreen Viewer", accelerator: "CmdOrCtrl+Shift+F" },
  "viewer.popOut": { label: "Pop Out Viewer" },
  "viewer.previewOnDevice": { label: "Preview on Phone…" },

  "help.learn": { label: "Learn Sonobe", accelerator: "CmdOrCtrl+/" },
  "help.connectClaude": { label: "Connect Claude…" },
  "help.shortcuts": { label: "Keyboard Shortcuts", accelerator: { mac: "Cmd+Alt+/", other: "Ctrl+Shift+/" } },
  "help.reportIssue": { label: "Report an Issue…" },
};

export const COMMAND_IDS = Object.keys(COMMANDS) as SonobeCommandId[];

export function isCommandId(value: unknown): value is SonobeCommandId {
  return typeof value === "string" && Object.hasOwn(COMMANDS, value);
}

/** Resolve an accelerator spec for one platform. */
export function resolveAccelerator(spec: AcceleratorSpec | undefined, platform: HostPlatform): string | null {
  if (spec === undefined) return null;
  if (typeof spec === "string") return spec;
  if (platform === "darwin") return spec.mac ?? null;
  return (platform === "win32" ? spec.win : spec.linux) ?? spec.other ?? null;
}

export function commandLabel(id: SonobeCommandId, platform: HostPlatform): string {
  const spec = COMMANDS[id];
  return spec.labels?.[platform] ?? spec.label;
}

/** Command metadata for the command palette and editor keymap. */
export function listCommands(platform: HostPlatform): SonobeCommandInfo[] {
  return COMMAND_IDS.map((id) => ({
    id,
    label: commandLabel(id, platform),
    accelerator: resolveAccelerator(COMMANDS[id].accelerator, platform),
    nativeAccelerator: COMMANDS[id].nativeAccelerator !== false,
  }));
}

export function toHostPlatform(platform: string): HostPlatform {
  return platform === "darwin" || platform === "win32" ? platform : "linux";
}
