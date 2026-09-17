import { ChevronRight } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./lib/cx.ts";
import { useControllableState, useLatest } from "./lib/hooks.ts";
import { observeResize } from "./lib/observeResize.ts";
import {
  findTreeNode,
  flattenTree,
  getAncestorIds,
  placementFromOffset,
  resolveDropTarget,
  type FlatTreeRow,
  type TreeDropTarget,
  type TreeNodeLike,
} from "./lib/treeModel.ts";
import "./TreeView.css";

export interface TreeRowState {
  depth: number;
  selected: boolean;
  focused: boolean;
  expanded: boolean;
  hasChildren: boolean;
  renaming: boolean;
  dragging: boolean;
}

export interface TreeViewProps<T extends TreeNodeLike<T>> {
  nodes: readonly T[];
  getLabel: (node: T) => string;
  "aria-label": string;
  expanded?: ReadonlySet<string>;
  defaultExpanded?: Iterable<string>;
  onExpandedChange?: (expanded: Set<string>) => void;
  selected?: ReadonlySet<string>;
  defaultSelected?: Iterable<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  /** Enables rename (Enter, F2, double-click the label). */
  onRename?: (id: string, name: string) => void;
  /** Enables drag reorder. `target.index` refers to the parent's children before removal. */
  onMove?: (ids: string[], target: { parentId: string | null; index: number }) => void;
  /** Double-click outside the label (or Enter when rename is off). */
  onActivate?: (node: T) => void;
  onRowContextMenu?: (node: T, event: MouseEvent<HTMLDivElement>) => void;
  canHaveChildren?: (node: T) => boolean;
  canDrag?: (node: T) => boolean;
  renderIcon?: (node: T, state: TreeRowState) => ReactNode;
  /** Buttons revealed on hover or focus (Touch, visibility, lock). */
  renderActions?: (node: T, state: TreeRowState) => ReactNode;
  /** Always-visible status icons (e.g. a lock when locked). */
  renderTrailing?: (node: T, state: TreeRowState) => ReactNode;
  /** Dim a row (hidden layers). */
  isDimmed?: (node: T) => boolean;
  /** Extra data attributes on a row's element, such as drop-target markers other panels look for. */
  getRowProps?: (node: T) => Readonly<Record<`data-${string}`, string>> | undefined;
  rowHeight?: number;
  indent?: number;
  /** Row count above which only visible rows render. */
  virtualizeThreshold?: number;
  emptyState?: ReactNode;
  className?: string;
}

interface Press {
  pointerId: number;
  rowId: string;
  startX: number;
  startY: number;
  draggable: boolean;
  active: boolean;
  ids: string[];
  deferredSelect: boolean;
}

const OVERSCAN = 6;
const DRAG_THRESHOLD = 4;

function sameTarget(a: TreeDropTarget | null, b: TreeDropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.parentId === b.parentId && a.index === b.index && a.rowId === b.rowId && a.placement === b.placement && a.depth === b.depth;
}

function subtreeIds<T extends TreeNodeLike<T>>(nodes: readonly T[], id: string): string[] {
  const node = findTreeNode(nodes, id);
  if (!node) return [id];
  const out: string[] = [];
  const visit = (n: T) => {
    out.push(n.id);
    n.children?.forEach(visit);
  };
  visit(node);
  return out;
}

/**
 * Hierarchical list for layers and outlines: multi-select (Shift / ⌘), keyboard navigation,
 * expand/collapse (⌥ for recursive), inline rename, drag reorder with nesting, and windowed
 * rendering for large trees.
 */
export function TreeView<T extends TreeNodeLike<T>>({
  nodes,
  getLabel,
  "aria-label": ariaLabel,
  expanded: controlledExpanded,
  defaultExpanded,
  onExpandedChange,
  selected: controlledSelected,
  defaultSelected,
  onSelectedChange,
  onRename,
  onMove,
  onActivate,
  onRowContextMenu,
  canHaveChildren,
  canDrag,
  renderIcon,
  renderActions,
  renderTrailing,
  isDimmed,
  getRowProps,
  rowHeight = 26,
  indent = 14,
  virtualizeThreshold = 150,
  emptyState,
  className,
}: TreeViewProps<T>) {
  const baseId = useId();
  const [expanded, setExpanded] = useControllableState<ReadonlySet<string>>(
    controlledExpanded,
    () => new Set(defaultExpanded ?? []),
    onExpandedChange ? (next) => onExpandedChange(new Set(next)) : undefined,
  );
  const [selected, setSelected] = useControllableState<ReadonlySet<string>>(
    controlledSelected,
    () => new Set(defaultSelected ?? []),
    onSelectedChange ? (next) => onSelectedChange(new Set(next)) : undefined,
  );
  const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);
  const indexById = useMemo(() => new Map(rows.map((row, i) => [row.id, i])), [rows]);
  const latestRows = useLatest(rows);

  const containerRef = useRef<HTMLDivElement>(null);
  const anchorId = useRef<string | null>(null);
  const press = useRef<Press | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ ids: string[]; target: TreeDropTarget | null } | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewport((v) => (v.height === el.clientHeight && v.top === el.scrollTop ? v : { top: el.scrollTop, height: el.clientHeight }));
    measure();
    return observeResize([el], measure);
  }, []);

  const virtual = rows.length > virtualizeThreshold;
  const first = virtual ? Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN) : 0;
  const last = virtual ? Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN) : rows.length;
  const focusedIndex = focusedId !== null ? (indexById.get(focusedId) ?? -1) : -1;
  const rowDomId = (id: string) => `${baseId}-row-${id}`;

  const toggleExpanded = (id: string, open?: boolean, recursive = false) => {
    const next = new Set(expanded);
    const shouldOpen = open ?? !next.has(id);
    for (const target of recursive ? subtreeIds(nodes, id) : [id]) {
      if (shouldOpen) next.add(target);
      else next.delete(target);
    }
    setExpanded(next);
    if (!shouldOpen && focusedId !== null && getAncestorIds(nodes, focusedId)?.includes(id)) setFocusedId(id);
  };

  const selectOnly = (id: string) => {
    anchorId.current = id;
    setSelected(new Set([id]));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    anchorId.current = id;
    setSelected(next);
  };

  const selectRange = (id: string) => {
    const from = anchorId.current !== null ? indexById.get(anchorId.current) : undefined;
    const to = indexById.get(id);
    if (from === undefined || to === undefined) {
      selectOnly(id);
      return;
    }
    const [lo, hi] = from < to ? [from, to] : [to, from];
    setSelected(new Set(rows.slice(lo, hi + 1).map((r) => r.id)));
  };

  const scrollToIndex = (index: number) => {
    const el = containerRef.current;
    if (!el) return;
    const top = index * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
  };

  const moveFocus = (index: number, extend: boolean) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[clamped];
    if (!row) return;
    setFocusedId(row.id);
    if (extend) selectRange(row.id);
    else selectOnly(row.id);
    scrollToIndex(clamped);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== containerRef.current) return;
    if (drag && event.key === "Escape") {
      press.current = null;
      setDrag(null);
      event.preventDefault();
      return;
    }
    const index = focusedIndex >= 0 ? focusedIndex : 0;
    const row = rows[index];
    if (!row) return;
    const mod = event.metaKey || event.ctrlKey;
    switch (event.key) {
      case "ArrowDown":
        moveFocus(focusedIndex < 0 ? 0 : index + 1, event.shiftKey);
        break;
      case "ArrowUp":
        moveFocus(focusedIndex < 0 ? 0 : index - 1, event.shiftKey);
        break;
      case "Home":
        moveFocus(0, event.shiftKey);
        break;
      case "End":
        moveFocus(rows.length - 1, event.shiftKey);
        break;
      case "ArrowRight":
        if (row.hasChildren && !row.expanded) toggleExpanded(row.id, true, event.altKey);
        else if (row.expanded) moveFocus(index + 1, false);
        else return;
        break;
      case "ArrowLeft":
        if (row.expanded) toggleExpanded(row.id, false, event.altKey);
        else if (row.parentId !== null) moveFocus(indexById.get(row.parentId) ?? index, false);
        else return;
        break;
      case "Enter":
      case "F2":
        if (onRename) setRenamingId(row.id);
        else if (onActivate) onActivate(row.node);
        else return;
        break;
      case " ":
        if (mod) toggleOne(row.id);
        else selectOnly(row.id);
        break;
      case "a":
        if (!mod) return;
        setSelected(new Set(rows.map((r) => r.id)));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onRowPointerDown = (event: PointerEvent<HTMLDivElement>, row: FlatTreeRow<T>) => {
    if (event.button !== 0 || renamingId === row.id) return;
    containerRef.current?.focus({ preventScroll: true });
    setFocusedId(row.id);
    const mod = event.metaKey || event.ctrlKey;
    let deferredSelect = false;
    if (event.shiftKey) selectRange(row.id);
    else if (mod) toggleOne(row.id);
    else if (!selected.has(row.id)) selectOnly(row.id);
    else deferredSelect = true;
    const ids = !mod && !event.shiftKey && selected.has(row.id) ? rows.filter((r) => selected.has(r.id)).map((r) => r.id) : [row.id];
    press.current = {
      pointerId: event.pointerId,
      rowId: row.id,
      startX: event.clientX,
      startY: event.clientY,
      draggable: !!onMove && (canDrag?.(row.node) ?? true),
      active: false,
      ids,
      deferredSelect,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    const el = containerRef.current;
    if (!p || !el || p.pointerId !== event.pointerId || !p.draggable) return;
    if (!p.active) {
      if (Math.hypot(event.clientX - p.startX, event.clientY - p.startY) < DRAG_THRESHOLD) return;
      p.active = true;
      el.setPointerCapture(event.pointerId);
    }
    const rect = el.getBoundingClientRect();
    if (event.clientY < rect.top + 20) el.scrollTop -= 6;
    else if (event.clientY > rect.bottom - 20) el.scrollTop += 6;
    const y = event.clientY - rect.top + el.scrollTop;
    const current = latestRows.current;
    const dragged = new Set(p.ids);
    let target: TreeDropTarget | null = null;
    if (y >= current.length * rowHeight) {
      const lastRow = current[current.length - 1];
      if (lastRow) target = { parentId: null, index: nodes.length, rowId: lastRow.id, placement: "after", depth: 0 };
    } else {
      const index = Math.max(0, Math.floor(y / rowHeight));
      const row = current[index];
      if (row) {
        const fraction = (y - index * rowHeight) / rowHeight;
        target = resolveDropTarget(current, index, placementFromOffset(fraction, canHaveChildren?.(row.node) ?? false), dragged);
      }
    }
    setDrag((prev) => (prev && sameTarget(prev.target, target) ? prev : { ids: p.ids, target }));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== event.pointerId) return;
    press.current = null;
    if (p.active) {
      const target = drag?.target ?? null;
      setDrag(null);
      if (target && onMove) {
        onMove(p.ids, { parentId: target.parentId, index: target.index });
        if (target.placement === "inside" && target.parentId !== null && !expanded.has(target.parentId)) toggleExpanded(target.parentId, true);
      }
    } else if (p.deferredSelect) {
      selectOnly(p.rowId);
    }
  };

  let indicator: ReactNode = null;
  if (drag?.target) {
    const t = drag.target;
    const rowIndex = indexById.get(t.rowId) ?? 0;
    if (t.placement === "inside") {
      indicator = <div className="sb-tree__drop" data-kind="inside" style={{ top: rowIndex * rowHeight, height: rowHeight }} />;
    } else {
      const y = t.placement === "before" ? rowIndex * rowHeight : (rowIndex + 1) * rowHeight;
      indicator = <div className="sb-tree__drop" data-kind="line" style={{ top: y - 1, left: 14 + t.depth * indent }} />;
    }
  }

  const visibleRows = rows.slice(first, last).map((row, offset) => {
    const index = first + offset;
    const isSelected = selected.has(row.id);
    const state: TreeRowState = {
      depth: row.depth,
      selected: isSelected,
      focused: focusedId === row.id,
      expanded: row.expanded,
      hasChildren: row.hasChildren,
      renaming: renamingId === row.id,
      dragging: !!drag?.ids.includes(row.id),
    };
    const label = getLabel(row.node);
    return (
      <div
        {...getRowProps?.(row.node)}
        key={row.id}
        id={rowDomId(row.id)}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-setsize={row.setSize}
        aria-posinset={row.index + 1}
        aria-expanded={row.hasChildren ? row.expanded : undefined}
        aria-selected={isSelected}
        className="sb-tree__row"
        data-selected={isSelected || undefined}
        data-focused={state.focused || undefined}
        data-dimmed={isDimmed?.(row.node) || undefined}
        data-dragging={state.dragging || undefined}
        style={{ transform: `translateY(${index * rowHeight}px)`, height: rowHeight } as CSSProperties}
        onPointerDown={(event) => onRowPointerDown(event, row)}
        onDoubleClick={(event) => {
          const target = event.target as Element;
          if (onRename && target.closest(".sb-tree__label")) setRenamingId(row.id);
          else onActivate?.(row.node);
        }}
        onContextMenu={(event) => {
          if (!selected.has(row.id)) selectOnly(row.id);
          setFocusedId(row.id);
          onRowContextMenu?.(row.node, event);
        }}
      >
        <span className="sb-tree__indent" style={{ width: row.depth * indent }} aria-hidden />
        <span
          className="sb-tree__chevron"
          data-visible={row.hasChildren || undefined}
          data-expanded={row.expanded || undefined}
          aria-hidden
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (row.hasChildren) toggleExpanded(row.id, undefined, event.altKey);
          }}
        >
          {row.hasChildren && <ChevronRight size={12} strokeWidth={2} />}
        </span>
        {renderIcon && (
          <span className="sb-tree__icon" aria-hidden>
            {renderIcon(row.node, state)}
          </span>
        )}
        {state.renaming ? (
          <RenameInput
            initial={label}
            onDone={(name) => {
              setRenamingId(null);
              containerRef.current?.focus({ preventScroll: true });
              if (name !== null && name !== label) onRename?.(row.id, name);
            }}
          />
        ) : (
          <span className="sb-tree__label">{label}</span>
        )}
        {renderTrailing && (
          <span className="sb-tree__trailing" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            {renderTrailing(row.node, state)}
          </span>
        )}
        {renderActions && !state.renaming && (
          <span className="sb-tree__actions" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            {renderActions(row.node, state)}
          </span>
        )}
      </div>
    );
  });

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label={ariaLabel}
      aria-multiselectable="true"
      aria-activedescendant={focusedId !== null && focusedIndex >= first && focusedIndex < last ? rowDomId(focusedId) : undefined}
      tabIndex={0}
      className={cx("sb-tree sb-scroll", className)}
      data-dragging={drag ? "" : undefined}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        if (!virtual) return;
        const top = event.currentTarget.scrollTop;
        setViewport((v) => (v.top === top ? v : { ...v, top }));
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
        setDrag(null);
      }}
      onFocus={(event) => {
        if (event.target !== event.currentTarget || focusedId !== null || rows.length === 0) return;
        setFocusedId((rows.find((r) => selected.has(r.id)) ?? rows[0]!).id);
      }}
    >
      {rows.length === 0 ? (
        emptyState
      ) : (
        <div className="sb-tree__canvas" style={{ height: rows.length * rowHeight }}>
          {visibleRows}
          {indicator}
        </div>
      )}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value.trim() ?? "";
    onDone(commit && value ? value : null);
  };
  return (
    <input
      ref={ref}
      className="sb-tree__rename"
      defaultValue={initial}
      aria-label="Rename"
      spellCheck={false}
      autoComplete="off"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  );
}
