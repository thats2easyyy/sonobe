/**
 * The command registry: one canonical list of everything the editor can do. Menus, the command
 * palette, keyboard shortcuts, and docs all read from it, so a shortcut is declared exactly once.
 */

import type { ComponentType } from "react";
import type { KeyboardShortcutManager, ShortcutScope } from "./shortcutManager.ts";

/** Open-ended context passed to `when` and `run` (selection, focused panel, document...). */
export type CommandContext = Record<string, unknown>;

export interface Command {
  /** Stable dotted id, e.g. "view.toggleInspector". */
  id: string;
  title: string;
  category?: string;
  description?: string;
  /** Extra search terms for the palette. */
  keywords?: readonly string[];
  shortcut?: string | readonly string[];
  scope?: ShortcutScope;
  allowInInput?: boolean;
  allowRepeat?: boolean;
  icon?: ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  /** Hidden from the palette; still runnable and bound. A function is asked each time the palette lists commands. */
  hidden?: boolean | (() => boolean);
  when?: (ctx: CommandContext) => boolean;
  /** Why the command can't run right now ("Select 2 or more patches"), for its greyed-out palette row. */
  disabledReason?: string | ((ctx: CommandContext) => string);
  /** The title right now, when it depends on state ("Undo Mute Card Shadow"). Searches still match `title`. */
  label?: (ctx: CommandContext) => string | undefined;
  run: (ctx: CommandContext) => void | Promise<void>;
}

/** Whether the palette leaves a command out. */
export const isCommandHidden = (command: Pick<Command, "hidden">): boolean => (typeof command.hidden === "function" ? command.hidden() : command.hidden === true);

/** The title to show for a command now (its `label`, else `title`). */
export function commandTitle(command: Pick<Command, "title" | "label">, ctx: CommandContext = {}): string {
  return command.label?.(ctx) || command.title;
}

/** Why a disabled command can't run, for people reading the palette. */
export function commandDisabledReason(command: Pick<Command, "disabledReason">, ctx: CommandContext = {}): string {
  const reason = typeof command.disabledReason === "function" ? command.disabledReason(ctx) : command.disabledReason;
  return reason || "Not available right now";
}

export interface CommandRegistryOptions {
  /** Supplies context for runs that don't pass one (shortcuts, palette). */
  getContext?: () => CommandContext;
  onError?: (error: unknown, command: Command) => void;
  /** Most-recent list length. Default 8. */
  maxRecent?: number;
}

export class CommandRegistry {
  #commands = new Map<string, Command>();
  #listeners = new Set<() => void>();
  #recent: string[] = [];
  #version = 0;
  #getContext: () => CommandContext;
  #onError: (error: unknown, command: Command) => void;
  #maxRecent: number;
  #managers = new Map<KeyboardShortcutManager, Map<string, () => void>>();

  constructor(options: CommandRegistryOptions = {}) {
    this.#getContext = options.getContext ?? (() => ({}));
    this.#onError = options.onError ?? ((error, command) => console.error(`Command "${command.id}" failed`, error));
    this.#maxRecent = options.maxRecent ?? 8;
  }

  /** Register one or more commands. Throws on duplicate ids. Returns an unregister function. */
  register(command: Command | readonly Command[]): () => void {
    const list: readonly Command[] = "run" in command ? [command] : command;
    for (const c of list) {
      if (this.#commands.has(c.id)) throw new Error(`Command "${c.id}" is already registered`);
    }
    for (const c of list) {
      this.#commands.set(c.id, c);
      for (const [manager, unbinds] of this.#managers) this.#bindCommand(manager, unbinds, c);
    }
    this.#emit();
    return () => {
      const ids = list.filter((c) => this.#commands.get(c.id) === c).map((c) => c.id);
      if (ids.length > 0) this.unregister(ids);
    };
  }

  unregister(id: string | readonly string[]): void {
    const ids: readonly string[] = typeof id === "string" ? [id] : id;
    let changed = false;
    for (const commandId of ids) {
      if (!this.#commands.delete(commandId)) continue;
      changed = true;
      for (const unbinds of this.#managers.values()) {
        unbinds.get(commandId)?.();
        unbinds.delete(commandId);
      }
    }
    if (changed) this.#emit();
  }

  get(id: string): Command | undefined {
    return this.#commands.get(id);
  }

  /** Every command in registration order. */
  all(): Command[] {
    return [...this.#commands.values()];
  }

  isEnabled(id: string, ctx?: CommandContext): boolean {
    const command = this.#commands.get(id);
    if (!command) return false;
    return !command.when || command.when(ctx ?? this.#getContext());
  }

  /** Commands that are visible in the palette and enabled for the context. */
  available(ctx?: CommandContext): Command[] {
    const context = ctx ?? this.#getContext();
    return this.all().filter((c) => !isCommandHidden(c) && (!c.when || c.when(context)));
  }

  /** Commands the palette lists (not hidden), enabled or not, in registration order. */
  listed(): Command[] {
    return this.all().filter((c) => !isCommandHidden(c));
  }

  /** Run a command. Returns false when it is unknown, disabled, or throws synchronously. */
  run(id: string, ctx?: CommandContext): boolean {
    const command = this.#commands.get(id);
    if (!command) return false;
    const context = ctx ?? this.#getContext();
    if (command.when && !command.when(context)) return false;
    this.#touchRecent(id);
    try {
      const result = command.run(context);
      if (result && typeof result.then === "function") result.catch((error: unknown) => this.#onError(error, command));
      return true;
    } catch (error) {
      this.#onError(error, command);
      return false;
    }
  }

  /** Recently run command ids, most recent first (only ids still registered). */
  recent(): string[] {
    return this.#recent.filter((id) => this.#commands.has(id));
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Increments on every change; use as a `useSyncExternalStore` snapshot. */
  getVersion(): number {
    return this.#version;
  }

  /** Bind every command's shortcut on a manager (kept in sync as commands change). */
  bindShortcuts(manager: KeyboardShortcutManager): () => void {
    if (this.#managers.has(manager)) return () => this.#unbindManager(manager);
    const unbinds = new Map<string, () => void>();
    this.#managers.set(manager, unbinds);
    for (const command of this.#commands.values()) this.#bindCommand(manager, unbinds, command);
    return () => this.#unbindManager(manager);
  }

  #bindCommand(manager: KeyboardShortcutManager, unbinds: Map<string, () => void>, command: Command): void {
    if (!command.shortcut) return;
    unbinds.set(
      command.id,
      manager.bind({
        id: command.id,
        shortcut: command.shortcut,
        scope: command.scope,
        allowInInput: command.allowInInput,
        allowRepeat: command.allowRepeat,
        when: () => this.isEnabled(command.id),
        handler: () => (this.run(command.id) ? undefined : false),
      }),
    );
  }

  #unbindManager(manager: KeyboardShortcutManager): void {
    const unbinds = this.#managers.get(manager);
    if (!unbinds) return;
    for (const unbind of unbinds.values()) unbind();
    this.#managers.delete(manager);
  }

  #touchRecent(id: string): void {
    this.#recent = [id, ...this.#recent.filter((r) => r !== id)].slice(0, this.#maxRecent);
    this.#emit();
  }

  #emit(): void {
    this.#version++;
    for (const listener of [...this.#listeners]) listener();
  }
}
