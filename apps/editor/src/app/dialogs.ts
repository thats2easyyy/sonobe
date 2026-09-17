/**
 * App-level dialogs as promises: name a prototype (browser Save As), pick a stored prototype
 * (browser Open), and "save your changes?" before replacing a document. Requests queue and are
 * shown one at a time by <AppDialogs />.
 */

import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { DiscardChoice } from "../state/session.ts";

export type AppDialogRequest =
  | { kind: "promptName"; id: number; defaultName: string; resolve: (name: string | null) => void }
  | { kind: "pickProject"; id: number; names: readonly string[]; resolve: (name: string | null) => void }
  | { kind: "confirmDiscard"; id: number; name: string; action: "open" | "new" | "reload"; resolve: (choice: DiscardChoice) => void };

type Distribute<T> = T extends unknown ? Omit<T, "id" | "resolve"> : never;
export type AppDialogInput = Distribute<AppDialogRequest>;

export interface AppDialogState {
  queue: readonly AppDialogRequest[];
  /** Resolve the front request and show the next one. */
  settle: (id: number, value: string | null | DiscardChoice) => void;
}

export interface AppDialogStore extends StoreApi<AppDialogState> {
  promptName(defaultName: string): Promise<string | null>;
  pickProject(names: readonly string[]): Promise<string | null>;
  confirmDiscard(info: { name: string; action: "open" | "new" | "reload" }): Promise<DiscardChoice>;
}

export function createAppDialogStore(): AppDialogStore {
  let nextId = 1;
  const store = createStore<AppDialogState>()((set, get) => ({
    queue: [],
    settle(id, value) {
      const request = get().queue.find((r) => r.id === id);
      if (!request) return;
      set({ queue: get().queue.filter((r) => r.id !== id) });
      if (request.kind === "confirmDiscard") request.resolve(value === "save" || value === "discard" ? value : "cancel");
      else request.resolve(typeof value === "string" ? value : null);
    },
  }));

  const enqueue = <T>(input: AppDialogInput): Promise<T> =>
    new Promise<T>((resolve) => {
      const request = { ...input, id: nextId++, resolve } as unknown as AppDialogRequest;
      store.setState({ queue: [...store.getState().queue, request] });
    });

  return Object.assign(store, {
    promptName: (defaultName: string) => enqueue<string | null>({ kind: "promptName", defaultName }),
    pickProject: (names: readonly string[]) => enqueue<string | null>({ kind: "pickProject", names }),
    confirmDiscard: (info: { name: string; action: "open" | "new" | "reload" }) => enqueue<DiscardChoice>({ kind: "confirmDiscard", ...info }),
  });
}

/** The editor's dialog store. */
export const appDialogs = createAppDialogStore();

export function useAppDialogs<T>(selector: (state: AppDialogState) => T, store: AppDialogStore = appDialogs): T {
  return useStore(store, selector);
}
