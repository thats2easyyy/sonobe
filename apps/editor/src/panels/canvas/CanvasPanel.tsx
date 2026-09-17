/**
 * The Canvas panel: an editable artboard of the component being edited. Click to select (⇧ adds,
 * ⌘ selects deep), marquee, drag to move with snapping and smart guides (hold ⌘ to skip snapping),
 * resize (⇧ keeps proportions, ⌥ from center), rotate, nudge with arrows (⇧ ×10), draw rectangles
 * (R), ovals (O), and text (T), double-click to edit text or go into a group, zoom (⌘ scroll or
 * pinch) and pan (scroll, space-drag). Every gesture is one undo entry; layout children reorder.
 */

import type { Id, Op } from "@sonobe/core";
import type { SceneFrame } from "@sonobe/engine";
import { createDomRenderer, DomTextMeasurer, type DomRenderer } from "@sonobe/renderer";
import { ChevronDown, Circle, Group, MousePointer2, Square, Type } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useStore } from "zustand";
import { Panel } from "../../shell/Panel.tsx";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { topLevelLayerIds } from "../../state/clipboard.ts";
import { enterSelectedComponent, groupSelection } from "../../state/editActions.ts";
import { currentComponentId } from "../../state/selection.ts";
import type { EditorSession } from "../../state/session.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu, type MenuEntry } from "../../ui/Menu.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { toast } from "../../ui/Toast.tsx";
import { useOptionalCommands } from "../../ui/commands/CommandProvider.tsx";
import type { Command } from "../../ui/commands/commandRegistry.ts";
import { isEditableTarget, type ShortcutBinding } from "../../ui/commands/shortcutManager.ts";
import { cx } from "../../ui/lib/cx.ts";
import { useLatest } from "../../ui/lib/hooks.ts";
import { useElementSize } from "../../ui/lib/useElementSize.ts";
import { CanvasOverlay, EMPTY_DRAFT, type OverlayDraft } from "./CanvasOverlay.tsx";
import { createEditTransaction, type EditTransaction } from "./editTransaction.ts";
import { pointInQuad, rectFromPoints, unionRects, type Point, type Rect } from "./geometry.ts";
import {
  beginMove,
  beginReorder,
  beginResize,
  beginRotate,
  insertGesture,
  isPropLinked,
  moveGesture,
  nudgeGesture,
  nudgeReorder,
  nudgeStarts,
  reorderGesture,
  resizeGesture,
  rotateGesture,
  type MoveSnapshot,
  type ReorderSnapshot,
  type ResizeSnapshot,
  type RotateSnapshot,
} from "./gestures.ts";
import { hitChrome, resizeCursor, ROTATE_CURSOR, selectionChrome } from "./handles.ts";
import { InlineTextEditor } from "./InlineTextEditor.tsx";
import { nudgeDelta, textOps, type ArrowKey, type InsertTool } from "./ops.ts";
import { buildCanvasIndex, hitLayers, isEditableLayer, marqueeLayers, pickChildOf, pickLayer, type CanvasIndex } from "./sceneIndex.ts";
import { measureBetween, type Measurement } from "./snapping.ts";
import { useCanvasScene, type SceneSource } from "./useCanvasScene.ts";
import { ensureVisible, fitRect, formatZoom, nextZoomStep, panBy, screenToArtboard, wheelZoom, zoomAt, type Viewport } from "./viewport.ts";
import "./canvas.css";

export type CanvasTool = "select" | InsertTool;

export interface CanvasPanelProps {
  /** Default: the session from the nearest EditorProvider. */
  session?: EditorSession;
  /** "design": the component at frame 0. "live": the running prototype's frame (root component only). Uncontrolled by default. */
  sceneSource?: SceneSource;
  onSceneSourceChange?: (source: SceneSource) => void;
  /** Register canvas.* commands and canvas-scoped shortcuts. Default true. */
  commands?: boolean;
  className?: string;
}

const DRAG_THRESHOLD = 3;
const SNAP_PX = 6;
const NUDGE_IDLE_MS = 900;
const TOOL_LABELS: Record<InsertTool, string> = { rectangle: "Rectangle", oval: "Oval", text: "Text" };

interface GestureBase {
  pointerId: number;
  /** Artboard point where the press began. */
  start: Point;
  startScreen: Point;
}

type Gesture =
  | (GestureBase & { kind: "press"; picked: Id | null; wasSelected: boolean; shift: boolean })
  | (GestureBase & { kind: "move"; snapshot: MoveSnapshot; txn: EditTransaction })
  | (GestureBase & { kind: "resize"; snapshot: ResizeSnapshot; txn: EditTransaction })
  | (GestureBase & { kind: "rotate"; snapshot: RotateSnapshot; txn: EditTransaction })
  | (GestureBase & { kind: "reorder"; snapshot: ReorderSnapshot; ops: Op[] })
  | (GestureBase & { kind: "marquee"; base: Id[]; active: boolean })
  | (GestureBase & { kind: "insert"; tool: InsertTool; moved: boolean })
  | (GestureBase & { kind: "pan"; startViewport: Viewport });

interface TextEditState {
  id: Id;
  initial: string;
  selectAll: boolean;
  /** The insert that created this layer, so an unchanged or emptied new layer folds back into one undo entry. */
  insert: { ops: Op[]; txnId: string | null } | null;
}

interface NudgeRun {
  key: string;
  txn: EditTransaction;
  starts: Map<Id, Point>;
  delta: Point;
  timer: ReturnType<typeof setTimeout> | undefined;
}

function layerNames(index: CanvasIndex, ids: readonly Id[]): string {
  if (ids.length !== 1) return `${ids.length} layers`;
  return index.entry(ids[0]!)?.layer.name ?? ids[0]!;
}

const fmtAngle = (deg: number) => `${Math.round(deg * 10) / 10}°`;

/** addLayer ops with the inserted text replaced. */
function withInsertedText(ops: readonly Op[], text: string): Op[] {
  return ops.map((op) => (op.op === "addLayer" ? { ...op, layer: { ...op.layer, props: { ...op.layer.props, text } } } : op));
}

function ArtboardRenderer({ session, scene, viewport, size, rendererRef }: { session: EditorSession; scene: SceneFrame | null; viewport: Viewport; size: [number, number]; rendererRef: RefObject<DomRenderer | null> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const zoom = useLatest(viewport.zoom);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measurer = session.runtime.textMeasurer instanceof DomTextMeasurer ? session.runtime.textMeasurer : undefined;
    const renderer = createDomRenderer(host, {
      resolveAssetUrl: (assetId) => session.resolveAssetUrl(assetId),
      editorMode: true,
      captureInput: false,
      scale: zoom.current,
      ...(measurer ? { textMeasurer: measurer } : {}),
    });
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [session, rendererRef, zoom]);

  useLayoutEffect(() => {
    rendererRef.current?.setScale(viewport.zoom);
  }, [viewport.zoom, rendererRef]);

  useLayoutEffect(() => {
    if (scene) rendererRef.current?.render(scene);
  }, [scene, rendererRef]);

  return <div ref={hostRef} className="sb-cv__artboard" tabIndex={-1} style={{ transform: `translate(${Math.round(viewport.x)}px, ${Math.round(viewport.y)}px)`, width: size[0] * viewport.zoom, height: size[1] * viewport.zoom }} />;
}

export function CanvasPanel({ session: sessionProp, sceneSource, onSceneSourceChange, commands = true, className }: CanvasPanelProps) {
  const contextSession = useEditorSession();
  const session = sessionProp ?? contextSession;
  const componentId = useStore(session.selection, currentComponentId);
  const component = useStore(session.document, (s) => s.doc.components[componentId]);
  const rootId = useStore(session.document, (s) => s.doc.project.root);
  const selected = useStore(session.selection, (s) => s.layers);
  const hovered = useStore(session.selection, (s) => s.hovered);
  const reveal = useStore(session.selection, (s) => s.reveal);

  const [internalSource, setInternalSource] = useState<SceneSource>("design");
  const source = sceneSource ?? internalSource;
  const setSource = (next: SceneSource) => {
    if (sceneSource === undefined) setInternalSource(next);
    onSceneSourceChange?.(next);
  };
  const { scene, size, live } = useCanvasScene(session, componentId, source);
  const index = useMemo(() => buildCanvasIndex(component, scene), [component, scene]);
  const artboard = useMemo<Rect>(() => ({ x: 0, y: 0, width: size[0], height: size[1] }), [size]);

  const [tool, setTool] = useState<CanvasTool>("select");
  const [bodyRef, box] = useElementSize<HTMLDivElement>();
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [draft, setDraft] = useState<OverlayDraft>(EMPTY_DRAFT);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [editing, setEditing] = useState<TextEditState | null>(null);
  const [altMeasure, setAltMeasure] = useState<Measurement[]>([]);
  const rendererRef = useRef<DomRenderer | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const nudgeRef = useRef<NudgeRun | null>(null);
  const viewportComponent = useRef<Id | null>(null);
  const pointerInside = useRef(false);
  const lastPointer = useRef<{ screen: Point; artboard: Point } | null>(null);

  const selectionIds = useMemo(() => (component ? topLevelLayerIds(component, selected) : []), [component, selected]);
  const chromeEditable = selectionIds.length > 0 && selectionIds.every((id) => isEditableLayer(index, id));
  const chrome = useMemo(
    () => (viewport && !editing ? selectionChrome(index, selectionIds, viewport, { resizable: chromeEditable, rotatable: chromeEditable && selectionIds.length === 1 }) : null),
    [index, selectionIds, viewport, chromeEditable, editing],
  );
  const hoverId = hovered && hovered.kind === "layer" && hovered.component === componentId ? hovered.id : null;

  const latest = useLatest({ index, viewport, componentId, component, tool, artboard, chrome, spaceHeld, box, editing });

  const fitViewport = useCallback((): Viewport | null => (box.width > 0 && box.height > 0 ? fitRect(artboard, [box.width, box.height], { padding: 56, maxZoom: 1 }) : null), [artboard, box.width, box.height]);

  // Restore (or fit) the viewport when the component changes or the panel first gets a size.
  useEffect(() => {
    if (box.width === 0 || box.height === 0) return;
    if (viewportComponent.current === componentId && viewport) return;
    viewportComponent.current = componentId;
    setViewport(session.selection.getState().canvasViewports[componentId] ?? fitViewport());
  }, [componentId, box.width, box.height, viewport, fitViewport, session]);

  // Remember the viewport per component.
  useEffect(() => {
    if (!viewport) return;
    const timer = setTimeout(() => session.selection.getState().setCanvasViewport(componentId, viewport), 250);
    return () => clearTimeout(timer);
  }, [viewport, componentId, session]);

  const apply = (ops: Op[], label: string) => session.document.getState().apply(ops, { label, defaultComponent: latest.current.componentId });

  const notifyBlocked = (ids: readonly Id[], prop = "position") => {
    if (ids.length === 0) return;
    toast({ title: `${layerNames(latest.current.index, ids)} ${ids.length === 1 ? "is" : "are"} driven by a patch`, description: `Its ${prop} is linked. Disconnect the link in the Inspector to edit it by hand.`, tone: "info" });
  };

  const finishNudge = useCallback(() => {
    const run = nudgeRef.current;
    if (!run) return;
    if (run.timer !== undefined) clearTimeout(run.timer);
    run.txn.commit();
    nudgeRef.current = null;
  }, []);

  useEffect(() => () => finishNudge(), [finishNudge]);

  const currentSelection = () => {
    const { component: c, index: idx } = latest.current;
    return c ? topLevelLayerIds(c, session.selection.getState().layers).filter((id) => isEditableLayer(idx, id)) : [];
  };

  const setHover = (id: Id | null) => {
    const s = session.selection.getState();
    if (id) s.setHovered({ kind: "layer", id, component: latest.current.componentId, source: "canvas" });
    else if (s.hovered?.source === "canvas") s.setHovered(null);
  };

  const screenPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = bodyRef.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const snapThreshold = () => SNAP_PX / (latest.current.viewport?.zoom ?? 1);

  const refreshAltMeasure = (alt: boolean) => {
    const { chrome: c, index: idx, artboard: board } = latest.current;
    const pointer = lastPointer.current;
    if (!alt || !c || !pointer) {
      setAltMeasure((m) => (m.length ? [] : m));
      return;
    }
    const picked = pickLayer(hitLayers(idx, pointer.artboard), idx, session.selection.getState().layers, false);
    const target = picked && !session.selection.getState().layers.includes(picked) ? idx.bounds(picked) : board;
    setAltMeasure(target ? measureBetween(c.bounds, target) : []);
  };

  const updateHover = (p: Point, a: Point, modifiers: { alt: boolean; deep: boolean }) => {
    const { tool: currentTool, chrome: c, index: idx } = latest.current;
    if (currentTool !== "select") {
      setCursor(undefined);
      setHover(null);
      return;
    }
    if (latest.current.spaceHeld) {
      setCursor("grab");
      return;
    }
    const hit = c ? hitChrome(c, p) : null;
    if (hit) {
      setCursor(hit.kind === "rotate" ? ROTATE_CURSOR : resizeCursor(hit.handle, c!.angle));
      setHover(null);
      return;
    }
    setCursor(undefined);
    setHover(pickLayer(hitLayers(idx, a), idx, session.selection.getState().layers, modifiers.deep));
    refreshAltMeasure(modifiers.alt);
  };

  const startTextEdit = (id: Id, options: { selectAll?: boolean; insert?: TextEditState["insert"] } = {}) => {
    const idx = latest.current.index;
    const entry = idx.entry(id);
    if (!entry?.node || entry.layer.type !== "text") return;
    if (isPropLinked(idx, id, "text")) {
      notifyBlocked([id], "text");
      return;
    }
    finishNudge();
    setEditing({ id, initial: typeof entry.node.props.text === "string" ? entry.node.props.text : "", selectAll: options.selectAll ?? false, insert: options.insert ?? null });
  };

  const commitText = (text: string) => {
    const state = latest.current.editing;
    setEditing(null);
    if (!state) return;
    const { componentId: cid } = latest.current;
    const doc = session.document.getState();
    const insertOnTop = state.insert?.txnId && doc.historyEntries(1)[0]?.txnId === state.insert.txnId;
    if (state.insert && insertOnTop) {
      if (text === state.initial) return;
      doc.undo();
      if (text === "") return;
      const result = apply(withInsertedText(state.insert.ops, text), "Insert Text");
      const id = result.idMap.inserted;
      if (id) session.selection.getState().select({ layers: [id], patches: [], comments: [] });
      return;
    }
    if (text === state.initial) return;
    if (text === "") apply([{ op: "removeLayer", component: cid, id: state.id }], "Delete empty text");
    else apply(textOps(cid, state.id, text), "Edit text");
  };

  // Hide the rendered text while its editor is open.
  useLayoutEffect(() => {
    if (!editing) return;
    const key = index.entry(editing.id)?.node?.key;
    const el = key ? rendererRef.current?.elementForKey(key) : undefined;
    if (!el) return;
    const previous = el.style.visibility;
    el.style.visibility = "hidden";
    return () => {
      el.style.visibility = previous;
    };
  }, [editing, index]);

  const cancelGesture = () => {
    const g = gestureRef.current;
    if (!g) return false;
    gestureRef.current = null;
    if (g.kind === "move" || g.kind === "resize" || g.kind === "rotate") g.txn.cancel();
    try {
      bodyRef.current?.releasePointerCapture(g.pointerId);
    } catch {
      // The pointer may already be released.
    }
    setDraft(EMPTY_DRAFT);
    setCursor(undefined);
    return true;
  };

  const startDrag = (g: Extract<Gesture, { kind: "press" }>) => {
    const { index: idx, componentId: cid, artboard: board } = latest.current;
    const ids = currentSelection();
    if (ids.length === 0) {
      gestureRef.current = null;
      return;
    }
    if (ids.length === 1) {
      const reorder = beginReorder(idx, cid, ids[0]!);
      if (reorder) {
        gestureRef.current = { ...g, kind: "reorder", snapshot: reorder, ops: [] };
        return;
      }
    }
    const snapshot = beginMove(idx, cid, ids, board);
    notifyBlocked(snapshot.blocked);
    if (!("componentId" in snapshot)) {
      gestureRef.current = null;
      return;
    }
    gestureRef.current = { ...g, kind: "move", snapshot, txn: createEditTransaction(session.document, { label: `Move ${layerNames(idx, snapshot.layers.map((l) => l.id))}`, defaultComponent: cid }) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { viewport: vp, index: idx, componentId: cid, artboard: board, chrome: c, tool: currentTool } = latest.current;
    if (!vp || (event.target as Element).closest?.(".sb-cv__text-editor")) return;
    const p = screenPoint(event);
    const a = screenToArtboard(vp, p);
    const base: GestureBase = { pointerId: event.pointerId, start: a, startScreen: p };
    bodyRef.current?.focus({ preventScroll: true });
    finishNudge();
    setAltMeasure([]);

    if (event.button === 1 || (event.button === 0 && latest.current.spaceHeld)) {
      event.preventDefault();
      gestureRef.current = { ...base, kind: "pan", startViewport: vp };
      setCursor("grabbing");
    } else if (event.button !== 0) {
      return;
    } else if (currentTool !== "select") {
      gestureRef.current = { ...base, kind: "insert", tool: currentTool, moved: false };
    } else {
      const hit = c ? hitChrome(c, p) : null;
      const ids = currentSelection();
      if (hit?.kind === "resize") {
        const snapshot = beginResize(idx, cid, ids, hit.handle, board);
        if (snapshot) {
          notifyBlocked(snapshot.blocked, "size");
          gestureRef.current = { ...base, kind: "resize", snapshot, txn: createEditTransaction(session.document, { label: `Resize ${layerNames(idx, snapshot.members.map((m) => m.id))}`, defaultComponent: cid }) };
        } else {
          notifyBlocked(ids, "size");
        }
      } else if (hit?.kind === "rotate" && c?.single) {
        const snapshot = beginRotate(idx, cid, c.single);
        if (snapshot) gestureRef.current = { ...base, kind: "rotate", snapshot, txn: createEditTransaction(session.document, { label: `Rotate ${layerNames(idx, [c.single])}`, defaultComponent: cid }) };
        else notifyBlocked([c.single], "rotation");
      } else {
        const sel = session.selection.getState();
        const picked = pickLayer(hitLayers(idx, a), idx, sel.layers, event.metaKey || event.ctrlKey);
        if (picked) {
          const wasSelected = sel.layers.includes(picked);
          if (event.shiftKey) sel.select({ layers: [picked] }, "toggle");
          else if (!wasSelected) sel.select({ layers: [picked], patches: [], comments: [] });
          gestureRef.current = { ...base, kind: "press", picked, wasSelected, shift: event.shiftKey };
        } else if (c && !event.shiftKey && selectionIds.length > 1 && pointInQuad(c.quad, p)) {
          gestureRef.current = { ...base, kind: "press", picked: null, wasSelected: true, shift: false };
        } else {
          const baseSelection = event.shiftKey ? [...sel.layers] : [];
          if (!event.shiftKey) sel.select({ layers: [], patches: [], comments: [] });
          gestureRef.current = { ...base, kind: "marquee", base: baseSelection, active: false };
        }
      }
    }
    if (gestureRef.current) event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { viewport: vp, index: idx, componentId: cid } = latest.current;
    if (!vp) return;
    const p = screenPoint(event);
    const a = screenToArtboard(vp, p);
    lastPointer.current = { screen: p, artboard: a };
    const g = gestureRef.current;
    if (!g || g.pointerId !== event.pointerId) {
      updateHover(p, a, { alt: event.altKey, deep: event.metaKey || event.ctrlKey });
      return;
    }
    const moved = Math.hypot(p[0] - g.startScreen[0], p[1] - g.startScreen[1]) >= DRAG_THRESHOLD;
    const snap = !(event.metaKey || event.ctrlKey);
    switch (g.kind) {
      case "pan":
        setViewport(panBy(g.startViewport, p[0] - g.startScreen[0], p[1] - g.startScreen[1]));
        break;
      case "press":
        if (moved) {
          startDrag(g);
          if (gestureRef.current && gestureRef.current.kind !== "press") onPointerMove(event);
        }
        break;
      case "move": {
        const r = moveGesture(g.snapshot, g.start, a, { snap, threshold: snapThreshold(), axisLock: event.shiftKey });
        g.txn.update(r.ops);
        setDraft({ ...EMPTY_DRAFT, guides: r.guides, measurements: r.measurements, hideChrome: true });
        setHover(null);
        break;
      }
      case "resize": {
        const r = resizeGesture(g.snapshot, g.start, a, { snap, threshold: snapThreshold(), proportional: event.shiftKey, fromCenter: event.altKey });
        g.txn.update(r.ops);
        setDraft({ ...EMPTY_DRAFT, guides: r.guides });
        break;
      }
      case "rotate": {
        const r = rotateGesture(g.snapshot, g.start, a, { snap: event.shiftKey });
        g.txn.update(r.ops);
        setDraft({ ...EMPTY_DRAFT, label: { text: fmtAngle(r.rotation), at: a } });
        break;
      }
      case "reorder": {
        const r = reorderGesture(g.snapshot, g.start, a);
        g.ops = r.ops;
        setDraft({ ...EMPTY_DRAFT, drop: { line: r.drop.line, ghost: r.ghost }, hideChrome: true });
        break;
      }
      case "marquee": {
        if (!moved && !g.active) break;
        g.active = true;
        const rect = rectFromPoints(g.start, a);
        const ids = marqueeLayers(idx, rect, { deep: event.metaKey || event.ctrlKey });
        session.selection.getState().select({ layers: [...g.base, ...ids.filter((id) => !g.base.includes(id))], patches: [], comments: [] });
        setDraft({ ...EMPTY_DRAFT, marquee: rect });
        break;
      }
      case "insert": {
        if (moved) g.moved = true;
        if (!g.moved) break;
        const r = insertGesture(idx, cid, g.tool, g.start, a, { square: event.shiftKey, fromCenter: event.altKey });
        setDraft({ ...EMPTY_DRAFT, insert: { tool: g.tool, rect: r.rect }, label: { text: `${r.rect.width} × ${r.rect.height}`, at: [r.rect.x + r.rect.width / 2, r.rect.y + r.rect.height] } });
        break;
      }
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const { viewport: vp, index: idx, componentId: cid } = latest.current;
    switch (g.kind) {
      case "press": {
        const sel = session.selection.getState();
        if (g.picked && g.wasSelected && !g.shift && sel.layers.length > 1) sel.select({ layers: [g.picked], patches: [], comments: [] });
        break;
      }
      case "move":
      case "resize":
      case "rotate":
        g.txn.commit();
        break;
      case "reorder":
        if (g.ops.length) apply(g.ops, `Reorder ${layerNames(idx, [g.snapshot.id])}`);
        break;
      case "insert": {
        if (!vp) break;
        const a = screenToArtboard(vp, screenPoint(event));
        const r = insertGesture(idx, cid, g.tool, g.start, a, { click: !g.moved, square: event.shiftKey, fromCenter: event.altKey });
        const result = apply(r.ops, `Insert ${TOOL_LABELS[g.tool]}`);
        setTool("select");
        if (!result.ok) {
          toast({ title: result.errors[0]?.message ?? "Couldn't add the layer", tone: "warn" });
          break;
        }
        const id = result.idMap.inserted;
        if (!id) break;
        session.selection.getState().select({ layers: [id], patches: [], comments: [] });
        if (g.tool === "text") {
          const txnId = session.document.getState().lastChange?.txnId ?? null;
          // The new layer is drawn after this render; open the editor once it's in the scene.
          requestAnimationFrame(() => startTextEdit(id, { selectAll: true, insert: { ops: r.ops, txnId } }));
        }
        break;
      }
      default:
        break;
    }
    setDraft(EMPTY_DRAFT);
    setCursor(undefined);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId === event.pointerId) cancelGesture();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const { viewport: vp, index: idx, tool: currentTool } = latest.current;
    if (currentTool !== "select" || !vp) return;
    const chain = hitLayers(idx, screenToArtboard(vp, screenPoint(event)));
    const sel = session.selection.getState();
    const current = sel.layers.length === 1 ? sel.layers[0]! : null;
    const target = current && chain.includes(current) ? current : pickLayer(chain, idx, sel.layers, false);
    if (!target) return;
    const entry = idx.entry(target);
    if (!entry) return;
    if (entry.layer.type === "text") {
      startTextEdit(target);
    } else if (entry.layer.type === "componentInstance") {
      sel.select({ layers: [target], patches: [], comments: [] });
      enterSelectedComponent(session);
    } else {
      const child = pickChildOf(chain, idx, target);
      if (child) sel.select({ layers: [child], patches: [], comments: [] });
    }
  };

  const onPointerLeave = () => {
    pointerInside.current = false;
    if (!gestureRef.current) {
      setHover(null);
      setAltMeasure([]);
    }
  };

  // Wheel: scroll pans, ⌘/Ctrl-scroll and pinch zoom about the pointer.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const vp = latest.current.viewport;
      if (!vp) return;
      const rect = el.getBoundingClientRect();
      const p: Point = [event.clientX - rect.left, event.clientY - rect.top];
      if (event.ctrlKey || event.metaKey) {
        setViewport(wheelZoom(vp, event.deltaY, p, event.deltaMode));
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : 1;
      const horizontal = event.shiftKey && event.deltaX === 0;
      setViewport(panBy(vp, -(horizontal ? event.deltaY : event.deltaX) * unit, -(horizontal ? 0 : event.deltaY) * unit));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bodyRef, latest]);

  // Space-drag pans; ⌥ shows distances.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!pointerInside.current || isEditableTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) {
          setSpaceHeld(true);
          setCursor("grab");
        }
      } else if (event.key === "Alt") {
        refreshAltMeasure(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceHeld(false);
        if (!gestureRef.current) setCursor(undefined);
      } else if (event.key === "Alt") {
        setAltMeasure([]);
      }
    };
    const onBlur = () => {
      setSpaceHeld(false);
      setAltMeasure([]);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reveal requests (from diagnostics, Claude, the layers panel) scroll the layers into view.
  const revealNonce = reveal?.nonce;
  useEffect(() => {
    const r = session.selection.getState().reveal;
    const { index: idx, viewport: vp, box: size, componentId: cid } = latest.current;
    if (!r || r.component !== cid || !vp) return;
    const bounds = unionRects(r.ids.map((id) => idx.bounds(id)).filter((b): b is Rect => b !== null));
    if (bounds) setViewport(ensureVisible(vp, bounds, [size.width, size.height]));
  }, [revealNonce, session, latest]);

  const nudge = (key: ArrowKey, big: boolean): boolean => {
    const { index: idx, componentId: cid } = latest.current;
    const ids = currentSelection();
    if (ids.length === 0) return false;
    if (ids.length === 1 && idx.flowLayout(ids[0]!)) {
      const ops = nudgeReorder(idx, cid, ids[0]!, key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1);
      if (ops.length) apply(ops, `Reorder ${layerNames(idx, ids)}`);
      return true;
    }
    const runKey = `${cid}:${ids.join(",")}`;
    let run = nudgeRef.current;
    if (!run || run.key !== runKey) {
      finishNudge();
      const { starts, blocked } = nudgeStarts(idx, ids);
      notifyBlocked(blocked);
      if (starts.size === 0) return true;
      run = { key: runKey, txn: createEditTransaction(session.document, { label: `Nudge ${layerNames(idx, [...starts.keys()])}`, defaultComponent: cid }), starts, delta: [0, 0], timer: undefined };
      nudgeRef.current = run;
    }
    const [dx, dy] = nudgeDelta(key, big);
    run.delta = [run.delta[0] + dx, run.delta[1] + dy];
    run.txn.update(nudgeGesture(cid, run.starts, run.delta));
    if (run.timer !== undefined) clearTimeout(run.timer);
    run.timer = setTimeout(finishNudge, NUDGE_IDLE_MS);
    return true;
  };

  const escape = (): boolean => {
    if (cancelGesture()) return true;
    if (latest.current.tool !== "select") {
      setTool("select");
      return true;
    }
    const sel = session.selection.getState();
    if (sel.layers.length === 1) {
      const parent = latest.current.index.entry(sel.layers[0]!)?.parentId;
      if (parent) {
        sel.select({ layers: [parent], patches: [], comments: [] });
        return true;
      }
    }
    if (sel.layers.length > 0) {
      sel.clear();
      return true;
    }
    return false;
  };

  const enter = (): boolean => {
    const idx = latest.current.index;
    const ids = session.selection.getState().layers;
    if (ids.length !== 1) return false;
    const entry = idx.entry(ids[0]!);
    if (!entry) return false;
    if (entry.layer.type === "text") {
      startTextEdit(entry.id);
      return true;
    }
    if (entry.layer.type === "componentInstance") return enterSelectedComponent(session);
    const children = idx
      .children(entry.id)
      .filter((c) => !c.locked && !c.hidden && c.layer.type !== "colorFill")
      .map((c) => c.id);
    if (children.length === 0) return false;
    session.selection.getState().select({ layers: children, patches: [], comments: [] });
    return true;
  };

  const center = (): Point => [latest.current.box.width / 2, latest.current.box.height / 2];
  const zoomBy = (direction: 1 | -1) => setViewport((vp) => vp && zoomAt(vp, nextZoomStep(vp.zoom, direction), center()));
  const zoomTo = (zoom: number) => setViewport((vp) => vp && zoomAt(vp, zoom, center()));
  const zoomToFit = () => {
    const next = fitViewport();
    if (next) setViewport(next);
  };
  const zoomToSelection = () => {
    const bounds = latest.current.chrome?.bounds;
    const { box: size } = latest.current;
    if (!bounds) zoomToFit();
    else setViewport(fitRect(bounds, [size.width, size.height], { padding: 96, maxZoom: 8 }));
  };
  const group = () => {
    const result = groupSelection(session);
    if (!result.ok && result.message) toast({ title: result.message, ...(result.hint ? { description: result.hint } : {}), tone: "warn" });
  };

  const actions = useLatest({ setTool, nudge, escape, enter, zoomBy, zoomTo, zoomToFit, zoomToSelection, group });
  const cmds = useOptionalCommands();
  useEffect(() => {
    if (!commands || !cmds) return;
    const scope = "canvas";
    const bind = (binding: Omit<ShortcutBinding, "scope">) => cmds.shortcuts.bind({ ...binding, scope });
    const arrows: ArrowKey[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    const unbinds = [
      bind({ id: "canvas.escape", shortcut: "Escape", handler: () => actions.current.escape() || false }),
      bind({ id: "canvas.enter", shortcut: "Enter", handler: () => actions.current.enter() || false }),
      ...arrows.map((key) => bind({ id: `canvas.nudge.${key}`, shortcut: [key, `Shift+${key}`], allowRepeat: true, handler: (e) => actions.current.nudge(key, e.shiftKey) || false })),
      bind({ id: "canvas.group", shortcut: "Mod+G", when: () => !cmds.registry.get("layer.group"), handler: () => actions.current.group() }),
    ];
    const list: Command[] = [
      { id: "canvas.tool.select", title: "Select Tool", category: "Canvas", shortcut: "V", scope, icon: MousePointer2, keywords: ["move", "pointer", "arrow"], run: () => actions.current.setTool("select") },
      { id: "canvas.tool.rectangle", title: "Rectangle Tool", category: "Canvas", shortcut: "R", scope, icon: Square, keywords: ["shape", "box", "insert", "draw"], run: () => actions.current.setTool("rectangle") },
      { id: "canvas.tool.oval", title: "Oval Tool", category: "Canvas", shortcut: "O", scope, icon: Circle, keywords: ["circle", "ellipse", "shape", "insert", "draw"], run: () => actions.current.setTool("oval") },
      { id: "canvas.tool.text", title: "Text Tool", category: "Canvas", shortcut: "T", scope, icon: Type, keywords: ["label", "type", "insert"], run: () => actions.current.setTool("text") },
      { id: "canvas.zoomToFit", title: "Zoom Canvas to Fit", category: "Canvas", shortcut: "Shift+1", scope, keywords: ["fit", "artboard"], run: () => actions.current.zoomToFit() },
      { id: "canvas.zoomToSelection", title: "Zoom to Selection", category: "Canvas", shortcut: "Shift+2", scope, keywords: ["focus"], run: () => actions.current.zoomToSelection() },
      { id: "canvas.actualSize", title: "Canvas Actual Size", category: "Canvas", shortcut: "Shift+0", scope, keywords: ["100%", "1:1"], run: () => actions.current.zoomTo(1) },
      { id: "canvas.zoomIn", title: "Zoom Canvas In", category: "Canvas", shortcut: ["Mod+=", "Mod++"], scope, run: () => actions.current.zoomBy(1) },
      { id: "canvas.zoomOut", title: "Zoom Canvas Out", category: "Canvas", shortcut: "Mod+-", scope, run: () => actions.current.zoomBy(-1) },
    ];
    const unregister = cmds.registry.register(list.filter((c) => !cmds.registry.get(c.id)));
    return () => {
      unregister();
      for (const unbind of unbinds) unbind();
    };
  }, [cmds, commands, actions]);

  /** Keyboard handling when there's no CommandProvider. */
  const onKeyDownFallback = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target) || event.altKey) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    let handled = false;
    if (!mod && !event.shiftKey && ["v", "r", "o", "t"].includes(key.toLowerCase())) {
      const map: Record<string, CanvasTool> = { v: "select", r: "rectangle", o: "oval", t: "text" };
      setTool(map[key.toLowerCase()]!);
      handled = true;
    } else if (key === "Escape") handled = escape();
    else if (key === "Enter") handled = enter();
    else if (key.startsWith("Arrow") && !mod) handled = nudge(key as ArrowKey, event.shiftKey);
    else if (event.shiftKey && event.code === "Digit1") (zoomToFit(), (handled = true));
    else if (event.shiftKey && event.code === "Digit2") (zoomToSelection(), (handled = true));
    else if (event.shiftKey && event.code === "Digit0") (zoomTo(1), (handled = true));
    else if (mod && (key === "=" || key === "+")) (zoomBy(1), (handled = true));
    else if (mod && key === "-") (zoomBy(-1), (handled = true));
    else if (mod && key.toLowerCase() === "g" && !event.shiftKey) (group(), (handled = true));
    if (handled) event.preventDefault();
  };

  const zoomEntries: MenuEntry[] = [
    { id: "zoomIn", label: "Zoom In", shortcut: "Mod+=", onSelect: () => zoomBy(1) },
    { id: "zoomOut", label: "Zoom Out", shortcut: "Mod+-", onSelect: () => zoomBy(-1) },
    { type: "separator" },
    { id: "fit", label: "Zoom to Fit", shortcut: "Shift+1", onSelect: zoomToFit },
    { id: "selection", label: "Zoom to Selection", shortcut: "Shift+2", disabled: selectionIds.length === 0, onSelect: zoomToSelection },
    { id: "actual", label: "Actual Size", shortcut: "Shift+0", onSelect: () => zoomTo(1) },
    { id: "double", label: "200%", onSelect: () => zoomTo(2) },
    { type: "separator" },
    {
      id: "live",
      label: "Show Live Frame",
      description: componentId === rootId ? "Mirror the running prototype instead of frame 0" : "Only for the main prototype",
      checked: source === "live",
      disabled: componentId !== rootId,
      onSelect: () => setSource(source === "live" ? "design" : "live"),
    },
  ];

  const editingNode = editing ? index.entry(editing.id)?.node : undefined;
  const canDraw = !!component && component.kind !== "patchComponent";

  return (
    <Panel
      title="Canvas"
      scope="canvas"
      surface="sunken"
      className={className}
      headerContent={
        <div className="sb-cv__toolbar">
          <SegmentedControl<CanvasTool>
            size="sm"
            aria-label="Tool"
            value={tool}
            onChange={setTool}
            options={[
              { value: "select", icon: <MousePointer2 size={13} />, tooltip: "Select", shortcut: "V" },
              { value: "rectangle", icon: <Square size={13} />, tooltip: "Rectangle", shortcut: "R", disabled: !canDraw },
              { value: "oval", icon: <Circle size={13} />, tooltip: "Oval", shortcut: "O", disabled: !canDraw },
              { value: "text", icon: <Type size={13} />, tooltip: "Text", shortcut: "T", disabled: !canDraw },
            ]}
          />
          <IconButton size="sm" icon={<Group size={14} />} label="Group selection" shortcut="Mod+G" disabled={selectionIds.length === 0} onClick={group} />
        </div>
      }
      actions={
        <Menu aria-label="Zoom" placement="bottom-end" entries={zoomEntries}>
          <button type="button" className="sb-cv__zoom" aria-label={`Zoom: ${formatZoom(viewport?.zoom ?? 1)}`}>
            <span className="sb-tabular">{formatZoom(viewport?.zoom ?? 1)}</span>
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
          </button>
        </Menu>
      }
    >
      <div
        ref={bodyRef}
        className={cx("sb-cv")}
        tabIndex={0}
        role="application"
        aria-roledescription="canvas"
        aria-label={component ? `Canvas: ${component.name}` : "Canvas"}
        data-tool={tool}
        data-live={live || undefined}
        data-panning={spaceHeld || undefined}
        style={cursor ? { cursor } : undefined}
        onPointerDown={canDraw ? onPointerDown : undefined}
        onPointerMove={canDraw ? onPointerMove : undefined}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerEnter={() => (pointerInside.current = true)}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onKeyDown={commands && cmds ? undefined : onKeyDownFallback}
      >
        {!component ? (
          <EmptyState title="Nothing to edit" description="This component no longer exists. Pick another one from the Layers panel." />
        ) : !canDraw ? (
          <EmptyState title="Nothing to draw here" description="This is a patch component: it has patches but no layers. Edit it in the Patch Editor." />
        ) : (
          viewport && (
            <>
              <div className="sb-cv__label" style={{ transform: `translate(${Math.round(viewport.x)}px, ${Math.round(viewport.y) - 22}px)` }}>
                <span className="sb-cv__label-name">{component.name}</span>
                <span className="sb-cv__label-meta sb-tabular">
                  {size[0]} × {size[1]}
                </span>
                {live && <span className="sb-cv__label-live">Live frame</span>}
              </div>
              <ArtboardRenderer session={session} scene={scene} viewport={viewport} size={size} rendererRef={rendererRef} />
              {component.layers.length === 0 && (
                <div className="sb-cv__hint" style={{ left: Math.round(viewport.x + (size[0] * viewport.zoom) / 2), top: Math.round(viewport.y + (size[1] * viewport.zoom) / 2) }}>
                  Draw a rectangle (R), an oval (O), or text (T)
                </div>
              )}
              <CanvasOverlay index={index} viewport={viewport} selected={selectionIds} hovered={draft.hideChrome || gestureRef.current ? null : hoverId} chrome={chrome} draft={draft} altMeasure={altMeasure} />
              {editing && editingNode && <InlineTextEditor key={editing.id} node={editingNode} viewport={viewport} initialText={editing.initial} selectAll={editing.selectAll} onCommit={commitText} />}
            </>
          )
        )}
      </div>
    </Panel>
  );
}
