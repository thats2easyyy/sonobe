/** Custom React Flow nodes: patches, layer property targets, component interface, comments. */

import { typeLabel } from "@sonobe/core";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { CircleAlert, CornerDownRight, Layers, LogIn, TriangleAlert } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "zustand";
import { categoryColorVar } from "../../../theme/tokens.ts";
import { Button } from "../../../ui/Button.tsx";
import { Popover } from "../../../ui/Popover.tsx";
import { PRESENCE_FLASH_MS } from "../../../state/presence.ts";
import { loopLengthOf } from "../model/format.ts";
import type { CommentFlowNode, InterfaceFlowNode, LayerFlowNode, NodeIssue, PatchFlowNode } from "../model/types.ts";
import { usePatchEditor, useLiveValue, useUi } from "../state/context.ts";
import { CATEGORY_ICONS, LAYER_ICONS } from "./icons.ts";
import { CollapsedPorts, PortRows } from "./PortRows.tsx";

function TitleInput({ initial, onCommit, onCancel, multiline = false, ariaLabel }: { initial: string; onCommit: (value: string) => void; onCancel: () => void; multiline?: boolean; ariaLabel: string }) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };
  const props = {
    ref,
    value,
    "aria-label": ariaLabel,
    spellCheck: false,
    className: "sb-pe-title-input nodrag nopan nowheel",
    onChange: (e: { target: { value: string } }) => setValue(e.target.value),
    onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
    onDoubleClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && !(multiline && e.shiftKey)) {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        done.current = true;
        onCancel();
      }
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

function IssueBadge({ issues }: { issues: readonly NodeIssue[] }) {
  const { actions } = usePatchEditor();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const worst = issues.find((i) => i.severity === "error") ?? issues[0]!;
  const Icon = worst.severity === "error" ? CircleAlert : TriangleAlert;
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="sb-pe-badge sb-pe-badge--issue nodrag nopan"
        data-severity={worst.severity}
        aria-label={`${issues.length} ${issues.length === 1 ? "problem" : "problems"}: ${worst.message}`}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Icon size={12} strokeWidth={2.25} aria-hidden />
      </button>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} placement="top-start" offset={6} aria-label="Problems" className="sb-pe-issues">
        {issues.map((issue, i) => (
          <div key={i} className="sb-pe-issues__item" data-severity={issue.severity}>
            <div className="sb-pe-issues__message">{issue.message}</div>
            {issue.suggestions?.filter((s) => s.ops?.length).slice(0, 2).map((s, j) => (
              <Button
                key={j}
                size="sm"
                variant="secondary"
                onClick={() => {
                  actions.apply(s.ops!, s.description.replace(/\.$/, ""));
                  setOpen(false);
                }}
              >
                {s.description}
              </Button>
            ))}
          </div>
        ))}
      </Popover>
    </>
  );
}

function useFlash(id: string): boolean {
  const { session } = usePatchEditor();
  const at = useStore(session.presence, (s) => s.flashes[id]);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (at === undefined) return;
    const remaining = PRESENCE_FLASH_MS - (Date.now() - at);
    if (remaining <= 0) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), remaining);
    return () => clearTimeout(t);
  }, [at]);
  return flashing;
}

/** A patch: category-colored header, ports, inline values, live values, badges. */
export const PatchNodeView = memo(function PatchNodeView({ id, data, selected }: NodeProps<PatchFlowNode>) {
  const { actions, ui, liveEnabled } = usePatchEditor();
  const editing = useUi((s) => s.editingTitle === id);
  const flashing = useFlash(id);
  const loopOutput = data.looped || data.outputs.some((o) => o.wholeLoop) ? data.outputs.find((o) => o.loop)?.address : undefined;
  const liveLoop = loopLengthOf(useLiveValue(liveEnabled ? loopOutput : null) as never);
  const loopLength = liveLoop ?? data.loopLength;
  const showLoop = data.looped || data.outputs.some((o) => o.wholeLoop);
  const Icon = CATEGORY_ICONS[data.category];
  const showVariant = data.variants && data.typeParam && data.typeParam !== data.variants[0];
  return (
    <div
      className="sb-pe-node"
      data-kind="patch"
      data-selected={selected || undefined}
      data-muted={data.muted || undefined}
      data-collapsed={data.collapsed || undefined}
      data-issue={data.issues.some((i) => i.severity === "error") ? "error" : data.issues.length ? "warning" : undefined}
      data-working={data.working.length > 0 || undefined}
      data-flash={flashing || undefined}
      data-unknown={!data.known || undefined}
      style={{ "--sb-cat": categoryColorVar(data.category) } as CSSProperties}
      aria-label={`${data.title}${data.customName ? ` (${data.specName})` : ""}`}
    >
      <header
        className="sb-pe-node__header"
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (data.componentTarget) actions.enterComponent(id);
          else ui.getState().set({ editingTitle: id });
        }}
      >
        <span className="sb-pe-node__icon" aria-hidden>
          <Icon size={11} strokeWidth={2.25} />
        </span>
        {editing ? (
          <TitleInput initial={data.title} ariaLabel="Patch name" onCommit={(v) => (actions.rename(id, v), ui.getState().set({ editingTitle: null }))} onCancel={() => ui.getState().set({ editingTitle: null })} />
        ) : (
          <span className="sb-pe-node__title" title={data.customName ? data.specName : undefined}>
            {data.title}
          </span>
        )}
        {showVariant && <span className="sb-pe-chip">{typeLabel(data.typeParam!).replace(/ \[.*\]$/, "").replace(/^on\/off \(boolean\)$/, "boolean")}</span>}
        {showLoop && (
          <span className="sb-pe-node__loop sb-tabular" aria-label={loopLength !== undefined ? `Loop of ${loopLength}` : "Loop"}>
            ×{loopLength ?? ""}
          </span>
        )}
        {data.muted && <span className="sb-pe-chip sb-pe-chip--muted">Muted</span>}
        {data.issues.length > 0 && <IssueBadge issues={data.issues} />}
        {data.working.length > 0 && (
          <span className="sb-pe-working" aria-label={`${data.working.join(", ")} working on this`}>
            <span className="sb-pe-working__dot" aria-hidden />
            {data.working[0]}
          </span>
        )}
        {data.componentTarget && <LogIn className="sb-pe-node__enter" size={11} strokeWidth={2.25} aria-label="Double-click to enter" />}
      </header>
      {data.collapsed ? <CollapsedPorts inputs={data.inputs} outputs={data.outputs} /> : <PortRows nodeId={id} inputs={data.inputs} outputs={data.outputs} editable />}
    </div>
  );
});

/** A layer whose properties are driven by cables (or read by patches). */
export const LayerNodeView = memo(function LayerNodeView({ id, data, selected }: NodeProps<LayerFlowNode>) {
  const { actions } = usePatchEditor();
  const Icon = LAYER_ICONS[data.layerType] ?? Layers;
  return (
    <div
      className="sb-pe-node sb-pe-node--layer"
      data-kind="layer"
      data-selected={selected || undefined}
      data-issue={data.issues.length ? (data.issues.some((i) => i.severity === "error") ? "error" : "warning") : undefined}
      style={{ "--sb-cat": "var(--category-layers)" } as CSSProperties}
      aria-label={`Layer ${data.title}`}
    >
      <header
        className="sb-pe-node__header"
        onDoubleClick={(e) => {
          e.stopPropagation();
          actions.revealLayer(data.layerId);
        }}
      >
        <span className="sb-pe-node__icon" aria-hidden>
          <Icon size={11} strokeWidth={2.25} />
        </span>
        <span className="sb-pe-node__title">{data.title}</span>
        <span className="sb-pe-chip">{data.layerTypeName}</span>
        {data.issues.length > 0 && <IssueBadge issues={data.issues} />}
      </header>
      <PortRows nodeId={id} inputs={data.inputs} outputs={data.outputs} editable={false} />
    </div>
  );
});

/** Published component inputs (sources) or outputs (targets). */
export const InterfaceNodeView = memo(function InterfaceNodeView({ id, data, selected }: NodeProps<InterfaceFlowNode>) {
  return (
    <div className="sb-pe-node sb-pe-node--interface" data-kind="interface" data-selected={selected || undefined} style={{ "--sb-cat": "var(--category-components)" } as CSSProperties} aria-label={data.title}>
      <header className="sb-pe-node__header">
        <span className="sb-pe-node__icon" aria-hidden>
          <CornerDownRight size={11} strokeWidth={2.25} />
        </span>
        <span className="sb-pe-node__title">{data.title}</span>
      </header>
      <PortRows nodeId={id} inputs={data.inputs} outputs={data.outputs} editable={false} />
    </div>
  );
});

/** A comment frame: title text, resizable, colored. Only the title bar drags. */
export const CommentNodeView = memo(function CommentNodeView({ id, data, selected }: NodeProps<CommentFlowNode>) {
  const { actions, ui } = usePatchEditor();
  const editing = useUi((s) => s.editingTitle === id);
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={80}
        handleClassName="sb-pe-resize-handle"
        lineClassName="sb-pe-resize-line"
        onResizeEnd={(_, p) => actions.updateComment(data.commentId, { rect: [p.x, p.y, p.width, p.height] }, "Resize comment")}
      />
      <div className="sb-pe-comment" data-color={data.color ?? "gray"} data-selected={selected || undefined} aria-label={`Comment: ${data.text}`}>
        <div
          className="sb-pe-comment__title"
          onDoubleClick={(e) => {
            e.stopPropagation();
            ui.getState().set({ editingTitle: id });
          }}
        >
          {editing ? (
            <TitleInput
              initial={data.text}
              multiline
              ariaLabel="Comment text"
              onCommit={(v) => {
                ui.getState().set({ editingTitle: null });
                actions.updateComment(data.commentId, { text: v.trim() || "Comment" }, "Edit comment");
              }}
              onCancel={() => ui.getState().set({ editingTitle: null })}
            />
          ) : (
            <span className="sb-pe-comment__text">{data.text}</span>
          )}
        </div>
      </div>
    </>
  );
});
