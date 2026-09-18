import type { MenuItemConstructorOptions } from "electron";
import type { SonobeCommandId } from "./host-api.d.ts";
import { COMMANDS, commandLabel, isNativeAccelerator, resolveAccelerator, type HostPlatform } from "./commands.ts";

type Role = NonNullable<MenuItemConstructorOptions["role"]>;

/** Main-process actions that don't involve the renderer. */
export type NativeAction = "clearRecent" | "interfaceLarger" | "interfaceSmaller" | "interfaceReset" | "maximize" | "stopPreview";

/** Platform-neutral menu description; converted to an Electron template by {@link toMenuTemplate}. */
export type MenuNode =
  | { kind: "command"; id: SonobeCommandId; /** Shown instead of the command's label ("Undo Mute Card Shadow"). */ label?: string }
  | { kind: "role"; role: Role; label?: string; accelerator?: string }
  | { kind: "action"; action: NativeAction; label: string; accelerator?: string }
  | { kind: "recent"; path: string; label: string }
  | { kind: "info"; label: string }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; role?: Role; items: MenuNode[] };

export interface MenuContext {
  platform: HostPlatform;
  appName: string;
  recentProjects: readonly string[];
  /** Adds developer-only items (Reload Editor). */
  dev: boolean;
  /** The phone preview server is running (adds Stop Phone Preview). */
  previewRunning?: boolean;
  /** The editor's Undo and Redo titles, saying what they'll revert ("Undo Mute Card Shadow"). Plain "Undo" and "Redo" without them. */
  undoLabel?: string;
  redoLabel?: string;
}

const sep: MenuNode = { kind: "separator" };
const cmd = (id: SonobeCommandId): MenuNode => ({ kind: "command", id });

function recentLabel(dir: string): string {
  const parts = dir.split(/[\\/]/).filter(Boolean);
  const name = parts.at(-1) ?? dir;
  const parent = parts.at(-2);
  return parent ? `${name.replace(/\.sonobe$/, "")}  —  ${parent}` : name.replace(/\.sonobe$/, "");
}

/** Build the full application menu for a platform. */
export function buildMenuSpec(ctx: MenuContext): MenuNode[] {
  const mac = ctx.platform === "darwin";

  const recentItems: MenuNode[] = ctx.recentProjects.length
    ? [...ctx.recentProjects.map((p): MenuNode => ({ kind: "recent", path: p, label: recentLabel(p) })), sep, { kind: "action", action: "clearRecent", label: "Clear Recent" }]
    : [{ kind: "info", label: "No Recent Projects" }];

  const appMenu: MenuNode = {
    kind: "submenu",
    label: ctx.appName,
    role: "appMenu",
    items: [
      { kind: "role", role: "about", label: `About ${ctx.appName}` },
      sep,
      cmd("app.settings"),
      sep,
      { kind: "role", role: "services" },
      sep,
      { kind: "role", role: "hide", label: `Hide ${ctx.appName}`, accelerator: "Cmd+H" },
      { kind: "role", role: "hideOthers", accelerator: "Cmd+Alt+H" },
      { kind: "role", role: "unhide" },
      sep,
      { kind: "role", role: "quit", label: `Quit ${ctx.appName}`, accelerator: "Cmd+Q" },
    ],
  };

  const file: MenuNode = {
    kind: "submenu",
    label: "File",
    items: [
      cmd("file.new"),
      cmd("file.open"),
      { kind: "submenu", label: "Open Recent", items: recentItems },
      sep,
      cmd("file.importDesign"),
      sep,
      cmd("file.close"),
      cmd("file.save"),
      cmd("file.saveAs"),
      sep,
      cmd("file.reveal"),
      ...(mac ? [] : [sep, cmd("app.settings"), sep, { kind: "role", role: "quit", label: "Exit", accelerator: "Ctrl+Q" } satisfies MenuNode]),
    ],
  };

  const edit: MenuNode = {
    kind: "submenu",
    label: "Edit",
    items: [
      ctx.undoLabel ? { kind: "command", id: "edit.undo", label: ctx.undoLabel } : cmd("edit.undo"),
      ctx.redoLabel ? { kind: "command", id: "edit.redo", label: ctx.redoLabel } : cmd("edit.redo"),
      sep,
      { kind: "role", role: "cut", accelerator: "CmdOrCtrl+X" },
      { kind: "role", role: "copy", accelerator: "CmdOrCtrl+C" },
      { kind: "role", role: "paste", accelerator: "CmdOrCtrl+V" },
      cmd("edit.duplicate"),
      cmd("edit.delete"),
      sep,
      cmd("edit.selectAll"),
      cmd("edit.deselectAll"),
      sep,
      cmd("edit.rename"),
    ],
  };

  const view: MenuNode = {
    kind: "submenu",
    label: "View",
    items: [
      cmd("view.commandPalette"),
      sep,
      cmd("view.toggleLayers"),
      cmd("view.toggleViewer"),
      cmd("view.toggleCanvas"),
      cmd("view.togglePatchEditor"),
      cmd("view.toggleInspector"),
      cmd("view.toggleConsole"),
      cmd("view.toggleAssistant"),
      sep,
      cmd("view.toggleSplitOrientation"),
      sep,
      cmd("view.zoomIn"),
      cmd("view.zoomOut"),
      cmd("view.zoomToFit"),
      sep,
      {
        kind: "submenu",
        label: "Interface Size",
        items: [
          { kind: "action", action: "interfaceLarger", label: "Larger" },
          { kind: "action", action: "interfaceSmaller", label: "Smaller" },
          { kind: "action", action: "interfaceReset", label: "Default Size" },
        ],
      },
      sep,
      { kind: "role", role: "togglefullscreen", accelerator: mac ? "Cmd+Ctrl+F" : "F11" },
      { kind: "role", role: "toggleDevTools", label: "Developer Tools", accelerator: mac ? "Cmd+Alt+I" : "Ctrl+Shift+I" },
      ...(ctx.dev ? [{ kind: "role", role: "forceReload", label: "Reload Editor", accelerator: "CmdOrCtrl+Shift+R" } satisfies MenuNode] : []),
    ],
  };

  const layer: MenuNode = {
    kind: "submenu",
    label: "Layer",
    items: [
      cmd("layer.insert"),
      sep,
      cmd("layer.group"),
      cmd("layer.ungroup"),
      sep,
      cmd("layer.createComponent"),
      cmd("layer.enterComponent"),
      cmd("layer.exitComponent"),
      sep,
      cmd("layer.toggleVisibility"),
      cmd("layer.toggleLock"),
      cmd("layer.useAsMask"),
      sep,
      { kind: "submenu", label: "Arrange", items: [cmd("layer.bringForward"), cmd("layer.sendBackward"), cmd("layer.bringToFront"), cmd("layer.sendToBack")] },
    ],
  };

  const patch: MenuNode = {
    kind: "submenu",
    label: "Patch",
    items: [
      cmd("patch.insert"),
      sep,
      cmd("patch.tidyUp"),
      cmd("patch.commentAroundSelection"),
      { kind: "submenu", label: "Align", items: [cmd("patch.alignLeft"), cmd("patch.alignRight"), cmd("patch.alignTop"), cmd("patch.alignBottom")] },
    ],
  };

  const viewer: MenuNode = {
    kind: "submenu",
    label: "Viewer",
    items: [
      cmd("viewer.restart"),
      sep,
      cmd("viewer.toggleDeviceFrame"),
      cmd("viewer.toggleHitTargets"),
      cmd("viewer.rotateDevice"),
      cmd("viewer.actualSize"),
      sep,
      cmd("viewer.fullscreen"),
      cmd("viewer.popOut"),
      cmd("viewer.previewOnDevice"),
      ...(ctx.previewRunning ? [{ kind: "action", action: "stopPreview", label: "Stop Phone Preview" } satisfies MenuNode] : []),
    ],
  };

  const windowMenu: MenuNode = mac
    ? {
        kind: "submenu",
        label: "Window",
        role: "windowMenu",
        items: [{ kind: "role", role: "minimize", accelerator: "Cmd+M" }, { kind: "role", role: "zoom" }, sep, { kind: "role", role: "front" }],
      }
    : {
        kind: "submenu",
        label: "Window",
        items: [{ kind: "role", role: "minimize" }, { kind: "action", action: "maximize", label: "Maximize" }],
      };

  const help: MenuNode = {
    kind: "submenu",
    label: "Help",
    role: "help",
    items: [
      cmd("help.learn"),
      cmd("help.shortcuts"),
      sep,
      cmd("help.connectClaude"),
      sep,
      cmd("help.reportIssue"),
      ...(mac ? [] : [sep, { kind: "role", role: "about", label: `About ${ctx.appName}` } satisfies MenuNode]),
    ],
  };

  return [...(mac ? [appMenu] : []), file, edit, view, layer, patch, viewer, windowMenu, help];
}

export interface MenuHandlers {
  command(id: SonobeCommandId): void;
  openRecent(path: string): void;
  action(action: NativeAction): void;
}

/** Convert a menu spec to an Electron template. Command items use the command id as MenuItem id. */
export function toMenuTemplate(nodes: readonly MenuNode[], platform: HostPlatform, handlers: MenuHandlers): MenuItemConstructorOptions[] {
  return nodes.map((node): MenuItemConstructorOptions => {
    switch (node.kind) {
      case "separator":
        return { type: "separator" };
      case "info":
        return { label: node.label, enabled: false };
      case "role":
        return { role: node.role, ...(node.label ? { label: node.label } : {}), ...(node.accelerator ? { accelerator: node.accelerator } : {}) };
      case "action":
        return { label: node.label, ...(node.accelerator ? { accelerator: node.accelerator } : {}), click: () => handlers.action(node.action) };
      case "recent":
        return { label: node.label, toolTip: node.path, click: () => handlers.openRecent(node.path) };
      case "submenu":
        return { label: node.label, ...(node.role ? { role: node.role } : {}), submenu: toMenuTemplate(node.items, platform, handlers) };
      case "command": {
        const spec = COMMANDS[node.id];
        const accelerator = resolveAccelerator(spec.accelerator, platform);
        return {
          id: node.id,
          label: node.label ?? commandLabel(node.id, platform),
          ...(accelerator ? { accelerator, registerAccelerator: isNativeAccelerator(spec, platform) } : {}),
          click: () => handlers.command(node.id),
        };
      }
    }
  });
}

export interface AcceleratorEntry {
  label: string;
  accelerator: string;
  /** Normalized for comparison (modifiers sorted, CmdOrCtrl resolved). */
  normalized: string;
  registered: boolean;
}

const MODIFIER_ALIASES: Record<string, string> = {
  cmd: "Cmd",
  command: "Cmd",
  super: "Cmd",
  meta: "Cmd",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  altgr: "AltGr",
  shift: "Shift",
};

/** Canonical form of an accelerator on a platform, e.g. "CmdOrCtrl+Shift+g" → "Cmd+Shift+G" on macOS. */
export function normalizeAccelerator(accelerator: string, platform: HostPlatform): string {
  const parts = accelerator.split(/\+(?!$)/);
  const key = parts.pop() ?? "";
  const mods = new Set<string>();
  for (const raw of parts) {
    const lower = raw.toLowerCase();
    if (lower === "cmdorctrl" || lower === "commandorcontrol") mods.add(platform === "darwin" ? "Cmd" : "Ctrl");
    else mods.add(MODIFIER_ALIASES[lower] ?? raw);
  }
  const order = ["Cmd", "Ctrl", "Alt", "AltGr", "Shift"];
  const sorted = [...mods].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const normalizedKey = key === "Return" ? "Enter" : key === "Plus" ? "=" : key.length === 1 ? key.toUpperCase() : key;
  const shifted = normalizedKey === "=" && key === "Plus" && !mods.has("Shift") ? [...sorted, "Shift"] : sorted;
  return [...shifted, normalizedKey].join("+");
}

/** Every accelerator in a menu spec (commands and roles), for conflict checks. */
export function collectAccelerators(nodes: readonly MenuNode[], platform: HostPlatform): AcceleratorEntry[] {
  const out: AcceleratorEntry[] = [];
  const visit = (list: readonly MenuNode[]) => {
    for (const node of list) {
      if (node.kind === "submenu") visit(node.items);
      else if (node.kind === "command") {
        const spec = COMMANDS[node.id];
        const accelerator = resolveAccelerator(spec.accelerator, platform);
        if (accelerator) out.push({ label: commandLabel(node.id, platform), accelerator, normalized: normalizeAccelerator(accelerator, platform), registered: isNativeAccelerator(spec, platform) });
      } else if ((node.kind === "role" || node.kind === "action") && node.accelerator) {
        out.push({ label: node.label ?? node.kind, accelerator: node.accelerator, normalized: normalizeAccelerator(node.accelerator, platform), registered: true });
      }
    }
  };
  visit(nodes);
  return out;
}

/** Command ids reachable from a menu spec. */
export function collectCommandIds(nodes: readonly MenuNode[]): SonobeCommandId[] {
  const out: SonobeCommandId[] = [];
  const visit = (list: readonly MenuNode[]) => {
    for (const node of list) {
      if (node.kind === "submenu") visit(node.items);
      else if (node.kind === "command") out.push(node.id);
    }
  };
  visit(nodes);
  return out;
}
