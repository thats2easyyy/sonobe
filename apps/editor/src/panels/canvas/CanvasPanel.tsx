/**
 * The Canvas panel: an editable artboard of the component being edited. Click to select (⇧ adds,
 * ⌘ selects deep), marquee, drag to move with snapping, smart guides, and equal-spacing guides (hold
 * ⌘ to skip snapping), resize (⇧ keeps proportions, ⌥ from center), rotate, nudge with arrows (⇧ ×10),
 * draw rectangles (R), ovals (O), and text (T), drop images, videos, and Lottie files to add layers,
 * double-click to edit text or go into a group, zoom (⌘ scroll or pinch) and pan (scroll, space-drag).
 * Rulers (⇧R) follow zoom and pan. Every gesture is one undo entry; layout children reorder. The
 * artboard re-fits when the panel resizes until you zoom or pan. While the Design with Claude box is
 * open it fits above the box, and the first page of a draft Claude writes is fitted at a size you can read.
 */

import type { Id, Op } from "@sonobe/core";
import type { SceneFrame } from "@sonobe/engine";
import { createDomRenderer, DomTextMeasurer, type DomRenderer } from "@sonobe/renderer";
import { ChevronDown, Circle, Group, MousePointer2, Ruler, Sparkles, Square, Type } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useStore } from "zustand";
import { Panel } from "../../shell/Panel.tsx";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { topLevelLayerIds } from "../../state/clipboard.ts";
import { duplicateSelection, enterSelectedComponent, groupSelection } from "../../state/editActions.ts";
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
import { readString, writeString } from "../../ui/lib/storage.ts";
import { useElementSize } from "../../ui/lib/useElementSize.ts";
import { rectOfElement } from "../../state/bounds.ts";
import { DesignPreview, liveDraftWriter, previewFrame, writerKey } from "../design/DesignPreview.tsx";
import { activeDraft, designStore, useDesign, type DesignState } from "../design/designStore.ts";
import { patchEditorBridge } from "../patch-editor/api.ts";
import { registerBoundsProvider } from "../viewer/hostBridge.ts";
import { dragHasFiles, dropLabel, dropUndoLabel, mediaLayerOps, prepareDroppedFiles, type DroppedFile } from "./assetDrop.ts";
import { CanvasOverlay, EMPTY_DRAFT, type OverlayDraft } from "./CanvasOverlay.tsx";
import { CanvasRulers } from "./CanvasRulers.tsx";
import { RULER_SIZE } from "./rulers.ts";
import { createEditTransaction, type EditTransaction } from "./editTransaction.ts";
import { pointInQuad, rectFromPoints, unionRects, type Point, type Rect } from "./geometry.ts";
import {
  beginMove,
  beginReorder,
  beginResize,
  beginRotate,
  insertGesture,
  insertParentAt,
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
import { buildCanvasIndex, hitCopy, hitLayers, isEditableLayer, marqueeLayers, pickChildOf, pickLayer, type CanvasIndex } from "./sceneIndex.ts";
import { measureBetween, type Measurement } from "./snapping.ts";
import { useCanvasScene, type SceneSource } from "./useCanvasScene.ts";
import { clampZoom, ensureVisible, fitRect, formatZoom, nextZoomStep, panBy, rectToScreen, screenToArtboard, wheelZoom, zoomAt, type Viewport } from "./viewport.ts";
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
const FIT_PADDING = 56;
const RULERS_KEY = "sonobe.canvas.rulers";
const TOOL_LABELS: Record<InsertTool, string> = { rectangle: "Rectangle", oval: "Oval", text: "Text" };
/** The presence pill in the artboard label is cut to this many characters. */
const AGENT_PILL_CHARS = 60;
/** The Design with Claude box's offset from the canvas's bottom (design.css), plus a gap above it. */
const DESIGN_BOX_CLEARANCE = 16 + 12;
/** Fit padding in the area above the box, and the least room there that's worth fitting into (the box grows at most to leave it). */
const DESIGN_FIT_PADDING = 28;
const DESIGN_FIT_MIN_HEIGHT = 200;
/** A draft's frame is fitted whole when that's at least this zoom; otherwise its width is. */
const DRAFT_WHOLE_ZOOM = 0.45;

// The Design with Claude box loads the first time it opens.
const DesignBox = lazy(() => import("../design/DesignBox.tsx").then((m) => ({ default: m.DesignBox })));

interface GestureBase {
  pointerId: number;
  /** Artboard point where the press began. */
  start: Point;
  startScreen: Point;
}

/**
 * An ⌥-drag's copies: the paste that made them (folded into one undo step with the move when the drag
 * ends) and original → copy ids. The move is computed on the originals, then pointed at the copies.
 */
interface DuplicateDrag {
  txnId: string;
  ops: readonly Op[];
  copies: ReadonlyMap<Id, Id>;
}

type Gesture =
  | (GestureBase & { kind: "press"; picked: Id | null; wasSelected: boolean; shift: boolean; alt: boolean })
  | (GestureBase & { kind: "move"; snapshot: MoveSnapshot; txn: EditTransaction; duplicate?: DuplicateDrag })
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

/** Move ops for the originals, pointed at their copies (copies start exactly where the originals are). */
function retarget(ops: readonly Op[], copies: ReadonlyMap<Id, Id>): Op[] {
  return ops.map((op): Op => {
    if (op.op === "updateLayer" && copies.has(op.id)) return { ...op, id: copies.get(op.id)! };
    if (op.op === "setInput") {
      const m = /^@([A-Za-z_][A-Za-z0-9_]*)\.(.+)$/.exec(op.target);
      const copy = m ? copies.get(m[1]!) : undefined;
      if (copy) return { ...op, target: `@${copy}.${m![2]}` };
    }
    return op;
  });
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

/** How the viewport follows the canvas's size: the artboard's fit, a draft's frame's fit, or where someone put it (null). */
type FitMode = "artboard" | "draft" | null;

/** A draft's frame at a size you can read, in `area`: whole when that's at least 45%, else its width fitted (at most 100%) with its top at the area's top. */
function fitDraftFrame(frame: Rect, area: readonly [number, number], padding: number): Viewport {
  const whole = fitRect(frame, area, { padding, maxZoom: 1 });
  if (whole.zoom >= DRAFT_WHOLE_ZOOM) return whole;
  const zoom = clampZoom(Math.min(1, (area[0] - padding * 2) / Math.max(1, frame.width)));
  return { x: (area[0] - frame.width * zoom) / 2 - frame.x * zoom, y: padding - frame.y * zoom, zoom };
}

/** The drafts, as a key that changes only when their fit cares: which drafts, their status, and whether their pages have started (not with each part). */
function draftFitCue(state: DesignState): string {
  return state.drafts.map((d) => `${d.key}:${d.status}:${d.html ? 1 : 0}`).join("\n");
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
  const working = useStore(session.presence, (s) => s.working);
  const designOpen = useDesign((s) => s.open);
  const [designLoaded, setDesignLoaded] = useState(designOpen);
  /** The Design with Claude box's height when it opened (0 while it's closed): the canvas keeps that much room, so the fit doesn't move as the box grows. */
  const [designHeight, setDesignHeight] = useState(0);
  const onDesignHeight = useCallback((height: number) => setDesignHeight((opened) => (height === 0 ? 0 : opened || height)), []);
  const draftCue = useDesign(draftFitCue);
  const drafting = useDesign((s) => liveDraftWriter(s, Date.now(), componentId, rootId));

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
  const [rulers, setRulers] = useState(() => readString(RULERS_KEY) !== "off");
  /** The artboard label's slot for the preview's pill (DesignPreview). */
  const [labelSlot, setLabelSlot] = useState<HTMLSpanElement | null>(null);
  /** How the viewport follows the canvas's size, until someone zooms or pans. */
  const fitMode = useRef<FitMode>("artboard");
  /** The draft whose frame the viewport fits while fitMode is "draft". */
  const draftFit = useRef<{ key: string; frame: Rect } | null>(null);
  /** The live draft whose page the canvas has already seen start: each draft is fitted once. */
  const seenDraft = useRef<string | null>(null);
  /** The container size and fit inputs the viewport was last laid out for. */
  const fitLayout = useRef<{ width: number; height: number; key: string } | null>(null);
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

  // While the box is open, the artboard fits (and reveals land) in the canvas above it, which keeps at least DESIGN_FIT_MIN_HEIGHT.
  const inset = rulers ? RULER_SIZE : 0;
  const designReserve = designHeight > 0 ? Math.max(0, Math.min(designHeight + DESIGN_BOX_CLEARANCE, box.height - inset - DESIGN_FIT_MIN_HEIGHT)) : 0;
  // The box grows up to leaving that room above it; then its reply and cards scroll (design-layout.css).
  const designBoxMax = designHeight > 0 && box.height > 0 ? Math.max(designHeight, box.height - inset - DESIGN_BOX_CLEARANCE - DESIGN_FIT_MIN_HEIGHT) : null;

  const latest = useLatest({ index, viewport, componentId, component, tool, artboard, chrome, spaceHeld, box, editing, designReserve, inset });
  // The box reads layers at event time; the preview reads them while it renders, so it gets this render's index.
  const layerBounds = useCallback((id: string) => latest.current.index.bounds(id), [latest]);
  const renderBounds = useCallback((id: string) => index.bounds(id), [index]);

  useEffect(() => {
    if (designOpen) setDesignLoaded(true);
  }, [designOpen]);

  /** The artboard's fit, or with `frame` a draft's (fitDraftFrame), in the canvas above the box. */
  const fitViewport = useCallback(
    (frame?: Rect): Viewport | null => {
      if (box.width <= 0 || box.height <= 0) return null;
      const area: [number, number] = [Math.max(1, box.width - inset), Math.max(1, box.height - inset - designReserve)];
      const padding = designHeight > 0 ? DESIGN_FIT_PADDING : FIT_PADDING;
      const vp = frame ? fitDraftFrame(frame, area, padding) : fitRect(artboard, area, { padding, maxZoom: 1 });
      return { ...vp, x: vp.x + inset, y: vp.y + inset };
    },
    [artboard, box.width, box.height, inset, designReserve, designHeight],
  );
  const autoViewport = () => (fitMode.current === "draft" && draftFit.current ? fitViewport(draftFit.current.frame) : fitViewport());
  const fitKey = `${artboard.width}x${artboard.height}:${rulers ? 1 : 0}:${designReserve}:${designHeight > 0 ? 1 : 0}`;

  // Restore (or fit) the viewport when the component changes or the panel first gets a size.
  useEffect(() => {
    if (box.width === 0 || box.height === 0) return;
    if (viewportComponent.current === componentId && viewport) return;
    viewportComponent.current = componentId;
    const saved = session.selection.getState().canvasViewports[componentId];
    fitMode.current = saved ? null : "artboard";
    draftFit.current = null;
    fitLayout.current = { width: box.width, height: box.height, key: fitKey };
    setViewport(saved ?? fitViewport());
  }, [componentId, box.width, box.height, viewport, fitViewport, fitKey, session]);

  // Panel resized, split changed, rulers toggled, the box opened or closed, or the artboard changed size:
  // re-fit while the viewport is still an automatic fit; otherwise keep what was centered in the middle.
  useEffect(() => {
    if (box.width === 0 || box.height === 0) return;
    const previous = fitLayout.current;
    if (!previous) return;
    if (previous.width === box.width && previous.height === box.height && previous.key === fitKey) return;
    fitLayout.current = { width: box.width, height: box.height, key: fitKey };
    if (fitMode.current !== null) {
      const next = autoViewport();
      if (next) setViewport(next);
      return;
    }
    const dx = (box.width - previous.width) / 2;
    const dy = (box.height - previous.height) / 2;
    if (dx !== 0 || dy !== 0) setViewport((vp) => (vp ? panBy(vp, dx, dy) : vp));
  }, [box.width, box.height, fitKey, fitViewport]);

  // The first page of a draft Claude writes, while the viewport is still an automatic fit: fit its frame at a
  // size you can read. That fit stays through the import, and goes back to the artboard's if nothing was added.
  // A canvas that appears for the draft (a patches-only layout making room) fits it once it has a viewport.
  const hasViewport = viewport !== null;
  useEffect(() => {
    const state = designStore.getState();
    const draft = state.drafts.length ? activeDraft(state, Date.now()) : null;
    const live = draft && (draft.status === "writing" || draft.status === "adding") ? draft : null;
    if (!live) seenDraft.current = null;
    if (live?.html && seenDraft.current !== live.key) {
      if (!viewport) return;
      seenDraft.current = live.key;
      if (fitMode.current === null) return;
      const frame = previewFrame(live, { componentId, rootId, artboard: size, bounds: (id) => index.bounds(id), fallbackReplace: null, request: state.request });
      const next = frame ? fitViewport(frame) : null;
      if (!frame || !next) return;
      fitMode.current = "draft";
      draftFit.current = { key: live.key, frame };
      setViewport(next);
      return;
    }
    if (fitMode.current === "draft" && draft && !live && draft.key === draftFit.current?.key && draft.status !== "added") {
      fitMode.current = "artboard";
      draftFit.current = null;
      const next = fitViewport();
      if (next) setViewport(next);
    }
  }, [draftCue, hasViewport]);

  // Remember the viewport per component.
  useEffect(() => {
    if (!viewport) return;
    const timer = setTimeout(() => session.selection.getState().setCanvasViewport(componentId, viewport), 250);
    return () => clearTimeout(timer);
  }, [viewport, componentId, session]);

  // Where the canvas is on screen, so the desktop MCP bridge can screenshot it (canvas.bounds).
  const zoomRef = useLatest(viewport?.zoom);
  useEffect(() => session.bounds?.register("canvas.bounds", () => rectOfElement(bodyRef.current, zoomRef.current)), [session, bodyRef, zoomRef]);

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
    const insertTxn = state.insert?.txnId;
    const insertOnTop = insertTxn && doc.historyEntries(1)[0]?.txnId === insertTxn;
    if (state.insert && insertOnTop) {
      if (text === state.initial) return;
      if (text === "") {
        doc.undo();
        return;
      }
      // One undo step for insert and typing, keeping the new layer's id.
      const result = doc.amend(insertTxn, withInsertedText(state.insert.ops, text), { label: "Insert Text", defaultComponent: cid });
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
    if (g.kind === "move" && g.duplicate) {
      // Escape during an ⌥-drag: no copies are left behind.
      const store = session.document.getState();
      if (store.historyEntries(1)[0]?.txnId === g.duplicate.txnId && store.undoTo(g.duplicate.txnId).ok) session.selection.getState().select({ layers: g.snapshot.layers.map((l) => l.id), patches: [], comments: [] });
    }
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
    const names = layerNames(idx, snapshot.layers.map((l) => l.id));
    const duplicate = g.alt ? duplicateForDrag(snapshot) : null;
    gestureRef.current = { ...g, kind: "move", snapshot, txn: createEditTransaction(session.document, { label: duplicate ? `Duplicate ${names}` : `Move ${names}`, defaultComponent: cid }), ...(duplicate ? { duplicate } : {}) };
  };

  /** ⌥-drag (Origami, Figma): copy the selection in place, and the drag moves the copies. */
  const duplicateForDrag = (snapshot: MoveSnapshot): DuplicateDrag | null => {
    const result = duplicateSelection(session);
    const txnId = session.document.getState().lastChange?.txnId;
    if (!result.ok || !result.copies || !result.result || !txnId) {
      if (result.message) toast({ title: result.message, ...(result.hint ? { description: result.hint } : {}), tone: "warn" });
      return null;
    }
    const copies = result.copies;
    if (!snapshot.layers.every((l) => copies.has(l.id))) {
      session.document.getState().undoTo(txnId);
      return null;
    }
    return { txnId, ops: result.result.applied, copies };
  };

  /** Fold an ⌥-drag's paste and move into one undo step ("Duplicate Like Button"). */
  const finishDuplicate = (d: DuplicateDrag, moveOps: readonly Op[], label: string, componentId: Id) => {
    const store = session.document.getState();
    // Nothing to fold when the copies ended where they started (the move undid itself) or someone else committed meanwhile.
    if (moveOps.length === 0 || store.historyEntries(2)[1]?.txnId !== d.txnId) return;
    const selected = session.selection.getState().layers;
    const result = store.amend(d.txnId, [...d.ops, ...moveOps], { label, defaultComponent: componentId });
    if (result.ok) session.selection.getState().select({ layers: selected, patches: [], comments: [] });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { viewport: vp, index: idx, componentId: cid, artboard: board, chrome: c, tool: currentTool } = latest.current;
    if (!vp || (event.target as Element).closest?.(".sb-cv__text-editor, .sb-cv__hint-action")) return;
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
          // Clicking one copy of a looped layer watches that copy in the patch editor and the inspector.
          const copy = hitCopy(idx, a, picked);
          if (copy !== undefined) patchEditorBridge(session).getState().watchCopy(copy);
          const wasSelected = sel.layers.includes(picked);
          if (event.shiftKey) sel.select({ layers: [picked] }, "toggle");
          else if (!wasSelected) sel.select({ layers: [picked], patches: [], comments: [] });
          gestureRef.current = { ...base, kind: "press", picked, wasSelected, shift: event.shiftKey, alt: event.altKey };
        } else if (c && !event.shiftKey && selectionIds.length > 1 && pointInQuad(c.quad, p)) {
          gestureRef.current = { ...base, kind: "press", picked: null, wasSelected: true, shift: false, alt: event.altKey };
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
        fitMode.current = null;
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
        g.txn.update(g.duplicate ? retarget(r.ops, g.duplicate.copies) : r.ops);
        setDraft({ ...EMPTY_DRAFT, guides: r.guides, measurements: r.measurements, spacing: r.spacing ?? [], hideChrome: true });
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
        g.txn.commit();
        if (g.duplicate) finishDuplicate(g.duplicate, g.txn.ops, g.txn.label, cid);
        break;
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

  // Files dragged in from the desktop become Image, Video, and Lottie layers.
  const dropFiles = async (files: readonly DroppedFile[], at: Point) => {
    const cid = latest.current.componentId;
    const prepared = await prepareDroppedFiles(session, files);
    if (prepared.errors.length) {
      toast({ title: prepared.errors[0]!, ...(prepared.errors.length > 1 ? { description: `${prepared.errors.length - 1} more ${prepared.errors.length === 2 ? "file" : "files"} couldn't be added either.` } : {}), tone: "warn" });
    }
    if (prepared.items.length === 0) return;
    const { index: idx, artboard: board, componentId: current } = latest.current;
    if (current !== cid) return;
    const parentId = insertParentAt(idx, at);
    const parentWorld = parentId ? (idx.entry(parentId)?.node?.worldTransform ?? null) : null;
    // Media larger than the group it lands in (or the artboard) is scaled down to fit it.
    const container = (parentId ? idx.bounds(parentId) : null) ?? board;
    const { ops, refs } = mediaLayerOps(prepared.items, { componentId: cid, center: at, parentId, parentWorld, artboard: [container.width, container.height] });
    const result = apply([...prepared.assetOps, ...ops], dropUndoLabel(prepared.items));
    if (!result.ok) {
      toast({ title: result.errors[0]?.message ?? "Couldn't add the files", tone: "warn" });
      return;
    }
    const ids = refs.map((ref) => result.idMap[ref]).filter((id): id is Id => typeof id === "string");
    setTool("select");
    if (ids.length) session.selection.getState().select({ layers: ids, patches: [], comments: [] });
  };

  const onDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const { viewport: vp, index: idx, artboard: board } = latest.current;
    if (!vp) return;
    const a = screenToArtboard(vp, screenPoint(event));
    const parentId = insertParentAt(idx, a);
    const rect = (parentId ? idx.bounds(parentId) : null) ?? board;
    const into = parentId ? ` to ${idx.entry(parentId)?.layer.name ?? parentId}` : "";
    const label = `${dropLabel(event.dataTransfer)}${into}`;
    setDraft((d) => (d.dropTarget && d.dropTarget.label === label && d.dropTarget.rect === rect && d.dropTarget.at[0] === a[0] && d.dropTarget.at[1] === a[1] ? d : { ...EMPTY_DRAFT, dropTarget: { rect, at: a, label } }));
  };

  const onDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDraft((d) => (d.dropTarget ? EMPTY_DRAFT : d));
  };

  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDraft((d) => (d.dropTarget ? EMPTY_DRAFT : d));
    const vp = latest.current.viewport;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (!vp || files.length === 0) return;
    bodyRef.current?.focus({ preventScroll: true });
    void dropFiles(files, screenToArtboard(vp, screenPoint(event)));
  };

  // Screenshots of the canvas (MCP get_screenshot target "canvas").
  useEffect(() => {
    const registration = registerBoundsProvider(session, "canvas.bounds", () => {
      const el = bodyRef.current;
      const { viewport: vp, artboard: board } = latest.current;
      if (!el || !vp) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        scale: vp.zoom,
        artboard: { x: r.left + vp.x + board.x * vp.zoom, y: r.top + vp.y + board.y * vp.zoom, width: board.width * vp.zoom, height: board.height * vp.zoom },
      };
    });
    return registration.dispose;
  }, [session, bodyRef, latest]);

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
      fitMode.current = null;
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
    const { index: idx, viewport: vp, box: size, componentId: cid, designReserve: reserve, inset: top } = latest.current;
    if (!r || r.component !== cid || !vp) return;
    const bounds = unionRects(r.ids.map((id) => idx.bounds(id)).filter((b): b is Rect => b !== null));
    if (!bounds) return;
    // A draft's fit already shows the screen that lands there, from its top: it doesn't move as the screen lands.
    const shown = rectToScreen(vp, bounds);
    if (fitMode.current === "draft" && shown.x >= 0 && shown.x + shown.width <= size.width && shown.y >= top && shown.y < size.height - reserve) return;
    // Above the box, the fit's own padding is margin enough: a screen that fills the fitted artboard stays put.
    const next = reserve ? ensureVisible(vp, bounds, [size.width, size.height - reserve], DESIGN_FIT_PADDING) : ensureVisible(vp, bounds, [size.width, size.height]);
    if (next === vp) return;
    fitMode.current = null;
    setViewport(next);
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
  const zoomBy = (direction: 1 | -1) => {
    fitMode.current = null;
    setViewport((vp) => vp && zoomAt(vp, nextZoomStep(vp.zoom, direction), center()));
  };
  const zoomTo = (zoom: number) => {
    fitMode.current = null;
    setViewport((vp) => vp && zoomAt(vp, zoom, center()));
  };
  const zoomToFit = () => {
    const next = fitViewport();
    if (!next) return;
    fitMode.current = "artboard";
    draftFit.current = null;
    setViewport(next);
  };
  const zoomToSelection = () => {
    const bounds = latest.current.chrome?.bounds;
    const { box: size } = latest.current;
    if (!bounds) {
      zoomToFit();
      return;
    }
    fitMode.current = null;
    setViewport(fitRect(bounds, [size.width, size.height], { padding: 96, maxZoom: 8 }));
  };
  const toggleRulers = () =>
    setRulers((on) => {
      writeString(RULERS_KEY, on ? "off" : "on");
      return !on;
    });
  const group = () => {
    const result = groupSelection(session);
    if (!result.ok && result.message) toast({ title: result.message, ...(result.hint ? { description: result.hint } : {}), tone: "warn" });
  };
  /** Design with Claude: the ai.design command when it's registered (it refreshes the Assistant first), else just the box. */
  const openDesign = () => {
    if (!cmds?.registry.run("ai.design")) designStore.getState().openBox();
  };

  const actions = useLatest({ setTool, nudge, escape, enter, zoomBy, zoomTo, zoomToFit, zoomToSelection, group, toggleRulers });
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
      { id: "canvas.toggleRulers", title: "Show Rulers", category: "Canvas", shortcut: "Shift+R", scope, icon: Ruler, keywords: ["ruler", "measure", "coordinates"], run: () => actions.current.toggleRulers() },
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
    if (!mod && event.shiftKey && key.toLowerCase() === "r") {
      toggleRulers();
      handled = true;
    } else if (!mod && !event.shiftKey && ["v", "r", "o", "t"].includes(key.toLowerCase())) {
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
    { id: "rulers", label: "Rulers", shortcut: "Shift+R", checked: rulers, onSelect: toggleRulers },
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
  // Another agent at work here (Claude Code, Claude Desktop); the Assistant shows its own work in the box.
  // While the preview's pill says what that agent is writing here, it isn't said twice.
  const agent = working.find((w) => w.author.name !== "Assistant" && (!w.component || w.component === componentId));
  const agentText = agent && drafting !== writerKey(agent.author, agent.client) ? `${agent.client?.label ?? agent.author.name}: ${agent.intent}` : null;

  return (
    <Panel
      title="Canvas"
      scope="canvas"
      surface="sunken"
      className={className}
      style={designBoxMax !== null ? ({ "--sb-design-box-max": `${designBoxMax}px` } as CSSProperties) : undefined}
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
          <IconButton size="sm" icon={<Sparkles size={14} />} label="Design with Claude" tooltip={canDraw ? "Design with Claude" : "Patch components have no layers to design"} className="sb-cv__design" disabled={!canDraw} onClick={openDesign} />
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
        data-rulers={(rulers && canDraw) || undefined}
        data-dropping={draft.dropTarget ? true : undefined}
        style={cursor ? { cursor } : undefined}
        onPointerDown={canDraw ? onPointerDown : undefined}
        onPointerMove={canDraw ? onPointerMove : undefined}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerEnter={() => (pointerInside.current = true)}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onDragOver={canDraw ? onDragOver : undefined}
        onDragLeave={canDraw ? onDragLeave : undefined}
        onDrop={canDraw ? onDrop : undefined}
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
                {agentText && (
                  <span className="sb-cv__label-agent">
                    <span className="sb-cv__label-agent-dot" aria-hidden />
                    {agentText.length > AGENT_PILL_CHARS ? `${agentText.slice(0, AGENT_PILL_CHARS - 1).trimEnd()}…` : agentText}
                  </span>
                )}
                <span ref={setLabelSlot} className="sb-cv__label-slot" />
              </div>
              <ArtboardRenderer session={session} scene={scene} viewport={viewport} size={size} rendererRef={rendererRef} />
              {component.layers.length === 0 && (
                <div className="sb-cv__hint" style={{ left: Math.round(viewport.x + (size[0] * viewport.zoom) / 2), top: Math.round(viewport.y + (size[1] * viewport.zoom) / 2) }}>
                  Draw a rectangle (R), an oval (O), or text (T), or{" "}
                  <button type="button" className="sb-cv__hint-action" onClick={openDesign}>
                    describe a screen to Claude
                  </button>
                </div>
              )}
              <CanvasOverlay index={index} viewport={viewport} selected={selectionIds} hovered={draft.hideChrome || gestureRef.current ? null : hoverId} chrome={chrome} draft={draft} altMeasure={altMeasure} />
              <DesignPreview viewport={viewport} bounds={renderBounds} componentId={componentId} rootId={rootId} artboard={size} insetTop={inset} labelSlot={labelSlot} />
              {editing && editingNode && <InlineTextEditor key={editing.id} node={editingNode} viewport={viewport} initialText={editing.initial} selectAll={editing.selectAll} onCommit={commitText} />}
              {rulers && <CanvasRulers viewport={viewport} width={box.width} height={box.height} selection={chrome?.bounds ?? null} />}
            </>
          )
        )}
      </div>
      {designLoaded && (
        <Suspense fallback={null}>
          <DesignBox session={session} bounds={layerBounds} onHeightChange={onDesignHeight} />
        </Suspense>
      )}
    </Panel>
  );
}
