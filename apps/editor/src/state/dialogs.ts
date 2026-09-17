/**
 * Dialog service: confirm, prompt, choose, and pick as promises, instead of window.confirm and
 * window.prompt. Requests queue in a zustand store and the shell shows the front one.
 *
 * Rendering (the shell owns the UI):
 *
 * ```tsx
 * function DialogHost({ store }: { store: DialogStore }) {
 *   const request = useStore(store, (s) => s.queue[0] ?? null);
 *   if (!request) return null;
 *   const settle = (value: boolean | string | null) => store.getState().settle(request.id, value);
 *   switch (request.kind) {
 *     case "confirm": // title, message, confirmLabel/cancelLabel, danger → settle(true | false)
 *     case "prompt":  // defaultValue, placeholder, validate(value) → message or null → settle(text | null)
 *     case "choose":  // actions [{ value, label, variant }] → settle(action.value | null)
 *     case "pick":    // items [{ value, label, description }] → settle(item.value | null)
 *   }
 * }
 * ```
 *
 * Escape or closing the dialog settles with null (false for confirm). Use `session.dialogs` (or
 * `useDialogs` from EditorProvider); hosts without an explicit dialog store use `getDefaultDialogs()`,
 * the same store the default session uses, so one <DialogHost /> covers both.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

export type DialogVariant = "primary" | "danger" | "default";

export interface DialogAction<T extends string = string> {
  value: T;
  label: string;
  variant?: DialogVariant;
}

interface DialogBase {
  title: string;
  message?: string;
}

export interface ConfirmDialogOptions extends DialogBase {
  /** Default "OK". */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** The confirming action destroys something (red button). */
  danger?: boolean;
}

export interface PromptDialogOptions extends DialogBase {
  defaultValue?: string;
  placeholder?: string;
  /** Accessible label for the text field. Default: the title. */
  label?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A message explaining why the value can't be used, or null when it's fine. */
  validate?: (value: string) => string | null;
}

export interface ChooseDialogOptions<T extends string = string> extends DialogBase {
  /** Buttons, in display order. Closing the dialog resolves null. */
  actions: readonly DialogAction<T>[];
}

export interface PickDialogItem {
  value: string;
  label: string;
  description?: string;
}

export interface PickDialogOptions extends DialogBase {
  items: readonly PickDialogItem[];
  confirmLabel?: string;
  /** Shown when there's nothing to pick. */
  emptyMessage?: string;
}

export type DialogRequest =
  | { kind: "confirm"; id: number; options: ConfirmDialogOptions }
  | { kind: "prompt"; id: number; options: PromptDialogOptions }
  | { kind: "choose"; id: number; options: ChooseDialogOptions }
  | { kind: "pick"; id: number; options: PickDialogOptions };

export type DialogKind = DialogRequest["kind"];

export interface DialogState {
  /** Oldest first; show `queue[0]`. */
  queue: readonly DialogRequest[];
  /** Resolve a request (true/false for confirm; text or null for prompt; a value or null otherwise). */
  settle: (id: number, value: boolean | string | null) => void;
  /** Resolve a request as dismissed. */
  dismiss: (id: number) => void;
  /** Dismiss every request (window closing, session disposed). */
  dismissAll: () => void;
}

export interface DialogService {
  confirm(options: ConfirmDialogOptions): Promise<boolean>;
  /** Resolves the entered text, or null when cancelled. */
  prompt(options: PromptDialogOptions): Promise<string | null>;
  /** Resolves the chosen action's value, or null when dismissed. */
  choose<T extends string>(options: ChooseDialogOptions<T>): Promise<T | null>;
  /** Resolves the picked item's value, or null when dismissed. */
  pick(options: PickDialogOptions): Promise<string | null>;
}

export interface DialogStore extends StoreApi<DialogState>, DialogService {}

export function createDialogStore(): DialogStore {
  let nextId = 1;
  const resolvers = new Map<number, (value: unknown) => void>();

  const store = createStore<DialogState>()((set, get) => {
    const settle = (id: number, value: boolean | string | null) => {
      const request = get().queue.find((r) => r.id === id);
      const resolve = resolvers.get(id);
      if (!request || !resolve) return;
      resolvers.delete(id);
      set({ queue: get().queue.filter((r) => r.id !== id) });
      switch (request.kind) {
        case "confirm":
          resolve(value === true);
          break;
        case "prompt":
          resolve(typeof value === "string" ? value : null);
          break;
        case "choose":
          resolve(typeof value === "string" && request.options.actions.some((a) => a.value === value) ? value : null);
          break;
        case "pick":
          resolve(typeof value === "string" && request.options.items.some((item) => item.value === value) ? value : null);
          break;
      }
    };
    return {
      queue: [],
      settle,
      dismiss: (id) => settle(id, null),
      dismissAll() {
        for (const request of [...get().queue]) settle(request.id, null);
      },
    };
  });

  const enqueue = <T>(request: Omit<DialogRequest, "id">): Promise<T> =>
    new Promise<T>((resolve) => {
      const id = nextId++;
      resolvers.set(id, resolve as (value: unknown) => void);
      store.setState({ queue: [...store.getState().queue, { ...request, id } as DialogRequest] });
    });

  return Object.assign(store, {
    confirm: (options: ConfirmDialogOptions) => enqueue<boolean>({ kind: "confirm", options: { ...options } }),
    prompt: (options: PromptDialogOptions) => enqueue<string | null>({ kind: "prompt", options: { ...options } }),
    choose: <T extends string>(options: ChooseDialogOptions<T>) => enqueue<T | null>({ kind: "choose", options: { ...options, actions: options.actions.map((a) => ({ ...a })) } as ChooseDialogOptions }),
    pick: (options: PickDialogOptions) => enqueue<string | null>({ kind: "pick", options: { ...options, items: options.items.map((item) => ({ ...item })) } }),
  });
}

let sharedDialogs: DialogStore | null = null;

/** The app-wide dialog store (used by default sessions and browser hosts). */
export function getDefaultDialogs(): DialogStore {
  sharedDialogs ??= createDialogStore();
  return sharedDialogs;
}

/** Replace (or reset) the app-wide dialog store. */
export function setDefaultDialogs(store: DialogStore | null): void {
  sharedDialogs = store;
}
