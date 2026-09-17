import { describe, expect, it } from "vitest";
import { COMMAND_IDS, COMMANDS, listCommands, resolveAccelerator, type HostPlatform } from "./commands.ts";
import { buildMenuSpec, collectAccelerators, collectCommandIds, normalizeAccelerator, toMenuTemplate, type MenuNode } from "./menu.ts";

const PLATFORMS: HostPlatform[] = ["darwin", "win32", "linux"];

const spec = (platform: HostPlatform, recentProjects: string[] = []) => buildMenuSpec({ platform, appName: "Sonobe", recentProjects, dev: true });

function labels(nodes: readonly MenuNode[]): string[] {
  return nodes.flatMap((n) => {
    if (n.kind === "submenu") return [n.label, ...labels(n.items)];
    if (n.kind === "command") return [COMMANDS[n.id].label];
    return "label" in n && n.label ? [n.label] : [];
  });
}

/** System-wide shortcuts an app must not claim. */
const RESERVED: Record<HostPlatform, string[]> = {
  darwin: ["Cmd+Space", "Cmd+Tab", "Cmd+`", "Cmd+Alt+D", "Cmd+Ctrl+Q", "Cmd+Ctrl+Space", "Cmd+Shift+3", "Cmd+Shift+4", "Cmd+Shift+5", "Cmd+Alt+Escape", "Cmd+Shift+/", "Ctrl+Up", "Ctrl+Down", "Ctrl+Left", "Ctrl+Right"],
  win32: ["Alt+F4", "Ctrl+Escape", "Ctrl+Alt+Delete", "Ctrl+Shift+Escape", "Alt+Tab"],
  linux: ["Alt+F4", "Ctrl+Alt+Delete", "Alt+Tab", "Ctrl+Alt+T"],
};

describe("menu spec", () => {
  it.each(PLATFORMS)("has the standard top-level menus on %s", (platform) => {
    const top = spec(platform).map((n) => (n.kind === "submenu" ? n.label : n.kind));
    const expected = ["File", "Edit", "View", "Layer", "Patch", "Viewer", "Window", "Help"];
    expect(top).toEqual(platform === "darwin" ? ["Sonobe", ...expected] : expected);
  });

  it.each(PLATFORMS)("includes every requested item on %s", (platform) => {
    const all = labels(spec(platform));
    for (const label of [
      "New Prototype", "Open…", "Open Recent", "Save", "Save As…", "Close",
      "Undo", "Redo", "Duplicate", "Delete", "Select All",
      "Layers", "Inspector", "Toggle Split Orientation", "Zoom In", "Zoom Out", "Zoom to Fit",
      "Insert Layer…", "Group", "Ungroup", "Create Component",
      "Insert Patch…", "Tidy Up", "Comment Around Selection",
      "Restart Prototype", "Toggle Device Frame", "Show Hit Targets",
      "Learn Sonobe", "Connect Claude…", "Keyboard Shortcuts", "Report an Issue…",
    ]) {
      expect(all, label).toContain(label);
    }
    const roles = JSON.stringify(spec(platform));
    for (const role of ["cut", "copy", "paste", "quit", "minimize", "togglefullscreen"]) expect(roles).toContain(`"role":"${role}"`);
  });

  it("puts every command in the menus exactly once", () => {
    for (const platform of PLATFORMS) {
      const ids = collectCommandIds(spec(platform));
      expect(new Set(ids).size, platform).toBe(ids.length);
      expect([...ids].sort()).toEqual([...COMMAND_IDS].sort());
    }
  });

  it.each(PLATFORMS)("has no duplicate or reserved accelerators on %s", (platform) => {
    const entries = collectAccelerators(spec(platform), platform);
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const clash = seen.get(entry.normalized);
      expect(clash, `${entry.label} (${entry.accelerator}) collides with ${clash}`).toBeUndefined();
      seen.set(entry.normalized, entry.label);
    }
    const reserved = new Set(RESERVED[platform].map((a) => normalizeAccelerator(a, platform)));
    for (const entry of entries) expect(reserved.has(entry.normalized), `${entry.label} uses reserved ${entry.accelerator}`).toBe(false);
  });

  it("uses Origami's shortcuts where they exist", () => {
    const mac = (id: keyof typeof COMMANDS) => resolveAccelerator(COMMANDS[id].accelerator, "darwin");
    expect(mac("viewer.restart")).toBe("CmdOrCtrl+R");
    expect(mac("layer.insert")).toBe("CmdOrCtrl+Enter");
    expect(mac("patch.insert")).toBe("Alt+Enter");
    expect(mac("layer.group")).toBe("CmdOrCtrl+G");
    expect(mac("layer.createComponent")).toBe("Cmd+Ctrl+G");
    expect(mac("patch.tidyUp")).toBe("Ctrl+T");
    expect(mac("view.toggleInspector")).toBe("CmdOrCtrl+7");
    expect(mac("viewer.toggleDeviceFrame")).toBe("Alt+D");
  });

  it("never natively registers bare keys or text-editing keys", () => {
    for (const platform of PLATFORMS) {
      for (const info of listCommands(platform)) {
        if (!info.accelerator || !info.nativeAccelerator) continue;
        const parts = info.accelerator.split("+");
        const mods = parts.slice(0, -1);
        const hasPrimary = mods.some((m) => ["CmdOrCtrl", "Cmd", "Ctrl"].includes(m));
        expect(hasPrimary, `${info.id} registers ${info.accelerator} without Cmd/Ctrl`).toBe(true);
        expect(parts.at(-1), info.id).not.toMatch(/^(Up|Down|Left|Right)$/);
      }
    }
  });

  it("avoids Ctrl+Alt (AltGr) combos on Windows and Linux", () => {
    for (const platform of ["win32", "linux"] as const) {
      for (const entry of collectAccelerators(spec(platform), platform)) {
        if (!entry.registered) continue;
        if (entry.label === "Create Component") continue; // matches Figma/Origami muscle memory; documented exception
        expect(entry.normalized.includes("Ctrl+Alt"), `${entry.label}: ${entry.accelerator}`).toBe(false);
      }
    }
  });

  it("lists recent projects with a clear action, or a disabled placeholder", () => {
    const withRecent = JSON.stringify(spec("darwin", ["/Users/me/Work/Checkout Flow.sonobe"]));
    expect(withRecent).toContain("Checkout Flow  —  Work");
    expect(withRecent).toContain("clearRecent");
    expect(JSON.stringify(spec("darwin"))).toContain("No Recent Projects");
  });
});

describe("toMenuTemplate", () => {
  it("wires commands, recents, and actions to handlers", () => {
    const calls: string[] = [];
    const template = toMenuTemplate(spec("darwin", ["/tmp/A.sonobe"]), "darwin", {
      command: (id) => calls.push(`command:${id}`),
      openRecent: (p) => calls.push(`recent:${p}`),
      action: (a) => calls.push(`action:${a}`),
    });
    const find = (items: typeof template, predicate: (item: (typeof template)[number]) => boolean): (typeof template)[number] | undefined => {
      for (const item of items) {
        if (predicate(item)) return item;
        if (Array.isArray(item.submenu)) {
          const hit = find(item.submenu, predicate);
          if (hit) return hit;
        }
      }
      return undefined;
    };
    const click = (item: (typeof template)[number] | undefined) => (item?.click as (() => void) | undefined)?.();

    const restart = find(template, (i) => i.id === "viewer.restart");
    expect(restart).toMatchObject({ label: "Restart Prototype", accelerator: "CmdOrCtrl+R", registerAccelerator: true });
    click(restart);
    expect(find(template, (i) => i.id === "edit.delete")).toMatchObject({ accelerator: "Backspace", registerAccelerator: false });
    click(find(template, (i) => i.toolTip === "/tmp/A.sonobe"));
    click(find(template, (i) => i.label === "Clear Recent"));
    expect(calls).toEqual(["command:viewer.restart", "recent:/tmp/A.sonobe", "action:clearRecent"]);
  });

  it("uses platform labels", () => {
    expect(listCommands("darwin").find((c) => c.id === "file.reveal")?.label).toBe("Show in Finder");
    expect(listCommands("win32").find((c) => c.id === "file.reveal")?.label).toBe("Show in File Explorer");
  });
});

describe("normalizeAccelerator", () => {
  it("resolves CmdOrCtrl and orders modifiers", () => {
    expect(normalizeAccelerator("Shift+CmdOrCtrl+g", "darwin")).toBe("Cmd+Shift+G");
    expect(normalizeAccelerator("Shift+CmdOrCtrl+g", "win32")).toBe("Ctrl+Shift+G");
    expect(normalizeAccelerator("Option+Command+0", "darwin")).toBe("Cmd+Alt+0");
    expect(normalizeAccelerator("CmdOrCtrl+Return", "linux")).toBe("Ctrl+Enter");
  });
});
