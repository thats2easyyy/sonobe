/**
 * `window.__sonobe`: a small read-mostly handle for end-to-end tests and debugging in dev builds.
 * Installed in dev, or in any build opened with `?sonobeTest`.
 */

import type { Op, SonobeDocument, Value } from "@sonobe/core";
import type { ApplyOpsResult } from "@sonobe/core";
import type { SelectionState } from "../state/selection.ts";
import type { EditorSession } from "../state/session.ts";
import { layoutStore, type LayoutStore } from "../shell/layoutStore.ts";

export interface SonobeTestHook {
  readonly session: EditorSession;
  doc(): SonobeDocument;
  revision(): number;
  /** Runtime value for "patch.port" or "@layer.prop" on the current frame. */
  getValue(address: string): Value;
  frame(): number;
  playing(): boolean;
  selection(): SelectionState;
  layout(): LayoutStore;
  apply(ops: Op[], label?: string): Pick<ApplyOpsResult, "ok" | "errors" | "idMap">;
}

declare global {
  interface Window {
    __sonobe?: SonobeTestHook;
  }
}

export function shouldInstallTestHook(): boolean {
  if (import.meta.env?.DEV) return true;
  try {
    return new URLSearchParams(window.location.search).has("sonobeTest");
  } catch {
    return false;
  }
}

/** Install the hook; returns a function that removes it. */
export function installTestHook(session: EditorSession, target: Window = window): () => void {
  const hook: SonobeTestHook = {
    session,
    doc: () => session.document.getState().doc,
    revision: () => session.document.getState().revision,
    getValue: (address) => session.runtime.runtime.getValue(address),
    frame: () => session.runtime.runtime.frame,
    playing: () => session.runtime.isPlaying(),
    selection: () => session.selection.getState(),
    layout: () => layoutStore.getState(),
    apply(ops, label = "Test change") {
      const { ok, errors, idMap } = session.document.getState().apply(ops, { label });
      return { ok, errors, idMap };
    },
  };
  target.__sonobe = hook;
  return () => {
    if (target.__sonobe === hook) delete target.__sonobe;
  };
}
