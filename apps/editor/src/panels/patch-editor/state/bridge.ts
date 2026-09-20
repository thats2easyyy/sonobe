/**
 * Per-session state shared between the patch editor and other panels: layer property targets the
 * user asked to drive (shown on layer nodes before anything drives them), a pending "pick a driving
 * patch" request for whichever patch editor shows that component, the cable being dragged (so
 * Layers and Inspector rows can light up), which component instance live values come from, and the
 * loop copy read-outs watch.
 */

import type { Id, ValueType } from "@sonobe/core";
import { createStore, type StoreApi } from "zustand/vanilla";

/** A layer property addressed from outside the patch editor. */
export interface LayerPropTarget {
  layerId: Id;
  /** Property key ("scale", "opacity"). */
  prop: string;
  /** Component the layer lives in. Default: the component being edited. */
  component?: Id;
}

/** A cable being dragged in a patch editor. */
export interface CableDrag {
  component: Id;
  /** The output address the cable carries ("pop.output"). */
  from: string;
  type: ValueType;
}

export interface DriveRequest {
  kind: "drive";
  component: Id;
  /** "@photo.scale" */
  address: string;
  nonce: number;
}

export interface PatchEditorBridgeState {
  /** Layer property targets shown before anything drives them, per component ("@photo.opacity"). */
  targets: Readonly<Record<Id, readonly string[]>>;
  request: DriveRequest | null;
  cableDrag: CableDrag | null;
  /** instanceChoiceKey(parent, component) → the instance live values come from. */
  instanceChoices: Readonly<Record<string, Id>>;
  /**
   * The loop copy live read-outs show, in the patch editor and the inspector: item k of a looped
   * value (k mod its length), and copy k of a looped component instance you're inside. Null shows
   * the "×N" summary.
   */
  watchedCopy: number | null;
  addTarget: (component: Id, address: string) => void;
  /** Forget targets (all of the component's when `addresses` is omitted). */
  removeTargets: (component: Id, addresses?: readonly string[]) => void;
  requestDrive: (component: Id, address: string) => void;
  consumeRequest: (nonce: number) => void;
  setCableDrag: (drag: CableDrag | null) => void;
  chooseInstance: (key: string, instance: Id) => void;
  watchCopy: (copy: number | null) => void;
}

export type PatchEditorBridge = StoreApi<PatchEditorBridgeState>;

/** What a mounted patch editor offers other panels. */
export interface PatchEditorHandle {
  componentId: Id;
  /** Connect with the editor's full explanation (converter suggestions) on failure. */
  connect(from: string, to: string): boolean;
}

const bridges = new WeakMap<object, PatchEditorBridge>();
const handles = new WeakMap<object, PatchEditorHandle[]>();
let nonce = 0;

/** The bridge store for a session (created on first use). */
export function patchEditorBridge(session: object): PatchEditorBridge {
  let store = bridges.get(session);
  if (!store) {
    store = createStore<PatchEditorBridgeState>()((set, get) => ({
      targets: {},
      request: null,
      cableDrag: null,
      instanceChoices: {},
      watchedCopy: null,
      addTarget(component, address) {
        const current = get().targets[component] ?? [];
        if (current.includes(address)) return;
        set({ targets: { ...get().targets, [component]: [...current, address] } });
      },
      removeTargets(component, addresses) {
        const current = get().targets[component];
        if (!current?.length) return;
        const next = addresses ? current.filter((a) => !addresses.includes(a)) : [];
        if (next.length === current.length) return;
        const targets = { ...get().targets };
        if (next.length) targets[component] = next;
        else delete targets[component];
        set({ targets });
      },
      requestDrive(component, address) {
        set({ request: { kind: "drive", component, address, nonce: ++nonce } });
      },
      consumeRequest(n) {
        if (get().request?.nonce === n) set({ request: null });
      },
      setCableDrag(drag) {
        const current = get().cableDrag;
        if (current === drag || (current && drag && current.component === drag.component && current.from === drag.from && current.type === drag.type)) return;
        set({ cableDrag: drag });
      },
      chooseInstance(key, instance) {
        if (get().instanceChoices[key] === instance) return;
        set({ instanceChoices: { ...get().instanceChoices, [key]: instance } });
      },
      watchCopy(copy) {
        const next = copy === null || !Number.isInteger(copy) || copy < 0 ? null : copy;
        if (get().watchedCopy !== next) set({ watchedCopy: next });
      },
    }));
    bridges.set(session, store);
  }
  return store;
}

/** Register a mounted patch editor; returns the unregister function. The most recent one wins. */
export function registerPatchEditor(session: object, handle: PatchEditorHandle): () => void {
  const list = handles.get(session) ?? [];
  list.push(handle);
  handles.set(session, list);
  return () => {
    const current = handles.get(session);
    const i = current?.indexOf(handle) ?? -1;
    if (current && i >= 0) current.splice(i, 1);
  };
}

/** The most recently mounted patch editor, optionally only one showing `componentId`. */
export function mountedPatchEditor(session: object, componentId?: Id): PatchEditorHandle | undefined {
  const list = handles.get(session) ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (componentId === undefined || list[i]!.componentId === componentId) return list[i];
  return undefined;
}
