// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostAdapter } from "../host/types.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { commandDisabledReason, CommandRegistry, commandTitle } from "../ui/commands/commandRegistry.ts";
import { attachClipboardEvents, bindHostCommands, registerDocumentCommands } from "./commands.ts";
import { getRegistry } from "./registry.ts";
import { createEditorSession, type EditorSession } from "./session.ts";

const registry = getRegistry();
let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
});

function build(ops: Op[]): SonobeDocument {
  const result = applyOps(createEmptyDocument(), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

function start(): EditorSession {
  session = createEditorSession({
    host: null,
    registry,
    document: build([
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
      { op: "addLayer", layer: { id: "g", type: "group", name: "G", children: [{ id: "inner", type: "rectangle", name: "Inner" }] } },
    ]),
    autoplay: false,
    scheduler: createManualScheduler(),
    textMeasurer: "approximate",
  });
  return session;
}

const layerIds = (s: EditorSession) => s.document.getState().doc.components.main!.layers.map((l) => l.id);

describe("document commands", () => {
  it("registers commands with shortcuts and runs undo and redo", () => {
    const s = start();
    const commands = new CommandRegistry();
    const off = registerDocumentCommands(commands, s, { notify: vi.fn(), clipboard: null, platform: "mac" });
    for (const id of ["edit.undo", "edit.redo", "file.save", "file.saveAs", "file.open", "file.new", "edit.delete", "edit.duplicate", "edit.copy", "edit.cut", "edit.paste", "layer.group", "layer.ungroup", "layer.createComponent", "edit.selectAll", "prototype.restart", "prototype.togglePlay"]) {
      expect(commands.get(id), id).toBeDefined();
    }
    expect(commands.get("edit.undo")!.shortcut).toBe("Mod+Z");
    expect(commands.get("layer.createComponent")!.shortcut).toBe("Mod+Ctrl+G");
    expect(commands.isEnabled("edit.undo")).toBe(false);

    s.selection.getState().select({ layers: ["card"] });
    expect(commands.run("edit.delete")).toBe(true);
    expect(layerIds(s)).toEqual(["g"]);
    expect(commands.run("edit.undo")).toBe(true);
    expect(layerIds(s)).toEqual(["card", "g"]);
    expect(commands.run("edit.redo")).toBe(true);
    expect(layerIds(s)).toEqual(["g"]);
    off();
    expect(commands.get("edit.undo")).toBeUndefined();
  });

  it("skips ids that are already registered", () => {
    const s = start();
    const commands = new CommandRegistry();
    const restart = vi.fn();
    commands.register({ id: "prototype.restart", title: "Mock Restart", run: restart });
    expect(() => registerDocumentCommands(commands, s, { notify: vi.fn(), clipboard: null })).not.toThrow();
    commands.run("prototype.restart");
    expect(restart).toHaveBeenCalled();
  });

  it("toasts when an action can't be done", () => {
    const s = start();
    const notify = vi.fn();
    const commands = new CommandRegistry();
    registerDocumentCommands(commands, s, { notify, clipboard: null });
    s.selection.getState().select({ layers: ["card", "inner"] });
    commands.run("layer.group");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/different groups/), tone: "warn" }));
  });

  it("routes desktop menu commands, keeping text fields' native editing", () => {
    const s = start();
    const commands = new CommandRegistry();
    registerDocumentCommands(commands, s, { notify: vi.fn(), clipboard: null });
    let send: (id: string) => void = () => undefined;
    const host = { onCommand: (cb: (id: string) => void) => ((send = cb), () => undefined) } as unknown as HostAdapter;
    bindHostCommands(host, commands, { document });
    const restart = vi.spyOn(s.runtime, "restart");
    send("viewer.restart");
    expect(restart).toHaveBeenCalled();

    s.selection.getState().select({ layers: ["card"] });
    send("edit.delete");
    expect(layerIds(s)).toEqual(["g"]);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const execCommand = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = execCommand;
    send("edit.undo");
    expect(execCommand).toHaveBeenCalledWith("undo");
    expect(layerIds(s)).toEqual(["g"]);
    input.remove();
  });

  it("handles DOM copy and paste events", () => {
    const s = start();
    const off = attachClipboardEvents(document, s, { notify: vi.fn() });
    const data = new Map<string, string>();
    const clipboardData = { setData: (type: string, value: string) => void data.set(type, value), getData: (type: string) => data.get(type) ?? "" };
    const fire = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      document.body.dispatchEvent(event);
      return event;
    };

    s.selection.getState().select({ layers: ["card"] });
    expect(fire("copy").defaultPrevented).toBe(true);
    expect(JSON.parse(data.get("text/plain")!)).toMatchObject({ type: "sonobe/clipboard", layers: [{ id: "card" }] });

    expect(fire("paste").defaultPrevented).toBe(true);
    expect(layerIds(s)).toEqual(["card", "card_2", "g"]);
    expect(s.selection.getState().layers).toEqual(["card_2"]);

    expect(fire("cut").defaultPrevented).toBe(true);
    expect(layerIds(s)).toEqual(["card", "g"]);

    data.set("text/plain", "just words");
    data.delete("application/x-sonobe-clipboard+json");
    expect(fire("paste").defaultPrevented).toBe(false);
    off();
  });
});

describe("undo and redo titles", () => {
  it("say what they'll change, and a step says what it did with the way back", () => {
    const s = start();
    const commands = new CommandRegistry();
    const notify = vi.fn();
    registerDocumentCommands(commands, s, { notify, clipboard: null, platform: "mac" });
    expect(commandTitle(commands.get("edit.undo")!)).toBe("Undo");
    expect(commandDisabledReason(commands.get("edit.undo")!)).toBe("Nothing to undo");
    s.document.getState().apply([{ op: "updateLayer", id: "card", props: { opacity: 0.5 } }], { label: "Change Card Opacity" });
    expect(commandTitle(commands.get("edit.undo")!)).toBe("Undo Change Card Opacity");
    expect(commands.run("edit.undo")).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: "history-step", title: "Undid Change Card Opacity", action: expect.objectContaining({ label: "Redo" }) }));
    expect(commandTitle(commands.get("edit.redo")!)).toBe("Redo Change Card Opacity");
    expect(commandTitle(commands.get("edit.undo")!)).toBe("Undo");
    expect(commands.run("edit.redo")).toBe(true);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Redid Change Card Opacity", action: expect.objectContaining({ label: "Undo" }) }));
  });
});

