import { MessageSquare, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { LayerTypeIcon } from "../../shell/icons.tsx";
import { categoryColorVar } from "../../theme/tokens.ts";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { assistantEditor } from "./editorLink.ts";
import { itemTarget, mentionKey, type MentionIndex, type MentionTarget } from "./mentions.ts";
import { selectionCount } from "./selectionContext.ts";
import type { AssistantSelectionContext, AssistantSelectionItem } from "./types.ts";

/** What pressing a chip does, for its tooltip. */
export function mentionHint(target: MentionTarget): string {
  switch (target.kind) {
    case "patch":
      return target.typeName && target.typeName !== target.name ? `Select this ${target.typeName} patch in the patch editor` : "Select this patch in the patch editor";
    case "layer":
      return target.typeName && target.typeName !== target.name ? `Select this ${target.typeName} layer` : "Select this layer";
    case "comment":
      return "Select this comment in the patch editor";
    case "knob":
      return "Show this knob in the Knobs tab";
  }
}

function MentionGlyph({ target }: { target: Pick<MentionTarget, "kind" | "type" | "category"> }) {
  switch (target.kind) {
    case "patch":
      // The patch's category color, as on its node's header.
      return <span className="sb-mention__dot" style={target.category ? { background: categoryColorVar(target.category) } : undefined} aria-hidden />;
    case "layer":
      return (
        <span className="sb-mention__icon" aria-hidden>
          <LayerTypeIcon type={target.type ?? ""} size={12} />
        </span>
      );
    case "comment":
      return (
        <span className="sb-mention__icon" aria-hidden>
          <MessageSquare size={12} strokeWidth={1.75} />
        </span>
      );
    case "knob":
      return (
        <span className="sb-mention__icon" aria-hidden>
          <SlidersHorizontal size={12} strokeWidth={1.75} />
        </span>
      );
  }
}

export interface MentionChipProps {
  target: MentionTarget;
  /** What the chip says. Default: the item's name. */
  children?: ReactNode;
}

/**
 * A layer, patch, comment or knob named in the chat. Pressing it selects the item where it lives and
 * scrolls to it; pointing at it highlights it there. It shows as selected while the item is.
 */
export function MentionChip({ target, children }: MentionChipProps) {
  const selected = useStore(assistantEditor, (s) => s.selected.has(mentionKey(target)));
  const point = (on: boolean) => assistantEditor.getState().point(on ? target : null);
  return (
    <Tooltip content={mentionHint(target)} placement="top">
      <button
        type="button"
        className="sb-mention"
        data-kind={target.kind}
        data-selected={selected || undefined}
        onClick={() => assistantEditor.getState().show(target)}
        onPointerEnter={() => point(true)}
        onPointerLeave={() => point(false)}
        onFocus={() => point(true)}
        onBlur={() => point(false)}
      >
        <MentionGlyph target={target} />
        <span className="sb-mention__label">{children ?? target.name}</span>
      </button>
    </Tooltip>
  );
}

/** An item of a selection as it is now in the prototype, or null when it's gone (or there's no editor to ask). */
function currentTarget(index: MentionIndex | null, context: AssistantSelectionContext, item: AssistantSelectionItem): MentionTarget | null {
  const component = index?.scope.doc.components[context.component.id];
  const target = component && index ? itemTarget(index.scope, component, item.id) : null;
  return target && target.kind === item.kind ? target : null;
}

export interface SelectionChipsProps {
  context: AssistantSelectionContext;
  /** Chips shown before "+N". Default 3. */
  max?: number;
}

/** A selection as chips: the first few items, then how many more. An item that's gone since is plain text. */
export function SelectionChips({ context, max = 3 }: SelectionChipsProps) {
  const index = useStore(assistantEditor, (s) => s.index);
  const shown = context.items.slice(0, max);
  const rest = selectionCount(context) - shown.length;
  return (
    <span className="sb-assistant-chips">
      {shown.map((item) => {
        const target = currentTarget(index, context, item);
        return target ? (
          <MentionChip key={`${item.kind}:${item.id}`} target={target} />
        ) : (
          <span key={`${item.kind}:${item.id}`} className="sb-mention" data-kind={item.kind} data-gone>
            <span className="sb-mention__label">{item.name}</span>
          </span>
        );
      })}
      {rest > 0 ? <span className="sb-assistant-chips__more">+{rest}</span> : null}
    </span>
  );
}
