/** Session-bound Touch actions, shared by the Layers panel rows and the inspector header. */

import type { Id } from "@sonobe/core";
import { ArrowLeftRight, ArrowUpDown, Hand, MousePointer2, MousePointerClick, Move, Pointer, Timer } from "lucide-react";
import type { ReactNode } from "react";
import type { EditorSession } from "../../state/session.ts";
import type { MenuEntry } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { planTouch, touchOptions, type TouchKind } from "./touch.ts";

export const TOUCH_ICONS: Readonly<Record<TouchKind, ReactNode>> = {
  tap: <Pointer size={14} />,
  press: <Hand size={14} />,
  longPress: <Timer size={14} />,
  doubleTap: <MousePointerClick size={14} />,
  drag: <Move size={14} />,
  scrollY: <ArrowUpDown size={14} />,
  scrollX: <ArrowLeftRight size={14} />,
  hover: <MousePointer2 size={14} />,
};

export interface TouchResult {
  ok: boolean;
  patchId?: Id;
  message?: string;
}

/** Add a pre-wired interaction for a layer in the current component, reveal it in the patch editor, and say what happened. */
export function addTouchInteraction(session: EditorSession, layerId: Id, kind: TouchKind): TouchResult {
  const componentId = session.currentComponentId();
  const plan = planTouch(session.document.getState().doc, componentId, layerId, kind, session.registry);
  if (!plan) {
    const message = "That interaction isn't available for this layer.";
    toast({ title: message, tone: "warn" });
    return { ok: false, message };
  }
  const result = session.document.getState().apply(plan.ops, { label: plan.label, defaultComponent: componentId });
  if (!result.ok) {
    const error = result.errors[0];
    const message = error?.message ?? "The interaction couldn't be added.";
    toast({ title: message, ...(error?.hint ? { description: error.hint } : {}), tone: "warn" });
    return { ok: false, message };
  }
  const patchId = result.idMap[plan.ref];
  if (patchId) session.selection.getState().requestReveal(componentId, [patchId]);
  toast({
    id: "touch-added",
    title: plan.label.replace(/^Add /, "Added "),
    description: plan.positionLinked ? "Position is already driven by a patch, so it wasn't rewired." : "It's selected in the patch editor, ready to wire up.",
    tone: "success",
  });
  return patchId ? { ok: true, patchId } : { ok: true };
}

/** Menu entries for a layer's Touch button. */
export function touchMenuEntries(session: EditorSession, layerId: Id): MenuEntry[] {
  return [
    { type: "label", label: "Add interaction" },
    ...touchOptions(session.registry).map(
      (option): MenuEntry => ({
        id: `touch-${option.kind}`,
        label: option.label,
        description: option.description,
        icon: TOUCH_ICONS[option.kind],
        onSelect: () => void addTouchInteraction(session, layerId, option.kind),
      }),
    ),
  ];
}
