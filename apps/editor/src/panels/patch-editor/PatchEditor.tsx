/**
 * The patch editor: the current component's patch graph on React Flow. Patches, layer property
 * targets, comments, and cables are derived from the document; every edit goes through the
 * document store with an undo label; live values and pulse sparks come from the RuntimeHost (inside
 * component instances too).
 */

import { canConnect, findLayer, getPatchSpec, isLinkInput, parseAddress, readNodePositions, type Id } from "@sonobe/core";
import { isLoop } from "@sonobe/engine";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore as useFlowStore,
  useUpdateNodeInternals,
  ViewportPortal,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type FinalConnectionState,
  type NodeChange,
  type NodeTypes,
  type OnConnectStartParams,
  type OnError,
  type ReactFlowInstance,
  type ReactFlowState,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { LARGE_GRAPH_NODES, useGestureDocument } from "./state/gestureDocument.ts";
import { useStore } from "zustand";
import { rectOfElement } from "../../state/bounds.ts";
import { parseClipboardFragment } from "../../state/clipboard.ts";
import { pasteFragment } from "../../state/editActions.ts";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { diagnosticsFor } from "../../state/registry.ts";
import { currentComponentId } from "../../state/selection.ts";
import type { EditorSession } from "../../state/session.ts";
import type { Command, CommandRegistry } from "../../ui/commands/commandRegistry.ts";
import { useOptionalCommands, type CommandsContextValue } from "../../ui/commands/CommandProvider.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { useLatest } from "../../ui/lib/hooks.ts";
import { useContextMenu } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { CableEdgeView, ConnectionLineView } from "./components/CableEdge.tsx";
import { ArmedHint, EmptyGraph, LiveScopeChip, PatchEditorBreadcrumbs, Toolbar, ZoomControls } from "./components/Chrome.tsx";
import { LinkDragSearch, PatchInfoDialog, PatchPickerDialog, SpliceChooser, type SpliceChoiceRequest } from "./components/Dialogs.tsx";
import { cableMenu, commentMenu, layerMenu, paneMenu, patchMenu, portMenu, type MenuContext } from "./components/menus.ts";
import { CommentNodeView, InterfaceNodeView, LayerNodeView, PatchNodeView } from "./components/NodeViews.tsx";
import { PortHoverCard } from "./components/PortHoverCard.tsx";
import { orientConnection, portAtHandle, quickConnectCheck, type HandleRef } from "./model/connect.ts";
import { patchTitle, spliceOptions, type SpliceOption } from "./model/editOps.ts";
import { boundsOf, boundsVisible, estimateNodeSize, FIT_VIEW_PADDING, HEADER_HEIGHT, isFarZoom, pointInRect, portCenterY, readableViewport, rectContains, sampleCable, type Point, type Rect } from "./model/geometry.ts";
import { deriveGraph } from "@sonobe/core/graph";
import { missingHandlesKey, parseMissingHandlesKey } from "./model/handles.ts";
import { resolveLiveScope, scopedAddress, type LiveScope } from "./model/instances.ts";
import { cablesCutByKnife, simplifyStroke, type CableGeometry } from "./model/knife.ts";
import type { LinkCandidate } from "./model/linkSearch.ts";
import type { PickerItem } from "./model/picker.ts";
import { estimatePatchSize } from "@sonobe/core/graph";
import { nodeTextMeasurer } from "./model/measure.ts";
import { isSpliceDrag } from "./model/splice.ts";
import { reconcileNodes } from "./model/reconcile.ts";
import { singleKeyInserts } from "./model/singleKey.ts";
import {
  addressNode,
  commentIdOfNode,
  commentNodeId,
  flowNodeKind,
  layerIdOfNode,
  layerNodeId,
  parseHandleId,
  portAddress,
  portKey,
  type CableFlowEdge,
  type FlowNode,
  type GraphModel,
  type GraphNodeData,
  type PortModel,
  type PortSide,
} from "./model/types.ts";
import { centerOfView, createPatchEditorActions, type LinkSearchRequest, type PatchEditorActions, type PickerRequest, type XY } from "./state/actions.ts";
import { patchEditorBridge, registerPatchEditor } from "./state/bridge.ts";
import { PatchEditorContext, type PatchEditorContextValue } from "./state/context.ts";
import { completeConnectionToLayerProp, dropTargetAt } from "./state/linkToLayer.ts";
import { createLiveStore } from "./state/liveStore.ts";
import { createUiStore, type UiStore } from "./state/uiStore.ts";
import { useReducedMotion } from "./state/useReducedMotion.ts";
import "./patch-editor.css";

export interface PatchEditorProps {
  /** Editor session. Default: the nearest EditorProvider's session. */
  session?: EditorSession;
  /** Breadcrumbs over the canvas. Turn off when the shell shows PatchEditorBreadcrumbs in its panel header. Default true. */
  showBreadcrumbs?: boolean;
  /** Toolbar (tidy up, comment, insert). Default true. */
  showToolbar?: boolean;
  /**
   * Dock the toolbar in this element (e.g. the panel header) instead of the canvas's top bar, so it
   * never covers nodes. While it's null the toolbar isn't shown.
   */
  toolbarContainer?: Element | null;
  /** Start with the minimap visible. Default false. */
  defaultMinimap?: boolean;
  /** Register patch editor commands and single-key inserts with the CommandProvider. Default true. */
  commands?: boolean;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

const NODE_TYPES = { patch: PatchNodeView, layer: LayerNodeView, interface: InterfaceNodeView, comment: CommentNodeView } as unknown as NodeTypes;
const EDGE_TYPES = { cable: CableEdgeView } as unknown as EdgeTypes;
const EMPTY_TARGETS: readonly string[] = [];
const PAN_BUTTONS = [1];
const MULTI_SELECT_KEYS = ["Meta", "Shift", "Control"];
const ZOOM_KEYS = ["Meta", "Control"];
const MIN_ZOOM = 0.1;
/** Below this size the canvas is hidden or collapsing; don't fit to it. */
const MIN_CANVAS = 48;

type Flow = ReactFlowInstance<FlowNode, CableFlowEdge>;

/** The patch graph for the component being edited (selection.componentPath). */
export function PatchEditor({ session: provided, showBreadcrumbs = true, showToolbar = true, toolbarContainer, defaultMinimap = false, commands = true, className, style, "aria-label": ariaLabel = "Patch editor" }: PatchEditorProps) {
  const fallback = useEditorSession();
  const session = provided ?? fallback;
  const componentId = useStore(session.selection, currentComponentId);
  const cmds = useOptionalCommands();
  return (
    <section
      className={cx("sb-pe", className)}
      style={style}
      aria-label={ariaLabel}
      data-shortcut-scope="patchEditor"
      onPointerEnter={() => cmds?.shortcuts.setContextScopes(["patchEditor"])}
      onPointerDownCapture={() => session.selection.getState().setFocusedPanel("patchEditor")}
    >
      <ReactFlowProvider key={componentId}>
        <Canvas session={session} componentId={componentId} showBreadcrumbs={showBreadcrumbs} showToolbar={showToolbar} toolbarContainer={toolbarContainer} defaultMinimap={defaultMinimap} commands={commands} />
      </ReactFlowProvider>
    </section>
  );
}

interface CanvasProps {
  session: EditorSession;
  componentId: Id;
  showBreadcrumbs: boolean;
  showToolbar: boolean;
  /** undefined: float in the top bar. */
  toolbarContainer: Element | null | undefined;
  defaultMinimap: boolean;
  commands: boolean;
}

/** The modifier keys drag handlers read (React Flow passes mouse or touch events). */
type ModifierEvent = { altKey: boolean; metaKey: boolean; ctrlKey: boolean };
type DragEvent = ModifierEvent & (MouseEvent | TouchEvent | ReactMouseEvent);

interface DragState {
  start: Map<string, XY>;
  duplicate: boolean;
  /** Nodes inside dragged comments: id → the comment and the child's start position. */
  children: Map<string, { commentId: string; start: XY }>;
}

interface PendingSplice extends SpliceChoiceRequest {
  patchId: Id;
  position: XY;
  cable: { from: string; to: string };
}

function nodeRect(node: FlowNode): Rect {
  const width = node.measured?.width ?? node.width;
  const height = node.measured?.height ?? node.height;
  const size = width && height ? { width, height } : estimateNodeSize(node.data as GraphNodeData);
  return { x: node.position.x, y: node.position.y, ...size };
}

function clientPoint(event: MouseEvent | TouchEvent | ReactMouseEvent): XY {
  if ("changedTouches" in event && event.changedTouches.length) return { x: event.changedTouches[0]!.clientX, y: event.changedTouches[0]!.clientY };
  const e = event as MouseEvent;
  return { x: e.clientX, y: e.clientY };
}

/** A string that changes only when the live scope does, so the context value stays stable across edits. */
const scopeKey = (scope: LiveScope) => `${scope.prefix ?? "∅"}|${scope.steps.map((s) => `${s.parent}>${s.component}:${s.instance}:${s.instances.map((i) => `${i.id}=${i.name}`).join(",")}`).join(";")}`;

function Canvas({ session, componentId, showBreadcrumbs, showToolbar, toolbarContainer, defaultMinimap, commands }: CanvasProps) {
  const registry = session.registry;
  const flow = useReactFlow<FlowNode, CableFlowEdge>();
  const flowRef = useRef<Flow>(flow);
  flowRef.current = flow;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [ui] = useState(() => createUiStore({ minimap: defaultMinimap }));
  const [live] = useState(createLiveStore);
  const [geometry] = useState(() => new Map<string, CableGeometry>());
  const bridge = patchEditorBridge(session);
  const reducedMotion = useReducedMotion();
  const pointerRef = useRef<XY | null>(null);
  const hoveringRef = useRef(false);
  const mountedRef = useRef(true);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [linkSearch, setLinkSearch] = useState<LinkSearchRequest | null>(null);
  const [splice, setSplice] = useState<PendingSplice | null>(null);
  const spliceRef = useRef<PendingSplice | null>(null);
  const [infoId, setInfoId] = useState<Id | null>(null);
  const menu = useContextMenu();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // -- Document → graph ------------------------------------------------------
  const liveDoc = useStore(session.document, (s) => s.doc);
  // While a gesture is open (an inspector scrub, a canvas drag), the graph follows at low priority, or
  // for a large graph a few times a second, so the pointer, the inspector and the viewer never wait for it.
  const gestureOpen = useStore(session.document, (s) => s.gesture !== null);
  const graphSizeRef = useRef(0);
  const doc = useGestureDocument(liveDoc, gestureOpen, graphSizeRef.current > LARGE_GRAPH_NODES);
  const componentPath = useStore(session.selection, (s) => s.componentPath);
  const instanceChoices = useStore(bridge, (s) => s.instanceChoices);
  const pendingTargets = useStore(bridge, (s) => s.targets[componentId]) ?? EMPTY_TARGETS;
  const scope = resolveLiveScope(doc, componentPath, instanceChoices);
  const liveScopeKey = scopeKey(scope);
  const liveScope = useMemo(() => scope, [liveScopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const livePrefix = liveScope.prefix;
  const liveEnabled = livePrefix !== null;
  const runtimeDiagnostics = useStore(session.runtime.state, (s) => s.diagnostics);
  const working = useStore(session.presence, (s) => s.working);
  const selectedPatches = useStore(session.selection, (s) => s.patches);
  const selectedComments = useStore(session.selection, (s) => s.comments);
  const selectedLayers = useStore(session.selection, (s) => s.layers);
  const minimap = useStore(ui, (s) => s.minimap);
  const selectedEdges = useStore(ui, (s) => s.selectedEdges);
  const ghosts = useStore(ui, (s) => s.ghosts);

  const workingMap = useMemo(() => {
    const map = new Map<Id, string[]>();
    for (const w of working) {
      if (w.component !== undefined && w.component !== componentId) continue;
      for (const id of w.ids) map.set(id, [...(map.get(id) ?? []), w.author.name]);
    }
    return map;
  }, [working, componentId]);

  // Runtime issues name their component (instance paths resolve to the component), and deriveGraph keeps this component's.
  const diagnostics = useMemo(() => {
    const base = diagnosticsFor(doc, registry);
    return runtimeDiagnostics.length ? [...base, ...runtimeDiagnostics] : base;
  }, [doc, registry, runtimeDiagnostics]);

  // The largest size each node has been drawn at, so layer and interface nodes placed automatically
  // clear what's really on screen (live values widen nodes); estimates fill in until a node renders.
  const measuredRef = useRef(new Map<string, { width: number; height: number }>());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const autoPlacedRef = useRef(false);
  const modelRef = useRef<GraphModel | null>(null);
  const model = useMemo(
    () => deriveGraph({ doc, componentId, registry, diagnostics, working: workingMap, pendingTargets, previous: modelRef.current, sizes: measuredRef.current, measure: nodeTextMeasurer() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, componentId, registry, diagnostics, workingMap, pendingTargets, measuredVersion],
  );
  modelRef.current = model;
  const savedNodePositions = readNodePositions(doc.components[componentId]);
  autoPlacedRef.current = model.nodes.some((n) => (n.type === "layer" || n.type === "interface") && !savedNodePositions[n.id]);
  graphSizeRef.current = model.nodes.length;
  const edgeById = useMemo(() => new Map(model.edges.map((e) => [e.id, e])), [model.edges]);

  const actions = useMemo(
    () =>
      createPatchEditorActions({
        session,
        registry,
        componentId,
        ui,
        flow: () => flowRef.current,
        pointer: () => pointerRef.current,
        openPicker: (request) => setPicker(request),
        openInfo: (patchId) => setInfoId(patchId),
      }),
    [session, registry, componentId, ui],
  );

  // -- Viewport: readable first fit, and re-fit or keep the center when the panel resizes ---------
  const savedViewport = useMemo(() => session.selection.getState().patchViewports[componentId], [session, componentId]);
  /** The view was placed by an automatic fit and the user hasn't moved it since. */
  const fitModeRef = useRef(!savedViewport);
  const [fitted, setFitted] = useState(!!savedViewport);
  const markViewportManual = useCallback(() => {
    fitModeRef.current = false;
  }, []);

  /** Filled in below, once the menu helpers exist; stable so the context doesn't change with it. */
  const portMenuRef = useRef<(event: ReactMouseEvent, nodeId: string, port: PortModel) => void>(() => undefined);
  const openPortMenu = useCallback((event: ReactMouseEvent, nodeId: string, port: PortModel) => portMenuRef.current(event, nodeId, port), []);

  const context = useMemo<PatchEditorContextValue>(
    () => ({ session, registry, componentId, ui, live, geometry, actions, reducedMotion, liveEnabled, liveScope, markViewportManual, openPortMenu }),
    [session, registry, componentId, ui, live, geometry, actions, reducedMotion, liveEnabled, liveScope, markViewportManual, openPortMenu],
  );

  // -- React Flow node state ------------------------------------------------
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const nodesRef = useRef<FlowNode[]>(nodes);
  const draggingRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<DragState | null>(null);
  const [tick, setTick] = useState(0);
  const commit = useCallback((next: FlowNode[]) => {
    nodesRef.current = next;
    setNodes(next);
  }, []);
  const selectedSet = useMemo(() => new Set<string>([...selectedPatches, ...selectedComments.map(commentNodeId), ...selectedLayers.map(layerNodeId)]), [selectedPatches, selectedComments, selectedLayers]);

  useLayoutEffect(() => {
    const next = reconcileNodes(nodesRef.current, model.nodes, { selected: selectedSet, dragging: draggingRef.current });
    if (next !== nodesRef.current) commit(next);
  }, [model.nodes, selectedSet, tick, commit]);

  const autoFit = useCallback((): boolean => {
    const el = wrapperRef.current;
    if (!el || el.clientWidth < MIN_CANVAS || el.clientHeight < MIN_CANVAS) return false;
    const bounds = boundsOf(nodesRef.current.map(nodeRect));
    fitModeRef.current = true;
    setFitted(true);
    if (!bounds) return true;
    void flowRef.current.setViewport(readableViewport(bounds, el.clientWidth, el.clientHeight, { maxZoom: 1, minZoom: MIN_ZOOM }));
    return true;
  }, []);

  const onInit = useCallback(() => {
    if (savedViewport) return;
    requestAnimationFrame(() => {
      if (mountedRef.current && fitModeRef.current) autoFit();
    });
  }, [savedViewport, autoFit]);

  // Another prototype replaced the document (a lesson, an example, an opened file): its root component
  // can share this component id, so fit the new graph instead of keeping the previous document's view.
  useEffect(
    () =>
      session.document.getState().subscribeRevision((s, previous) => {
        const change = s.lastChange;
        if (!change || change === previous.lastChange || change.kind !== "replace") return;
        fitModeRef.current = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (mountedRef.current && fitModeRef.current) autoFit();
          }),
        );
      }),
    [session, autoFit],
  );

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let before = { width: el.clientWidth, height: el.clientHeight };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = { width: el.clientWidth, height: el.clientHeight };
        const prev = before;
        before = next;
        if (next.width === prev.width && next.height === prev.height) return;
        if (next.width < MIN_CANVAS || next.height < MIN_CANVAS) return;
        const f = flowRef.current;
        const hiddenBefore = prev.width < MIN_CANVAS || prev.height < MIN_CANVAS;
        if (hiddenBefore) {
          if (fitModeRef.current) autoFit();
          return;
        }
        const viewport = f.getViewport();
        const bounds = boundsOf(nodesRef.current.map(nodeRect));
        if (fitModeRef.current || (bounds && boundsVisible(bounds, viewport, prev.width, prev.height, 8))) {
          autoFit();
          return;
        }
        void f.setViewport({ x: viewport.x + (next.width - prev.width) / 2, y: viewport.y + (next.height - prev.height) / 2, zoom: viewport.zoom });
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [autoFit]);

  // Cables wait for their port handles: a cable that arrives with a new port row (a layer target) would
  // reach React Flow before the row's handle is measured (error #008). Hold it back and re-measure the node.
  const heldKey = useFlowStore(useCallback((s: ReactFlowState) => missingHandlesKey(model.edges, s.nodeLookup), [model.edges]));
  const farZoom = useFlowStore(useCallback((s: ReactFlowState) => isFarZoom(s.transform[2]), []));
  const held = useMemo(() => parseMissingHandlesKey(heldKey), [heldKey]);
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    if (held.nodes.length) updateNodeInternals(held.nodes);
  }, [held, updateNodeInternals]);

  const edges = useMemo(() => {
    const hidden = held.missing.length ? new Set(held.missing) : null;
    const ready = hidden ? model.edges.filter((e) => !hidden.has(e.id)) : model.edges;
    if (selectedEdges.length === 0) return ready;
    const set = new Set(selectedEdges);
    return ready.map((e) => (set.has(e.id) ? { ...e, selected: true } : e));
  }, [model.edges, selectedEdges, held]);

  const onFlowError = useCallback<OnError>((code, message) => {
    // #008 is the held-back cable above; it draws once its handle is measured.
    if (code === "008") return;
    if (import.meta.env?.DEV) console.warn(`[React Flow] ${message}`);
  }, []);

  // Where the graph is on screen, so the desktop MCP bridge can screenshot it (graph.bounds).
  useEffect(() => session.bounds?.register("graph.bounds", () => rectOfElement(wrapperRef.current, flowRef.current.getZoom())), [session]);

  const syncSelection = useCallback(
    (next: readonly FlowNode[]) => {
      const patches: Id[] = [];
      const comments: Id[] = [];
      const layers: Id[] = [];
      for (const n of next) {
        if (!n.selected) continue;
        const kind = flowNodeKind(n.id);
        if (kind === "patch") patches.push(n.id);
        else if (kind === "comment") comments.push(commentIdOfNode(n.id)!);
        else if (kind === "layer") layers.push(layerIdOfNode(n.id)!);
      }
      session.selection.getState().select({ patches, comments, layers }, "replace");
    },
    [session],
  );

  const remeasureFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(remeasureFrame.current), []);
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const next = applyNodeChanges(changes, nodesRef.current);
      commit(next);
      let grew = false;
      for (const c of changes) {
        if (c.type !== "dimensions" || !c.dimensions || flowNodeKind(c.id) === "comment") continue;
        const known = measuredRef.current.get(c.id);
        if (known && c.dimensions.width <= known.width + 0.5 && c.dimensions.height <= known.height + 0.5) continue;
        measuredRef.current.set(c.id, { width: Math.max(c.dimensions.width, known?.width ?? 0), height: Math.max(c.dimensions.height, known?.height ?? 0) });
        grew = true;
      }
      if (grew && autoPlacedRef.current) {
        cancelAnimationFrame(remeasureFrame.current);
        remeasureFrame.current = requestAnimationFrame(() => setMeasuredVersion((v) => v + 1));
      }
      if (changes.some((c) => c.type === "select")) syncSelection(next);
      if (draggingRef.current.size === 0) {
        const nudged = new Map<string, XY>();
        for (const c of changes) if (c.type === "position" && c.position && !c.dragging) nudged.set(c.id, c.position);
        if (nudged.size) actions.moveNodes(nudged, undefined, `nudge:${[...nudged.keys()].join(",")}`);
      }
    },
    [commit, syncSelection, actions],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CableFlowEdge>[]) => {
      const select = changes.filter((c) => c.type === "select");
      if (select.length === 0) return;
      const set = new Set(ui.getState().selectedEdges);
      for (const c of select) {
        if (c.type !== "select") continue;
        if (c.selected) set.add(c.id);
        else set.delete(c.id);
      }
      ui.getState().set({ selectedEdges: [...set] });
    },
    [ui],
  );

  // -- Bridge: other panels drive layer properties through this editor -------------------
  useEffect(() => registerPatchEditor(session, { componentId, connect: (from, to) => actions.connect(from, to) }), [session, componentId, actions]);

  useEffect(() => {
    if (pendingTargets.length === 0) return;
    const c = doc.components[componentId];
    const stale = pendingTargets.filter((address) => {
      const a = parseAddress(address);
      const layer = a?.kind === "layer" && c ? findLayer(c.layers, a.id)?.layer : undefined;
      return !layer || !a || isLinkInput(layer.props[a.key]);
    });
    if (stale.length) bridge.getState().removeTargets(componentId, stale);
  }, [doc, componentId, pendingTargets, bridge]);

  /** Where an input handle sits in flow coordinates (measured when rendered, else estimated from its row). */
  const inputPoint = useCallback((nodeId: string, handleId: string): XY => {
    const internal = flowRef.current.getInternalNode(nodeId);
    const bounds = internal?.internals.handleBounds?.target?.find((h) => h.id === handleId);
    if (internal && bounds) return { x: internal.internals.positionAbsolute.x + bounds.x + bounds.width / 2, y: internal.internals.positionAbsolute.y + bounds.y + bounds.height / 2 };
    const node = nodesRef.current.find((n) => n.id === nodeId);
    const data = node?.data as GraphNodeData | undefined;
    const index = data && data.kind !== "comment" ? Math.max(0, data.inputs.findIndex((p) => p.handleId === handleId)) : 0;
    return { x: node?.position.x ?? 0, y: (node?.position.y ?? 0) + portCenterY({ collapsed: data?.kind === "patch" && data.collapsed }, index) };
  }, []);

  const driveRequest = useStore(bridge, (s) => s.request);
  useEffect(() => {
    if (!driveRequest || driveRequest.component !== componentId) return;
    const target = addressNode(driveRequest.address);
    const port = model.ports.get(portKey("in", driveRequest.address));
    if (!target || !port || !model.nodeIds.has(target.nodeId)) return;
    bridge.getState().consumeRequest(driveRequest.nonce);
    markViewportManual();
    const address = driveRequest.address;
    ui.getState().set({ highlightPort: address, hoverPort: null });
    const run = async () => {
      const f = flowRef.current;
      const at = inputPoint(target.nodeId, port.handleId);
      const zoom = Math.min(1.2, Math.max(0.85, f.getZoom()));
      const width = wrapperRef.current?.clientWidth ?? 800;
      await f.setCenter(at.x - Math.min(180, width * 0.2) / zoom, at.y, { zoom, duration: reducedMotion ? 0 : 220 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!mountedRef.current) return;
      const point = inputPoint(target.nodeId, port.handleId);
      const client = f.flowToScreenPosition(point);
      setLinkSearch({ client: { x: client.x - 10, y: client.y - 12 }, position: point, side: "in", address, type: port.type, drive: true, targetName: port.name, placement: "left-start" });
    };
    void run();
    setTimeout(() => {
      if (mountedRef.current && ui.getState().highlightPort === address) ui.getState().set({ highlightPort: null });
    }, 2400);
  }, [driveRequest, componentId, model, bridge, ui, inputPoint, markViewportManual, reducedMotion]);

  // -- Dragging nodes -------------------------------------------------------
  const findSpliceTarget = useCallback(
    (node: FlowNode): string | null => {
      const rect = nodeRect(node);
      const cx0 = rect.x + rect.width / 2;
      const cy0 = rect.y + rect.height / 2;
      let best: string | null = null;
      let bestDistance = Infinity;
      for (const g of geometry.values()) {
        const edge = edgeById.get(g.id);
        if (!edge || edge.source === node.id || edge.target === node.id) continue;
        for (const [x, y] of sampleCable(g.sx, g.sy, g.tx, g.ty, 24)) {
          if (!pointInRect([x, y], rect, 6)) continue;
          const d = Math.hypot(x - cx0, y - cy0);
          if (d < bestDistance) {
            bestDistance = d;
            best = g.id;
          }
        }
      }
      return best;
    },
    [geometry, edgeById],
  );

  const onDragStart = useCallback(
    (event: ModifierEvent, dragged: FlowNode[]) => {
      ui.getState().set({ hoverPort: null, armed: null });
      const start = new Map(dragged.map((n) => [n.id, { ...n.position }]));
      const dragging = new Set(dragged.map((n) => n.id));
      const children = new Map<string, { commentId: string; start: XY }>();
      for (const comment of dragged.filter((n) => n.type === "comment")) {
        const frame = nodeRect(comment);
        for (const n of nodesRef.current) {
          if (n.type === "comment" || dragging.has(n.id) || children.has(n.id)) continue;
          if (rectContains(frame, nodeRect(n))) children.set(n.id, { commentId: comment.id, start: { ...n.position } });
        }
      }
      for (const id of children.keys()) dragging.add(id);
      draggingRef.current = dragging;
      const duplicate = event.altKey && dragged.every((n) => n.type === "patch");
      if (duplicate) ui.getState().set({ ghosts: dragged.map(nodeRect) });
      dragRef.current = { start, duplicate, children };
    },
    [ui],
  );

  const onDrag = useCallback(
    (event: ModifierEvent, dragged: FlowNode[]) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.children.size) {
        const moves = new Map<string, XY>();
        for (const [childId, { commentId, start }] of d.children) {
          const comment = dragged.find((n) => n.id === commentId);
          const commentStart = d.start.get(commentId);
          if (comment && commentStart) moves.set(childId, { x: start.x + comment.position.x - commentStart.x, y: start.y + comment.position.y - commentStart.y });
        }
        commit(nodesRef.current.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n)));
      }
      const splicing = isSpliceDrag(event, dragged) ? findSpliceTarget(dragged[0]!) : null;
      if (ui.getState().spliceEdge !== splicing) ui.getState().set({ spliceEdge: splicing });
    },
    [commit, findSpliceTarget, ui],
  );

  const resolveSplice = useCallback(
    (option: SpliceOption | null) => {
      const pending = spliceRef.current;
      if (!pending) return;
      spliceRef.current = null;
      setSplice(null);
      draggingRef.current = new Set();
      ui.getState().set({ spliceEdge: null });
      setTick((t) => t + 1);
      if (option) actions.moveAndSplice(pending.patchId, pending.position, pending.cable, { inputKey: option.inputKey, outputKey: option.outputKey });
      else actions.moveNodes(new Map([[pending.patchId, pending.position]]));
    },
    [actions, ui],
  );

  const onDragStop = useCallback(
    (event: DragEvent, dragged: FlowNode[]) => {
      const d = dragRef.current;
      dragRef.current = null;
      const spliceEdge = ui.getState().spliceEdge;
      ui.getState().set({ ghosts: null, spliceEdge: null });
      const finalPositions = new Map<string, XY>(dragged.map((n) => [n.id, { ...n.position }]));
      for (const childId of d?.children.keys() ?? []) {
        const n = nodesRef.current.find((x) => x.id === childId);
        if (n) finalPositions.set(childId, { ...n.position });
      }
      draggingRef.current = new Set();
      setTick((t) => t + 1);
      if (!d) return;
      const moved = [...finalPositions].some(([id, p]) => {
        const s = d.start.get(id) ?? d.children.get(id)?.start;
        return !s || s.x !== p.x || s.y !== p.y;
      });
      if (!moved) return;
      if (d.duplicate) {
        actions.duplicateWithInputs(
          dragged.map((n) => n.id),
          finalPositions,
        );
        commit(nodesRef.current.map((n) => (d.start.has(n.id) ? { ...n, position: d.start.get(n.id)! } : n)));
        return;
      }
      const edge = spliceEdge ? edgeById.get(spliceEdge) : undefined;
      if (edge?.data && dragged.length === 1) {
        const patchId = dragged[0]!.id;
        const position = finalPositions.get(patchId)!;
        const cable = { from: edge.data.from, to: edge.data.to };
        const current = session.document.getState().doc;
        const options = spliceOptions(current, componentId, registry, patchId, cable);
        if (!("error" in options) && options.length > 1) {
          // Hold the patch where it was dropped while the chooser is open.
          draggingRef.current = new Set([patchId]);
          ui.getState().set({ spliceEdge: edge.id });
          const node = current.components[componentId]?.patches[patchId];
          const pending: PendingSplice = { client: clientPoint(event), title: patchTitle(node, node ? getPatchSpec(registry, node.type) : undefined), options, patchId, position, cable };
          spliceRef.current = pending;
          setSplice(pending);
          return;
        }
        const only = Array.isArray(options) ? options[0] : undefined;
        actions.moveAndSplice(patchId, position, cable, only ? { inputKey: only.inputKey, outputKey: only.outputKey } : undefined);
        return;
      }
      actions.moveNodes(finalPositions);
    },
    [actions, commit, componentId, edgeById, registry, session, ui],
  );

  // -- Connecting -----------------------------------------------------------
  const originRef = useRef<(HandleRef & { side: PortSide }) | null>(null);

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      ui.getState().set({ hoverPort: null, armed: null });
      const parsed = parseHandleId(params.handleId);
      if (!params.nodeId || !parsed) return;
      const origin = { nodeId: params.nodeId, handleId: params.handleId, side: parsed.side };
      originRef.current = origin;
      const m = modelRef.current!;
      const port = portAtHandle(m, origin);
      if (parsed.side === "in" && port?.connected && port.link) {
        const edge = m.edges.find((e) => e.data?.to === port.address);
        if (edge?.data) {
          ui.getState().set({ detaching: { edgeId: edge.id, from: port.link, to: port.address, sourceNode: edge.source, sourceHandle: edge.sourceHandle!, sourceType: edge.data.sourceType }, draggingType: edge.data.sourceType });
          bridge.getState().setCableDrag({ component: componentId, from: port.link, type: edge.data.sourceType });
          return;
        }
      }
      ui.getState().set({ draggingType: port?.type ?? null });
      if (port && parsed.side === "out") bridge.getState().setCableDrag({ component: componentId, from: port.address, type: port.type });
    },
    [bridge, componentId, ui],
  );

  const otherEnd = (c: Connection | Edge, origin: HandleRef | null): HandleRef => {
    const a = { nodeId: c.source, handleId: c.sourceHandle ?? null };
    const b = { nodeId: c.target, handleId: c.targetHandle ?? null };
    return origin && a.nodeId === origin.nodeId && a.handleId === origin.handleId ? b : a;
  };

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const m = modelRef.current!;
      const detaching = ui.getState().detaching;
      if (detaching) {
        const other = otherEnd(c, originRef.current);
        if (parseHandleId(other.handleId)?.side !== "in" || other.nodeId === detaching.sourceNode) return false;
        const port = portAtHandle(m, other);
        return !!port && canConnect(detaching.sourceType, port.type).ok;
      }
      return quickConnectCheck(m, { nodeId: c.source, handleId: c.sourceHandle ?? null }, { nodeId: c.target, handleId: c.targetHandle ?? null }).ok;
    },
    [ui],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const detaching = ui.getState().detaching;
      if (detaching) {
        const other = otherEnd(c, originRef.current);
        const parsed = parseHandleId(other.handleId);
        if (parsed?.side === "in") actions.reroute(detaching.from, detaching.to, portAddress(other.nodeId, parsed.key));
        return;
      }
      const oriented = orientConnection({ nodeId: c.source, handleId: c.sourceHandle }, { nodeId: c.target, handleId: c.targetHandle });
      if (oriented) actions.connect(oriented.from, oriented.to);
    },
    [actions, ui],
  );

  /** A cable released over a node body: connect the best-fitting port, or list a layer's properties. */
  const dropOnNode = useCallback(
    (origin: HandleRef & { side: PortSide }, client: XY, fromType: PortModel["type"], fromAddress: string, reroute?: string): "connected" | "picker" | false => {
      const nodeEl = document.elementFromPoint(client.x, client.y)?.closest(".react-flow__node");
      const targetId = nodeEl?.getAttribute("data-id");
      const target = targetId && targetId !== origin.nodeId ? modelRef.current!.nodes.find((n) => n.id === targetId) : undefined;
      if (!target || target.data.kind === "comment") return false;
      if (target.data.kind === "interface") {
        // A cable released on Component Inputs (from an input) or Component Outputs (from an output) publishes
        // that port, instead of wiring an existing published port that may not fit.
        const side: PortSide = origin.side === "in" ? "in" : "out";
        if ((side === "in") !== (target.data.side === "inputs")) return false;
        actions.publishPort(fromAddress, side);
        return "connected";
      }
      if (target.data.kind === "layer") {
        setLinkSearch({ client, position: flowRef.current.screenToFlowPosition(client), side: origin.side, address: fromAddress, type: fromType, layer: target.data.layerId, sourceNode: origin.nodeId, ...(reroute ? { reroute } : {}) });
        return "picker";
      }
      const candidates = origin.side === "out" ? target.data.inputs : target.data.outputs;
      const fits = candidates.filter((p) => (origin.side === "out" ? canConnect(fromType, p.type).ok : canConnect(p.type, fromType).ok) && p.type !== "layer");
      const port = fits.find((p) => !p.connected && p.type === fromType) ?? fits.find((p) => !p.connected && p.type !== "any") ?? fits.find((p) => !p.connected) ?? fits[0];
      if (!port) return false;
      if (origin.side === "out") {
        if (reroute) actions.reroute(fromAddress, reroute, port.address);
        else actions.connect(fromAddress, port.address);
      } else actions.connect(port.address, fromAddress);
      return "connected";
    },
    [actions],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const origin = originRef.current;
      originRef.current = null;
      const detaching = ui.getState().detaching;
      ui.getState().set({ detaching: null, draggingType: null });
      bridge.getState().setCableDrag(null);
      if (!origin || state.isValid) return;
      const client = clientPoint(event);
      const position = flowRef.current.screenToFlowPosition(client);
      const m = modelRef.current!;
      if (state.toHandle) {
        const toRef = { nodeId: state.toHandle.nodeId, handleId: state.toHandle.id ?? null };
        const parsed = parseHandleId(toRef.handleId);
        const oriented = detaching ? (parsed?.side === "in" ? { from: detaching.from, to: portAddress(toRef.nodeId, parsed.key) } : undefined) : orientConnection(origin, toRef);
        if (oriented && oriented.to !== detaching?.to) actions.explainConnection(oriented.from, oriented.to, position);
        return;
      }
      const port = portAtHandle(m, origin);
      // Released over another panel: Inspector property rows and Layers rows accept cables.
      const under = document.elementFromPoint(client.x, client.y);
      if (under && wrapperRef.current && !wrapperRef.current.contains(under)) {
        const target = dropTargetAt(under);
        const from = detaching ? detaching.from : port?.address;
        const type = detaching ? detaching.sourceType : port?.type;
        if (target?.kind === "prop" && (target.target.component ?? componentId) === componentId) {
          const address = `@${target.target.layerId}.${target.target.prop}`;
          if (detaching) actions.reroute(detaching.from, detaching.to, address);
          else if (port && origin.side === "out") completeConnectionToLayerProp(port.address, target.target, { session });
          else if (port) actions.connect(address, port.address);
        } else if (target?.kind === "layer" && (target.component ?? componentId) === componentId && from && type) {
          setLinkSearch({ client, position, side: detaching ? "out" : origin.side, address: from, type, layer: target.layerId, sourceNode: detaching ? detaching.sourceNode : origin.nodeId, ...(detaching ? { reroute: detaching.to } : {}) });
        } else if (detaching) actions.disconnect([detaching.to]);
        return;
      }
      if (detaching) {
        if (dropOnNode({ nodeId: detaching.sourceNode, handleId: detaching.sourceHandle, side: "out" }, client, detaching.sourceType, detaching.from, detaching.to) === false) actions.disconnect([detaching.to]);
        return;
      }
      if (!port) return;
      if (dropOnNode(origin, client, port.type, port.address)) return;
      const patchType = flowNodeKind(origin.nodeId) === "patch" ? session.document.getState().doc.components[componentId]?.patches[origin.nodeId]?.type : undefined;
      setLinkSearch({ client, position, side: origin.side, address: port.address, type: port.type, sourceNode: origin.nodeId, ...(patchType ? { patchType } : {}) });
    },
    [actions, bridge, componentId, dropOnNode, session, ui],
  );

  const onLinkPick = useCallback(
    (item: LinkCandidate, request: LinkSearchRequest) => {
      if (item.kind === "layer") {
        if (request.chooseProperty) actions.driveLayerProp(item.layerId, item.port.key);
        else if (request.side === "out") {
          if (request.reroute) actions.reroute(request.address, request.reroute, item.address);
          else actions.connect(request.address, item.address);
        } else actions.connect(item.address, request.address);
        return;
      }
      if (item.kind === "output") {
        actions.connect(item.address, request.address);
        return;
      }
      const list = request.side === "out" ? item.spec.inputs.filter((p) => !p.advanced) : item.spec.outputs;
      const declared = list.findIndex((p) => p.key === item.port.key);
      const variadicIndex = item.port.key.match(/(\d+)$/)?.[1];
      const row = Math.max(0, declared >= 0 ? declared : variadicIndex ? list.length + Number(variadicIndex) - 1 : 0);
      const y = request.position.y - portCenterY({}, row);
      let x = request.position.x + 16;
      if (request.side === "in") {
        const width = estimatePatchSize(session.document.getState().doc, registry, { type: item.spec.type, inputs: {}, ui: { x: 0, y: 0 }, ...(item.typeParam ? { typeParam: item.typeParam } : {}) }, { component: componentId, measure: nodeTextMeasurer() }).width;
        x = request.position.x - width - (request.drive ? 72 : 16);
      }
      actions.insertPatch(item.spec.type, { x, y }, { ...(item.typeParam ? { typeParam: item.typeParam } : {}), connect: { address: request.address, side: request.side, portKey: item.port.key }, placement: request.side === "out" ? "right" : "left" });
    },
    [actions, registry, session, componentId],
  );

  const onPickerPick = useCallback(
    (item: PickerItem, request: PickerRequest) => {
      if (request.replace) {
        actions.replaceWith(request.replace, item.spec.type, item.componentId);
        return;
      }
      const at = request.position ?? pointerRef.current ?? centerOfView(flowRef.current, wrapperRef.current);
      actions.insertPatch(item.spec.type, { x: at.x - 24, y: at.y - HEADER_HEIGHT / 2 }, item.componentId ? { component: item.componentId, name: item.name } : {});
    },
    [actions],
  );

  const chooseLayerProperty = useCallback((layerId: Id) => {
    const node = nodesRef.current.find((n) => n.id === layerNodeId(layerId));
    if (!node) return;
    const client = flowRef.current.flowToScreenPosition({ x: node.position.x, y: node.position.y + HEADER_HEIGHT });
    setLinkSearch({ client, position: node.position, side: "out", address: "", type: "any", layer: layerId, chooseProperty: true });
  }, []);

  // -- Knife cut (⌃ + right-drag) -------------------------------------------
  const knifeRef = useRef<{ id: number; points: Point[]; moved: boolean; origin: DOMRect } | null>(null);
  const suppressMenuRef = useRef(false);

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.ctrlKey || (event.button !== 0 && event.button !== 2)) return;
    const target = event.target as Element;
    if (!target.closest(".react-flow__pane, .react-flow__edge, .react-flow__node-comment")) return;
    if (target.closest(".react-flow__node:not(.react-flow__node-comment), .react-flow__resize-control, .sb-pe-title-input, .sb-pe-zoom, .sb-pe-toolbar, .react-flow__minimap")) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    knifeRef.current = { id: event.pointerId, points: [[event.clientX, event.clientY]], moved: false, origin: event.currentTarget.getBoundingClientRect() };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    hoveringRef.current = true;
    pointerRef.current = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const k = knifeRef.current;
    if (!k || k.id !== event.pointerId) return;
    k.points.push([event.clientX, event.clientY]);
    const [x0, y0] = k.points[0]!;
    if (!k.moved && Math.hypot(event.clientX - x0, event.clientY - y0) > 4) k.moved = true;
    if (k.moved) ui.getState().set({ knife: k.points.map(([x, y]) => [x - k.origin.left, y - k.origin.top] as const) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const k = knifeRef.current;
    if (!k || k.id !== event.pointerId) return;
    knifeRef.current = null;
    ui.getState().set({ knife: null });
    if (k.moved) {
      suppressMenuRef.current = true;
      setTimeout(() => (suppressMenuRef.current = false), 300);
      const stroke = simplifyStroke(
        k.points.map(([x, y]) => {
          const p = flowRef.current.screenToFlowPosition({ x, y });
          return [p.x, p.y] as const;
        }),
      );
      const cut = cablesCutByKnife(stroke, geometry.values());
      if (cut.length) actions.cutCables(cut);
    }
  };

  // -- Context menus --------------------------------------------------------
  const paste = useCallback(async () => {
    let fragment = null;
    try {
      fragment = parseClipboardFragment(await navigator.clipboard.readText());
    } catch {
      // Clipboard permission denied: use the session clipboard.
    }
    fragment ??= session.clipboard;
    if (!fragment) {
      void toast({ title: "There's nothing to paste.", description: "Copy patches first.", tone: "neutral" });
      return;
    }
    const result = pasteFragment(session, fragment);
    if (!result.ok && result.message) void toast({ title: result.message, tone: "warn" });
  }, [session]);

  const menuContext = (): MenuContext => ({
    actions,
    registry,
    doc: session.document.getState().doc,
    componentId,
    selectedPatches: session.selection.getState().patches,
    nested: session.selection.getState().componentPath.length > 1,
    minimap: ui.getState().minimap,
    toggleMinimap: () => ui.getState().set({ minimap: !ui.getState().minimap }),
    fitView: () => void flowRef.current.fitView({ duration: 200, padding: FIT_VIEW_PADDING }),
    paste: () => void paste(),
    rename: (nodeId) => ui.getState().set({ editingTitle: nodeId }),
    chooseLayerProperty,
  });

  portMenuRef.current = (event, nodeId, port) => {
    const node = modelRef.current?.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const kind = flowNodeKind(nodeId);
    const s = session.selection.getState();
    if (kind === "patch" && !s.patches.includes(nodeId)) s.select({ patches: [nodeId], comments: [], layers: [] });
    if (kind === "layer" && !s.layers.includes(layerIdOfNode(nodeId)!)) s.select({ patches: [], comments: [], layers: [layerIdOfNode(nodeId)!] });
    const entries = portMenu(menuContext(), node.data as GraphNodeData, port);
    if (entries.length) menu.open(event, entries);
  };

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: FlowNode) => {
      event.preventDefault();
      if (!node.selected) {
        const kind = flowNodeKind(node.id);
        session.selection.getState().select(kind === "patch" ? { patches: [node.id], comments: [], layers: [] } : kind === "comment" ? { patches: [], comments: [commentIdOfNode(node.id)!], layers: [] } : { patches: [], comments: [], layers: kind === "layer" ? [layerIdOfNode(node.id)!] : [] });
      }
      const ctx = menuContext();
      const data = node.data as GraphNodeData;
      const entries = data.kind === "patch" ? patchMenu(ctx, data) : data.kind === "comment" ? commentMenu(ctx, data, () => ui.getState().set({ editingTitle: node.id })) : data.kind === "layer" ? layerMenu(ctx, data) : [];
      if (entries.length) menu.open(event, entries);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, session, ui, menu.open, chooseLayerProperty],
  );

  /** A plain click on a node inside a multi-selection selects just that node (drags keep the group). */
  const onNodeClick = useCallback(
    (event: ReactMouseEvent, node: FlowNode) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) return;
      const kind = flowNodeKind(node.id);
      const items = kind === "patch" ? { patches: [node.id], comments: [], layers: [] } : kind === "comment" ? { patches: [], comments: [commentIdOfNode(node.id)!], layers: [] } : kind === "layer" ? { patches: [], comments: [], layers: [layerIdOfNode(node.id)!] } : undefined;
      if (items) session.selection.getState().select(items, "replace");
      if (ui.getState().selectedEdges.length) ui.getState().set({ selectedEdges: [] });
    },
    [session, ui],
  );

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: CableFlowEdge) => {
      event.preventDefault();
      if (!edge.data) return;
      ui.getState().set({ selectedEdges: [edge.id] });
      menu.open(event, cableMenu(menuContext(), edge.data));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, ui, menu.open],
  );

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      if (suppressMenuRef.current || knifeRef.current) return;
      menu.open(event, paneMenu(menuContext(), flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, menu.open],
  );

  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent, selected: FlowNode[]) => {
      event.preventDefault();
      const first = selected.find((n) => n.type === "patch");
      if (first && first.data.kind === "patch") menu.open(event, patchMenu(menuContext(), first.data));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, menu.open],
  );

  // -- Live values and pulses (root, or inside the watched component instance) ---------------
  const addressesKey = model.outputAddresses.join("\n");
  const pulseKey = useMemo(
    () =>
      [...model.ports.values()]
        .filter((p) => p.side === "out" && p.type === "pulse")
        .map((p) => p.address)
        .join("\n"),
    [model.ports],
  );
  useEffect(() => {
    if (livePrefix === null) {
      live.clear();
      return;
    }
    const addresses = addressesKey ? addressesKey.split("\n") : [];
    const scoped = addresses.map((a) => scopedAddress(livePrefix, a));
    const local = new Map(scoped.map((s, i) => [s, addresses[i]!]));
    const unsubscribeValues = addresses.length
      ? session.runtime.subscribeValues(
          scoped,
          (values) => {
            if (livePrefix === "") {
              live.setValues(values);
              return;
            }
            const out: Record<string, unknown> = {};
            for (const [address, value] of Object.entries(values)) out[local.get(address) ?? address] = value;
            live.setValues(out);
          },
          { hz: 20 },
        )
      : () => undefined;
    let unsubscribePulses: () => void = () => undefined;
    if (livePrefix === "") unsubscribePulses = session.runtime.subscribePulses((fire) => live.firePulses(fire.addresses));
    else if (pulseKey && typeof session.runtime.subscribeFrame === "function") {
      // The runtime host only reports root pulses, so read this instance's pulse outputs each frame.
      const pulses = pulseKey.split("\n").map((address) => [address, scopedAddress(livePrefix, address)] as const);
      unsubscribePulses = session.runtime.subscribeFrame(() => {
        const fired: string[] = [];
        for (const [address, scopedPulse] of pulses) {
          const v = session.runtime.runtime.getRawValue(scopedPulse);
          if (v === true || (isLoop(v) && v.items.some((item) => item === true))) fired.push(address);
        }
        if (fired.length) live.firePulses(fired);
      });
    }
    return () => {
      unsubscribeValues();
      unsubscribePulses();
      live.clear();
    };
  }, [session, livePrefix, addressesKey, pulseKey, live]);

  // -- Reveal requests ------------------------------------------------------
  const reveal = useStore(session.selection, (s) => s.reveal);
  useEffect(() => {
    if (!reveal || reveal.component !== componentId) return;
    const m = modelRef.current!;
    const ids = reveal.ids
      .map((id) => (m.nodeIds.has(id) && flowNodeKind(id) === "patch" ? id : m.nodeIds.has(layerNodeId(id)) ? layerNodeId(id) : undefined))
      .filter((id): id is string => id !== undefined)
      .map((id) => ({ id }));
    if (ids.length) {
      markViewportManual();
      void flowRef.current.fitView({ nodes: ids, duration: 260, padding: 0.6, maxZoom: 1.2 });
    }
  }, [reveal, componentId, markViewportManual]);

  // -- Commands -------------------------------------------------------------
  const activate = useCommandTarget(commands, { actions, ui, flow: () => flowRef.current, session, componentId, hovering: () => hoveringRef.current, markManual: markViewportManual });

  const empty = model.nodes.length === 0;

  return (
    <PatchEditorContext.Provider value={context}>
      <div
        ref={wrapperRef}
        className="sb-pe__canvas"
        data-fitting={(!fitted && !empty) || undefined}
        data-lod={farZoom ? "far" : undefined}
        onPointerEnter={activate}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hoveringRef.current = false;
        }}
        onContextMenuCapture={(event) => {
          if (suppressMenuRef.current || knifeRef.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onDoubleClick={(event) => {
          const target = event.target as Element;
          if (target.closest(".react-flow__pane") && !target.closest(".react-flow__node")) setPicker({ position: flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
        }}
      >
        <ReactFlow<FlowNode, CableFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnectStart={onConnectStart}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          connectionMode={ConnectionMode.Loose}
          connectionLineComponent={ConnectionLineView}
          connectionRadius={22}
          onNodeDragStart={(e, _n, dragged) => onDragStart(e, dragged)}
          onNodeDrag={(e, _n, dragged) => onDrag(e, dragged)}
          onNodeDragStop={(e, _n, dragged) => onDragStop(e, dragged)}
          onSelectionDragStart={(e, dragged) => onDragStart(e, dragged)}
          onSelectionDrag={(e, dragged) => onDrag(e, dragged)}
          onSelectionDragStop={(e, dragged) => onDragStop(e, dragged)}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onSelectionContextMenu={onSelectionContextMenu}
          onNodeClick={onNodeClick}
          onPaneClick={() => ui.getState().set({ armed: null })}
          onInit={onInit}
          onMove={() => {
            if (ui.getState().hoverPort) ui.getState().set({ hoverPort: null });
          }}
          onMoveEnd={(event, viewport) => {
            session.selection.getState().setPatchViewport(componentId, viewport);
            if (event) fitModeRef.current = false;
          }}
          {...(savedViewport ? { defaultViewport: savedViewport } : {})}
          minZoom={MIN_ZOOM}
          maxZoom={2.5}
          onlyRenderVisibleElements
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={PAN_BUTTONS}
          panOnScroll
          zoomActivationKeyCode={ZOOM_KEYS}
          multiSelectionKeyCode={MULTI_SELECT_KEYS}
          selectionKeyCode={null}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          connectOnClick={false}
          elevateNodesOnSelect={false}
          nodeDragThreshold={2}
          onError={onFlowError}
          attributionPosition="bottom-left"
          aria-label="Patch graph"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} className="sb-pe-background" />
          {ghosts && (
            <ViewportPortal>
              {ghosts.map((r, i) => (
                <div key={i} className="sb-pe-ghost" style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.width, height: r.height }} />
              ))}
            </ViewportPortal>
          )}
          {minimap && (
            <MiniMap<FlowNode>
              className="sb-pe-minimap"
              pannable
              zoomable
              position="bottom-right"
              nodeBorderRadius={3}
              nodeClassName={(n) => (n.data.kind === "patch" ? `sb-pe-mm sb-pe-mm--${n.data.category}` : `sb-pe-mm sb-pe-mm--${n.data.kind}`)}
              ariaLabel="Minimap"
            />
          )}
        </ReactFlow>
        <KnifeOverlay ui={ui} />
        <div className="sb-pe-topbar" data-scrim={(showToolbar && toolbarContainer === undefined) || undefined}>
          {showBreadcrumbs && <PatchEditorBreadcrumbs session={session} className="sb-pe-crumbs--overlay" />}
          <LiveScopeChip />
          {showToolbar && toolbarContainer === undefined && <Toolbar />}
        </div>
        {showToolbar && toolbarContainer && <Toolbar container={toolbarContainer} />}
        <ZoomControls />
        <ArmedHint />
        {empty && <EmptyGraph />}
        <PortHoverCard model={model} />
        {menu.element}
      </div>
      <PatchPickerDialog request={picker} onClose={() => setPicker(null)} onPick={onPickerPick} />
      <LinkDragSearch
        request={linkSearch}
        onClose={() => {
          setLinkSearch(null);
          if (ui.getState().highlightPort) ui.getState().set({ highlightPort: null });
        }}
        onPick={onLinkPick}
      />
      <SpliceChooser request={splice} onChoose={(option) => resolveSplice(option)} onCancel={() => resolveSplice(null)} />
      <PatchInfoDialog patchId={infoId} onClose={() => setInfoId(null)} />
    </PatchEditorContext.Provider>
  );
}

function KnifeOverlay({ ui }: { ui: UiStore }) {
  const knife = useStore(ui, (s) => s.knife);
  if (!knife || knife.length < 2) return null;
  const points = knife.map(([x, y]) => `${x},${y}`).join(" ");
  const last = knife.at(-1)!;
  return (
    <svg className="sb-pe-knife" aria-hidden>
      <polyline points={points} />
      <circle cx={last[0]} cy={last[1]} r={3} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Commands: registered once per command registry, routed to the editor under the pointer.
// ---------------------------------------------------------------------------

interface CommandTarget {
  actions: PatchEditorActions;
  ui: UiStore;
  flow: () => Flow;
  session: EditorSession;
  componentId: Id;
  hovering: () => boolean;
  /** The viewport is about to move on the user's request (resizes keep it instead of re-fitting). */
  markManual: () => void;
}

interface CommandEntry {
  count: number;
  current: (() => CommandTarget) | null;
  dispose: () => void;
}

const commandEntries = new WeakMap<CommandRegistry, CommandEntry>();

function registerPatchEditorCommands(cmds: CommandsContextValue, entry: CommandEntry, registry: EditorSession["registry"]): () => void {
  const target = () => entry.current?.();
  const run = (fn: (t: CommandTarget) => void) => () => {
    const t = target();
    if (t) fn(t);
  };
  const patches = () => target()?.actions.selectedPatchIds() ?? [];
  /** The port ⌥P acts on: under the pointer, showing its hover card, or armed for fan-out. */
  const publishTarget = () => {
    const ui = target()?.ui.getState();
    const port = ui?.pointerPort ?? (ui?.hoverPort ? { nodeId: ui.hoverPort.nodeId, address: ui.hoverPort.address, side: ui.hoverPort.side } : null) ?? (ui?.armed ? { nodeId: ui.armed.nodeId, address: ui.armed.address, side: "out" as const } : null);
    if (!port) return undefined;
    const kind = flowNodeKind(port.nodeId);
    return kind === "patch" || kind === "layer" ? port : undefined;
  };
  const singlePatch = () => (patches().length === 1 ? patches()[0] : undefined);
  const hasItems = () => {
    const t = target();
    if (!t) return false;
    const s = t.session.selection.getState();
    return s.patches.length > 0 || s.comments.length > 0 || t.ui.getState().selectedEdges.length > 0 || s.layers.length > 0;
  };
  const category = "Patches";
  const scope = "patchEditor";
  const commands: Command[] = [
    { id: "patchEditor.insertPatch", title: "Insert Patch…", category, scope, shortcut: "Alt+Enter", keywords: ["add", "node", "library"], run: run((t) => t.actions.openPicker()) },
    { id: "patchEditor.tidyUp", title: "Tidy Up Patches", category, scope, shortcut: "Ctrl+T", keywords: ["layout", "arrange", "clean"], run: run((t) => void t.actions.tidyUp()) },
    { id: "patchEditor.arrangeFrames", title: "Tidy Up and Arrange Frames", category, scope, keywords: ["layout", "sections", "comments", "blocks"], description: "Tidy Up that also moves comment frames", run: run((t) => void t.actions.tidyUp({ arrange: true })) },
    { id: "patchEditor.commentSelection", title: "Comment Selected Patches", category, scope, shortcut: "Ctrl+Alt+C", keywords: ["note", "frame", "group"], run: run((t) => t.actions.commentSelection()) },
    { id: "patchEditor.delete", title: "Delete Patches or Cables", category, scope, shortcut: ["Backspace", "Delete"], when: hasItems, run: run((t) => t.actions.deleteSelection()) },
    { id: "patchEditor.selectAll", title: "Select All Patches", category, scope, shortcut: "Mod+A", run: run((t) => t.actions.selectAll()) },
    { id: "patchEditor.duplicate", title: "Duplicate Patches", category, scope, shortcut: "Mod+D", when: () => patches().length > 0, disabledReason: "Select patches first", run: run((t) => t.actions.duplicateSelection()) },
    { id: "patchEditor.alignLeft", title: "Align Left Edges", category, scope, shortcut: "Mod+[", keywords: ["arrange", "column"], when: () => patches().length > 1, disabledReason: "Select 2 or more patches", run: run((t) => t.actions.align("left")) },
    { id: "patchEditor.alignRight", title: "Align Right Edges", category, scope, shortcut: "Mod+]", keywords: ["arrange", "column"], when: () => patches().length > 1, disabledReason: "Select 2 or more patches", run: run((t) => t.actions.align("right")) },
    { id: "patchEditor.alignTop", title: "Align Top Edges", category, scope, shortcut: "Mod+Shift+[", keywords: ["arrange", "row"], when: () => patches().length > 1, disabledReason: "Select 2 or more patches", run: run((t) => t.actions.align("top")) },
    { id: "patchEditor.alignBottom", title: "Align Bottom Edges", category, scope, shortcut: "Mod+Shift+]", keywords: ["arrange", "row"], when: () => patches().length > 1, disabledReason: "Select 2 or more patches", run: run((t) => t.actions.align("bottom")) },
    {
      id: "patchEditor.publishPort",
      title: "Publish or Unpublish Port",
      category,
      scope,
      shortcut: "Alt+P",
      keywords: ["publish", "unpublish", "expose", "interface", "component input", "component output", "property"],
      description: "Point at a port inside a component and press ⌥P",
      when: () => !!publishTarget(),
      disabledReason: "Point at a port inside a component, then press ⌥P",
      run: run((t) => {
        const port = publishTarget();
        if (port) t.actions.togglePublish(port.address, port.side);
      }),
    },
    { id: "patchEditor.mute", title: "Mute or Unmute Patches", category, scope, shortcut: "M", keywords: ["bypass", "disable"], when: () => patches().length > 0, disabledReason: "Select patches first", run: run((t) => t.actions.toggleMute()) },
    { id: "patchEditor.collapse", title: "Collapse or Expand Patches", category, scope, shortcut: "H", when: () => patches().length > 0, disabledReason: "Select patches first", run: run((t) => t.actions.toggleCollapse()) },
    { id: "patchEditor.createComponent", title: "Group Patches into Component", category, scope, shortcut: cmds.platform === "mac" ? "Mod+Ctrl+G" : "Ctrl+Alt+G", keywords: ["component", "reuse", "create component"], when: () => patches().length > 0, disabledReason: "Select patches first", run: run((t) => t.actions.groupIntoComponent()) },
    {
      id: "patchEditor.enterComponent",
      title: "Enter Component Patch",
      category,
      scope,
      shortcut: "Alt+Down",
      when: () => {
        const id = singlePatch();
        const t = target();
        return !!id && !!t && !!t.session.document.getState().doc.components[t.componentId]?.patches[id]?.component;
      },
      run: run((t) => void t.actions.enterComponent(singlePatch()!)),
    },
    { id: "patchEditor.exitComponent", title: "Exit Component", category, scope, shortcut: "Alt+Up", when: () => (target()?.session.selection.getState().componentPath.length ?? 0) > 1, run: run((t) => void t.actions.exitComponent()) },
    { id: "patchEditor.patchInfo", title: "Patch Info", category, scope, shortcut: "Mod+I", keywords: ["docs", "help"], when: () => !!singlePatch(), run: run((t) => t.actions.openInfo(singlePatch()!)) },
    { id: "patchEditor.rename", title: "Rename Patch", category, scope, shortcut: "Enter", when: () => !!singlePatch(), run: run((t) => t.ui.getState().set({ editingTitle: singlePatch()! })) },
    {
      id: "patchEditor.zoomIn",
      title: "Zoom In",
      category,
      scope,
      shortcut: ["Mod+=", "Mod++"],
      run: run((t) => {
        t.markManual();
        void t.flow().zoomIn({ duration: 120 });
      }),
    },
    {
      id: "patchEditor.zoomOut",
      title: "Zoom Out",
      category,
      scope,
      shortcut: "Mod+-",
      run: run((t) => {
        t.markManual();
        void t.flow().zoomOut({ duration: 120 });
      }),
    },
    {
      id: "patchEditor.zoomReset",
      title: "Zoom to 100%",
      category,
      scope,
      shortcut: "Mod+0",
      run: run((t) => {
        t.markManual();
        void t.flow().zoomTo(1, { duration: 160 });
      }),
    },
    { id: "patchEditor.zoomToFit", title: "Zoom to Fit Patches", category, scope, shortcut: "Shift+1", run: run((t) => void t.flow().fitView({ duration: 200, padding: FIT_VIEW_PADDING })) },
    { id: "patchEditor.toggleMinimap", title: "Show or Hide Minimap", category, scope, shortcut: "Shift+M", run: run((t) => t.ui.getState().set({ minimap: !t.ui.getState().minimap })) },
    { id: "patchEditor.cancelConnect", title: "Cancel Connecting", category, scope, shortcut: "Escape", hidden: true, when: () => !!target()?.ui.getState().armed, run: run((t) => t.ui.getState().set({ armed: null })) },
  ];
  const unregister = cmds.registry.register(commands.filter((c) => !cmds.registry.get(c.id)));
  const unbind = singleKeyInserts(registry).map((insert) =>
    cmds.shortcuts.bind({ id: `patchEditor.insert.${insert.type}`, shortcut: insert.shortcut, scope, when: () => !!target()?.hovering(), handler: () => target()?.actions.insertAtPointer(insert.type) }),
  );
  return () => {
    unregister();
    for (const u of unbind) u();
  };
}

/** Register commands once per command registry; returns a function that routes them to this editor. */
function useCommandTarget(enabled: boolean, target: CommandTarget): () => void {
  const cmds = useOptionalCommands();
  const latest = useLatest(target);
  const getterRef = useRef<() => CommandTarget>(() => latest.current);
  useEffect(() => {
    if (!enabled || !cmds) return;
    let entry = commandEntries.get(cmds.registry);
    if (!entry) {
      const created: CommandEntry = { count: 0, current: null, dispose: () => undefined };
      created.dispose = registerPatchEditorCommands(cmds, created, latest.current.session.registry);
      commandEntries.set(cmds.registry, created);
      entry = created;
    }
    entry.count++;
    const getter = getterRef.current;
    entry.current ??= getter;
    const e = entry;
    return () => {
      e.count--;
      if (e.current === getter) e.current = null;
      if (e.count === 0) {
        e.dispose();
        commandEntries.delete(cmds.registry);
      }
    };
  }, [enabled, cmds, latest]);
  return useCallback(() => {
    const entry = cmds ? commandEntries.get(cmds.registry) : undefined;
    if (entry) entry.current = getterRef.current;
  }, [cmds]);
}

export { portKey };
