/**
 * Positions of patch editor nodes the document doesn't store (layer targets, component interface
 * nodes), per session and component. They last for the session.
 */

import type { Id } from "@sonobe/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { SessionPositions } from "../model/types.ts";

export interface SessionPositionsState {
  byComponent: Readonly<Record<Id, SessionPositions>>;
  setPositions: (componentId: Id, positions: ReadonlyMap<string, { x: number; y: number }>) => void;
}

export type SessionPositionsStore = StoreApi<SessionPositionsState>;

const stores = new WeakMap<object, SessionPositionsStore>();

/** The positions store for a session (created on first use). */
export function sessionPositionsStore(session: object): SessionPositionsStore {
  let store = stores.get(session);
  if (!store) {
    store = createStore<SessionPositionsState>()((set, get) => ({
      byComponent: {},
      setPositions(componentId, positions) {
        if (positions.size === 0) return;
        const current = get().byComponent[componentId] ?? {};
        const next: Record<string, { x: number; y: number }> = { ...current };
        for (const [id, p] of positions) next[id] = { x: Math.round(p.x), y: Math.round(p.y) };
        set({ byComponent: { ...get().byComponent, [componentId]: next } });
      },
    }));
    stores.set(session, store);
  }
  return store;
}

const EMPTY: SessionPositions = {};
export const emptyPositions = (): SessionPositions => EMPTY;
