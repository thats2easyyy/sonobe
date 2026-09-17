/**
 * EditorProvider and hooks: provides an EditorSession to the tree, registers document commands and
 * menu routing with the CommandProvider, handles DOM clipboard events, and exposes the session to
 * the desktop MCP bridge. Selectors passed to the hooks must return stable references.
 */

import type { Component } from "@sonobe/core";
import { useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { registerRpcHandlers } from "../host/rpcHandlers.ts";
import type { LiveValues, PulseFire, RuntimeHostState, ValueSubscriptionOptions } from "../runtime/runtimeHost.ts";
import { useOptionalCommands } from "../ui/commands/CommandProvider.tsx";
import { useLatest } from "../ui/lib/hooks.ts";
import { attachClipboardEvents, bindHostCommands, registerDocumentCommands } from "./commands.ts";
import type { ConsoleState } from "./console.ts";
import { EditorContext } from "./context.ts";
import type { DocumentState } from "./document.ts";
import type { PresenceState } from "./presence.ts";
import { currentComponentId, type SelectionState } from "./selection.ts";
import { getDefaultSession, type EditorSession } from "./session.ts";

export interface EditorProviderProps {
  /** Default: the app-wide session. */
  session?: EditorSession;
  children: ReactNode;
  /** Register document commands and desktop menu routing. Default true. */
  commands?: boolean;
  /** Handle DOM copy/cut/paste. Default true. */
  clipboardEvents?: boolean;
  /** Register MCP bridge handlers when the host has RPC. Default true. */
  rpc?: boolean;
}

export function EditorProvider({ session, children, commands = true, clipboardEvents = true, rpc = true }: EditorProviderProps) {
  const [value] = useState(() => session ?? getDefaultSession());
  const cmds = useOptionalCommands();

  useEffect(() => {
    if (!commands || !cmds) return;
    const unregister = registerDocumentCommands(cmds.registry, value, { platform: cmds.platform });
    const unbind = bindHostCommands(value.host, cmds.registry);
    return () => {
      unbind();
      unregister();
    };
  }, [cmds, value, commands]);

  useEffect(() => (clipboardEvents && typeof document !== "undefined" ? attachClipboardEvents(document, value) : undefined), [value, clipboardEvents]);

  useEffect(() => (rpc && value.host?.rpc ? registerRpcHandlers(value) : undefined), [value, rpc]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

/** The session from the nearest EditorProvider, or the app-wide one. */
export function useEditorSession(): EditorSession {
  return useContext(EditorContext) ?? getDefaultSession();
}

export function useDocument<T>(selector: (state: DocumentState) => T): T {
  return useStore(useEditorSession().document, selector);
}

export function useSelection<T>(selector: (state: SelectionState) => T): T {
  return useStore(useEditorSession().selection, selector);
}

export function usePresence<T>(selector: (state: PresenceState) => T): T {
  return useStore(useEditorSession().presence, selector);
}

export function useConsole<T>(selector: (state: ConsoleState) => T): T {
  return useStore(useEditorSession().console, selector);
}

export function useRuntimeState<T>(selector: (state: RuntimeHostState) => T): T {
  return useStore(useEditorSession().runtime.state, selector);
}

/** The component being edited. */
export function useCurrentComponent(): Component | undefined {
  const session = useEditorSession();
  const componentId = useStore(session.selection, currentComponentId);
  return useStore(session.document, (s) => s.doc.components[componentId]);
}

/** Live runtime values for addresses (throttled; re-subscribes when the address list changes). */
export function useLiveValues(addresses: readonly string[], options: ValueSubscriptionOptions = {}): LiveValues {
  const session = useEditorSession();
  const [values, setValues] = useState<LiveValues>({});
  const key = addresses.join("\n");
  const hz = options.hz;
  useEffect(() => {
    if (!key) {
      setValues({});
      return;
    }
    return session.runtime.subscribeValues(key.split("\n"), (next) => setValues(next), hz !== undefined ? { hz } : {});
  }, [session, key, hz]);
  return values;
}

/** Call `cb` on every frame where pulse outputs fired. */
export function usePulseFires(cb: (fire: PulseFire) => void): void {
  const session = useEditorSession();
  const latest = useLatest(cb);
  useEffect(() => session.runtime.subscribePulses((fire) => latest.current(fire)), [session, latest]);
}
