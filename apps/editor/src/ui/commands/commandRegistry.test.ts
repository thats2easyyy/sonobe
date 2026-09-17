// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, type Command } from "./commandRegistry.ts";
import { KeyboardShortcutManager } from "./shortcutManager.ts";

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({ id, title: id, run: vi.fn(), ...extra });

describe("CommandRegistry", () => {
  it("registers, lists in order, and rejects duplicates", () => {
    const registry = new CommandRegistry();
    registry.register([cmd("a"), cmd("b")]);
    registry.register(cmd("c"));
    expect(registry.all().map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(() => registry.register(cmd("b"))).toThrow(/already registered/);
    expect(registry.get("c")?.title).toBe("c");
  });

  it("unregisters through the returned function without touching replacements", () => {
    const registry = new CommandRegistry();
    const unregister = registry.register([cmd("a"), cmd("b")]);
    registry.unregister("a");
    registry.register(cmd("a", { title: "Replacement" }));
    unregister();
    expect(registry.all().map((c) => c.title)).toEqual(["Replacement"]);
  });

  it("filters by when() and hidden", () => {
    const registry = new CommandRegistry({ getContext: () => ({ hasSelection: false }) });
    registry.register([
      cmd("edit.delete", { when: (ctx) => ctx.hasSelection === true }),
      cmd("view.debug", { hidden: true }),
      cmd("app.palette"),
    ]);
    expect(registry.available().map((c) => c.id)).toEqual(["app.palette"]);
    expect(registry.available({ hasSelection: true }).map((c) => c.id)).toEqual(["edit.delete", "app.palette"]);
    expect(registry.isEnabled("edit.delete")).toBe(false);
    expect(registry.isEnabled("missing")).toBe(false);
  });

  it("runs commands with context and reports disabled or unknown ids", () => {
    const run = vi.fn();
    const registry = new CommandRegistry({ getContext: () => ({ panel: "canvas" }) });
    registry.register(cmd("go", { run, when: (ctx) => ctx.panel !== "viewer" }));
    expect(registry.run("go")).toBe(true);
    expect(run).toHaveBeenCalledWith({ panel: "canvas" });
    expect(registry.run("go", { panel: "viewer" })).toBe(false);
    expect(registry.run("nope")).toBe(false);
  });

  it("catches sync and async errors", async () => {
    const onError = vi.fn();
    const registry = new CommandRegistry({ onError });
    registry.register([
      cmd("sync", { run: () => { throw new Error("boom"); } }),
      cmd("async", { run: () => Promise.reject(new Error("later")) }),
    ]);
    expect(registry.run("sync")).toBe(false);
    expect(registry.run("async")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("tracks recent commands most-recent first with a cap", () => {
    const registry = new CommandRegistry({ maxRecent: 3 });
    registry.register(["a", "b", "c", "d"].map((id) => cmd(id)));
    for (const id of ["a", "b", "c", "a", "d"]) registry.run(id);
    expect(registry.recent()).toEqual(["d", "a", "c"]);
    registry.unregister("a");
    expect(registry.recent()).toEqual(["d", "c"]);
  });

  it("notifies subscribers and bumps the version", () => {
    const registry = new CommandRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const v0 = registry.getVersion();
    registry.register(cmd("a"));
    registry.run("a");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getVersion()).toBeGreaterThan(v0);
    unsubscribe();
    registry.unregister("a");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("binds shortcuts to a manager and keeps them in sync", () => {
    const manager = new KeyboardShortcutManager({ platform: "mac" });
    const registry = new CommandRegistry();
    const toggleInspector = vi.fn();
    registry.register(cmd("view.toggleInspector", { shortcut: "Mod+7", run: toggleInspector }));
    const detach = registry.bindShortcuts(manager);
    const restart = vi.fn();
    registry.register(cmd("prototype.restart", { shortcut: "Mod+R", run: restart, when: () => false }));

    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
      return manager.handleKeyDown(event);
    };
    expect(press({ key: "7", metaKey: true })).toBe(true);
    expect(toggleInspector).toHaveBeenCalledTimes(1);
    expect(press({ key: "r", metaKey: true })).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(registry.recent()).toEqual(["view.toggleInspector"]);

    registry.unregister("view.toggleInspector");
    expect(press({ key: "7", metaKey: true })).toBe(false);

    registry.register(cmd("view.toggleInspector", { shortcut: "Mod+7", run: toggleInspector }));
    detach();
    expect(press({ key: "7", metaKey: true })).toBe(false);
    expect(manager.bindings()).toHaveLength(0);
  });
});
