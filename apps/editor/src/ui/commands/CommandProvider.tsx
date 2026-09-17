import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type DependencyList,
  type ReactNode,
} from "react";
import { CommandRegistry, type Command } from "./commandRegistry.ts";
import { KeyboardShortcutManager, detectPlatform, type Platform, type ShortcutBinding } from "./shortcutManager.ts";

export interface CommandsContextValue {
  registry: CommandRegistry;
  shortcuts: KeyboardShortcutManager;
  platform: Platform;
}

const CommandsContext = createContext<CommandsContextValue | null>(null);

export interface CommandProviderProps {
  children: ReactNode;
  registry?: CommandRegistry;
  shortcuts?: KeyboardShortcutManager;
  platform?: Platform;
  /** Listen for keydown on window. Default true. */
  attach?: boolean;
}

/** Provides the command registry and shortcut manager, binds command shortcuts, and listens for keys. */
export function CommandProvider({ children, registry: providedRegistry, shortcuts: providedShortcuts, platform, attach = true }: CommandProviderProps) {
  const [registry] = useState(() => providedRegistry ?? new CommandRegistry());
  const [shortcuts] = useState(() => providedShortcuts ?? new KeyboardShortcutManager({ platform }));

  useEffect(() => {
    const detachBindings = registry.bindShortcuts(shortcuts);
    const detachListener = attach ? shortcuts.attach(window) : undefined;
    return () => {
      detachBindings();
      detachListener?.();
    };
  }, [registry, shortcuts, attach]);

  const value = useMemo(() => ({ registry, shortcuts, platform: shortcuts.platform }), [registry, shortcuts]);
  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>;
}

export function useCommands(): CommandsContextValue {
  const ctx = useContext(CommandsContext);
  if (!ctx) throw new Error("useCommands must be used inside <CommandProvider>");
  return ctx;
}

export function useOptionalCommands(): CommandsContextValue | null {
  return useContext(CommandsContext);
}

let fallbackPlatform: Platform | undefined;

/** The platform used for shortcut display (⌘ vs Ctrl). Works without a provider. */
export function usePlatform(): Platform {
  const ctx = useContext(CommandsContext);
  if (ctx) return ctx.platform;
  fallbackPlatform ??= detectPlatform();
  return fallbackPlatform;
}

/** Register commands while mounted. The factory re-runs when `deps` change. */
export function useRegisterCommands(factory: () => readonly Command[], deps: DependencyList): void {
  const { registry } = useCommands();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registry.register(factory()), [registry, ...deps]);
}

/** Bind a one-off shortcut while mounted (no-op without a provider or when binding is null). */
export function useShortcut(binding: ShortcutBinding | null, deps: DependencyList): void {
  const ctx = useOptionalCommands();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => (binding && ctx ? ctx.shortcuts.bind(binding) : undefined), [ctx, ...deps]);
}

/** All registered commands; re-renders when the registry changes. */
export function useCommandList(): Command[] {
  const { registry } = useCommands();
  const version = useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.getVersion(),
    () => registry.getVersion(),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => registry.all(), [registry, version]);
}
