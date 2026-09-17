/** Applying inspector edits: one undo step per gesture (scrubs and color drags coalesce), and friendly errors. */

import type { ApplyOpsResult, Op } from "@sonobe/core";
import { useEffect, useMemo, useRef } from "react";
import type { ApplyInput } from "../../state/document.ts";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { toast } from "../../ui/Toast.tsx";

export interface InspectorEdit {
  /**
   * Apply ops to the current component. Edits passing a `gesture` key form one explicit document
   * gesture: the first starts a new undo step and the rest merge into it, however long the gesture
   * lasts, until `endGesture()` or an edit without a gesture. Edits without one are their own step,
   * unless they pass a `coalesceKey` an earlier step used (an asset import this edit uses).
   */
  apply: (ops: readonly Op[], label: string, options?: { gesture?: string; coalesceKey?: string }) => ApplyOpsResult | undefined;
  /** Close the open gesture (only when it's `gesture`, if given): drag end, typed commit, arrow press. */
  endGesture: (gesture?: string) => void;
}

export function useInspectorEdit(): InspectorEdit {
  const session = useEditorSession();
  /** The document coalesce key of the gesture this hook has open. */
  const open = useRef<string | null>(null);
  const edit = useMemo<InspectorEdit>(() => {
    const close = () => {
      const key = open.current;
      if (key === null) return;
      open.current = null;
      session.document.getState().endGesture?.(key);
    };
    return {
      apply(ops, label, options = {}) {
        if (ops.length === 0) return undefined;
        const componentId = session.currentComponentId();
        let input: ApplyInput = { label, defaultComponent: componentId };
        if (options.gesture !== undefined) {
          const key = `inspector:${componentId}:${options.gesture}`;
          if (open.current !== null && open.current !== key) close();
          const phase = open.current === key ? "update" : "begin";
          open.current = key;
          input = { ...input, coalesceKey: key, gesture: phase };
        } else {
          close();
          if (options.coalesceKey !== undefined) input = { ...input, coalesceKey: options.coalesceKey };
        }
        const result = session.document.getState().apply(ops, input);
        if (!result.ok) {
          const error = result.errors[0];
          toast({ id: "inspector-edit", title: error?.message ?? "That change couldn't be made.", ...(error?.hint ? { description: error.hint } : {}), tone: "warn" });
        }
        return result;
      },
      endGesture(gesture) {
        if (open.current === null) return;
        if (gesture !== undefined && !open.current.endsWith(`:${gesture}`)) return;
        close();
      },
    };
  }, [session]);
  // A control that unmounts mid-gesture (selection changed during a scrub) must not leave it open.
  useEffect(() => () => edit.endGesture(), [edit]);
  return edit;
}
