/**
 * The watched loop copy, shared by the patch editor and the inspector: which copy live read-outs
 * show (bridge.watchedCopy), and the instance path they read inside a looped component instance.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { EditorSession } from "../../../state/session.ts";
import { copyInScope, instanceCopiesAddress, resolveLiveScope, watchedPrefix, type LiveScope } from "../model/instances.ts";
import { patchEditorBridge } from "./bridge.ts";

const none = () => () => undefined;

/** The loop copy read-outs watch, or null for the "×N" summary. */
export function useWatchedCopy(session: EditorSession): number | null {
  return useStore(patchEditorBridge(session), (s) => s.watchedCopy);
}

/** How many copies of the looped component instance you're inside ran last frame; undefined at the root (and for a patch instance without ports). */
export function useInstanceCopies(session: EditorSession, scope: LiveScope): number | undefined {
  const doc = useStore(session.document, (s) => s.doc);
  const address = instanceCopiesAddress(scope, doc);
  const subscribe = useCallback((cb: () => void) => (address ? session.runtime.subscribeFrame(() => cb()) : none()), [session, address]);
  const read = useCallback(() => (address ? session.runtime.runtime.inspect(address).copies : undefined), [session, address]);
  return useSyncExternalStore(subscribe, read, read);
}

export interface WatchedScope {
  /** Instance path read-outs come from (with "#k" inside a looped instance), or null when the component doesn't run. */
  prefix: string | null;
  copy: number | null;
}

/**
 * A press in the viewer (layers under it, front-most first) on one copy of a looped layer, or inside
 * one copy of a looped instance you're editing, watches that copy, as a click on the canvas does.
 */
export function watchPressedCopy(session: EditorSession, hits: readonly { key: string }[]): void {
  const bridge = patchEditorBridge(session);
  const scope = resolveLiveScope(session.document.getState().doc, session.selection.getState().componentPath, bridge.getState().instanceChoices);
  if (scope.prefix === null) return;
  for (const hit of hits) {
    const copy = copyInScope(hit.key, scope.prefix);
    if (copy === undefined) continue;
    bridge.getState().watchCopy(copy);
    return;
  }
}

/** Where the inspector's live read-outs come from: the patch editor's live scope and watched copy, for the component being edited. */
export function useWatchedScope(session: EditorSession): WatchedScope {
  const doc = useStore(session.document, (s) => s.doc);
  const componentPath = useStore(session.selection, (s) => s.componentPath);
  const choices = useStore(patchEditorBridge(session), (s) => s.instanceChoices);
  const copy = useWatchedCopy(session);
  const scope = useMemo(() => resolveLiveScope(doc, componentPath, choices), [doc, componentPath, choices]);
  const copies = useInstanceCopies(session, scope);
  return { prefix: watchedPrefix(scope, copies, copy), copy };
}
