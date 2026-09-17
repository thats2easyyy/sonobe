/** Applying inspector edits: one undo step per gesture (scrubs and color drags coalesce), and friendly errors. */

import type { ApplyOpsResult, Op } from "@sonobe/core";
import { useMemo, useRef } from "react";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { toast } from "../../ui/Toast.tsx";

export interface InspectorEdit {
  /**
   * Apply ops to the current component. Edits passing the same `gesture` key merge into one undo
   * step until `endGesture()`; edits without one are their own step.
   */
  apply: (ops: readonly Op[], label: string, options?: { gesture?: string }) => ApplyOpsResult | undefined;
  /** Close the current gesture (drag end, typed commit, arrow press). */
  endGesture: () => void;
}

export function useInspectorEdit(): InspectorEdit {
  const session = useEditorSession();
  const counter = useRef(0);
  return useMemo(
    () => ({
      apply(ops, label, options = {}) {
        if (ops.length === 0) return undefined;
        const componentId = session.currentComponentId();
        const result = session.document.getState().apply(ops, {
          label,
          defaultComponent: componentId,
          ...(options.gesture !== undefined ? { coalesceKey: `inspector:${componentId}:${options.gesture}:${counter.current}` } : {}),
        });
        if (!result.ok) {
          const error = result.errors[0];
          toast({ id: "inspector-edit", title: error?.message ?? "That change couldn't be made.", ...(error?.hint ? { description: error.hint } : {}), tone: "warn" });
        }
        return result;
      },
      endGesture() {
        counter.current++;
      },
    }),
    [session],
  );
}
