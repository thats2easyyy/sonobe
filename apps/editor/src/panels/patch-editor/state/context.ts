/** Patch editor React context and the hooks node and cable views use. */

import type { Id } from "@sonobe/core";
import type { PatchRegistry } from "@sonobe/patches";
import { createContext, useCallback, useContext, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { useStore } from "zustand";
import type { EditorSession } from "../../../state/session.ts";
import type { LiveScope } from "../model/instances.ts";
import type { CableGeometry } from "../model/knife.ts";
import type { PortModel } from "../model/types.ts";
import type { PatchEditorActions } from "./actions.ts";
import type { AppearStore } from "./appear.ts";
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
  /** How nodes and cables arrive on the canvas; cable orbs wait for their cable to be there. */
  appear: AppearStore;
  actions: PatchEditorActions;
  reducedMotion: boolean;
  /** The component runs in the prototype (the root, or through an instance), so live values exist. */
  liveEnabled: boolean;
  /** Which instance live values come from. */
  liveScope: LiveScope;
  /** Copies of the looped layer instance live values come from (the watched copy picks one); undefined when it isn't looped. */
  instanceCopies?: number | undefined;
  /** Call before moving the viewport on the user's behalf, so panel resizes keep their view instead of re-fitting. */
  markViewportManual: () => void;
  /** Open a port's context menu (publish, unpublish, disconnect, and the node's own entries). */
  openPortMenu?: (event: ReactMouseEvent, nodeId: string, port: PortModel) => void;
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

/** How many times a pulse output has fired (changes pop the output's pulse ring). */
export function usePulseCount(address: string | null | undefined): number {
  const { live } = usePatchEditor();
  const subscribe = useCallback((cb: () => void) => (address ? live.subscribePulse(address, cb) : noop()), [live, address]);
  const get = useCallback(() => (address ? live.pulseCount(address) : 0), [live, address]);
  return useSyncExternalStore(subscribe, get, get);
}
