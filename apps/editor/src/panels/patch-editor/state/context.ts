/** Patch editor React context and the hooks node and cable views use. */

import type { Id } from "@sonobe/core";
import type { PatchRegistry } from "@sonobe/patches";
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import type { EditorSession } from "../../../state/session.ts";
import type { CableGeometry } from "../model/knife.ts";
import type { PatchEditorActions } from "./actions.ts";
import type { LiveStore } from "./liveStore.ts";
import type { PatchEditorUiState, UiStore } from "./uiStore.ts";

export interface PatchEditorContextValue {
  session: EditorSession;
  registry: PatchRegistry;
  componentId: Id;
  ui: UiStore;
  live: LiveStore;
  /** Rendered cable endpoints (flow coordinates), written by cable views. */
  geometry: Map<string, CableGeometry>;
  actions: PatchEditorActions;
  reducedMotion: boolean;
  /** Live values only exist for the root component (engine limitation). */
  liveEnabled: boolean;
}

export const PatchEditorContext = createContext<PatchEditorContextValue | null>(null);

export function usePatchEditor(): PatchEditorContextValue {
  const ctx = useContext(PatchEditorContext);
  if (!ctx) throw new Error("Patch editor views must render inside <PatchEditor>.");
  return ctx;
}

export function useUi<T>(selector: (state: PatchEditorUiState) => T): T {
  return useStore(usePatchEditor().ui, selector);
}

const noop = () => () => undefined;

/** The live runtime value at an address (undefined when not running or null address). */
export function useLiveValue(address: string | null | undefined): unknown {
  const { live } = usePatchEditor();
  const subscribe = useCallback((cb: () => void) => (address ? live.subscribe(address, cb) : noop()), [live, address]);
  const get = useCallback(() => (address ? live.get(address) : undefined), [live, address]);
  return useSyncExternalStore(subscribe, get, get);
}

/** How many times a pulse output has fired (changes trigger spark animations). */
export function usePulseCount(address: string | null | undefined): number {
  const { live } = usePatchEditor();
  const subscribe = useCallback((cb: () => void) => (address ? live.subscribePulse(address, cb) : noop()), [live, address]);
  const get = useCallback(() => (address ? live.pulseCount(address) : 0), [live, address]);
  return useSyncExternalStore(subscribe, get, get);
}
