/**
 * Patch editor edits bound to a session and component. Every document change goes through the
 * document store's apply() in one batch with a human undo label; failures become toasts.
 */

import {
  findLayer,
  getPatchSpec,
  isLinkInput,
  type ApplyOpsResult,
  type Id,
  type InputValue,
  type Op,
  type PatchNode,
  type ValueType,
} from "@sonobe/core";
import type { PatchRegistry } from "@sonobe/patches";
import type { ReactFlowInstance } from "@xyflow/react";
import { createComponentFromSelection, duplicateSelection, exitComponent as exitComponentAction, revealBroadcaster } from "../../../state/editActions.ts";
import type { EditorSession } from "../../../state/session.ts";
import type { Placement } from "../../../ui/lib/position.ts";
import { toast } from "../../../ui/Toast.tsx";
import { VALUE_TYPE_LABELS } from "../../../ui/PortGlyph.tsx";
import { checkConnection, placeSuggestion, portTypeAt } from "../model/connect.ts";
import {
  alignPositions,
  ALIGN_LABELS,
  commentAroundOps,
  duplicatePatchOps,
  insertPatchOps,
  movePatchOps,
  patchesLabel,
  patchTitle,
  portLabel,
  replacePatchOp,
  splicePatchOps,
  type AlignMode,
  type InsertOptions,
} from "../model/editOps.ts";
import { estimateNodeSize, HEADER_HEIGHT, layerNameIn, portCenterY, type Rect } from "../model/geometry.ts";
import { instanceChoiceKey } from "../model/instances.ts";
import { nodePositionsOp } from "@sonobe/core";
import { publishedKeyOf, publishPortPlan, unpublishOps, withoutDefault, type PublishSide } from "../model/publish.ts";
import { newVariablePatch } from "../model/variables.ts";
import { documentObstacles, estimatePatchSize, findFreePosition, planTidy, tidyPlanOps, type PlacementBias, type PlacementObstacles, type TidyFrame, type TidyNode, type TidyScope } from "@sonobe/core/graph";
import { nodeTextMeasurer } from "../model/measure.ts";
import { elkGroupLayout } from "../model/tidy.ts";
import {
  commentIdOfNode,
  commentNodeId,
  flowNodeKind,
  INPUTS_NODE_ID,
  layerIdOfNode,
  layerNodeId,
  type CableFlowEdge,
  type FlowNode,
  type GraphNodeData,
} from "../model/types.ts";
import { patchEditorBridge } from "./bridge.ts";
import type { UiStore } from "./uiStore.ts";

export type XY = { x: number; y: number };

export interface PickerRequest {
  /** Flow position for the new patch (default: pointer or viewport center). */
  position?: XY;
  /** Replace this patch instead of inserting. */
  replace?: Id;
}

export interface LinkSearchRequest {
  /** Viewport point where the cable was dropped. */
  client: XY;
  /** Flow position of the drop. */
  position: XY;
  side: "in" | "out";
  address: string;
  type: ValueType;
  patchType?: string;
  /** Only this layer's properties (a cable dropped on a layer node or a layer row). */
  layer?: Id;
  /** Choosing what drives a layer property: outputs in the graph first, then patches. */
  drive?: boolean;
  /** A picked-up cable end being moved off this input. */
  reroute?: string;
  /** The node the cable came from (left out of "in this graph"). */
  sourceNode?: string;
  /** Name of the property being driven ("Scale"), for the placeholder. */
  targetName?: string;
  /** No cable: choose a property of `layer` to drive. */
  chooseProperty?: boolean;
  placement?: Placement;
}

export interface ActionDeps {
  session: EditorSession;
  registry: PatchRegistry;
  componentId: Id;
  ui: UiStore;
  flow: () => ReactFlowInstance<FlowNode, CableFlowEdge> | null;
  /** Last pointer position over the canvas in flow coordinates. */
  pointer: () => XY | null;
  openPicker: (request: PickerRequest) => void;
  openInfo: (patchId: Id) => void;
}

export interface TidyUpOptions {
  /** Tidy inside these comment frames only. */
  frames?: readonly Id[];
  /** Tidy everything and lay the frames out as blocks too, instead of keeping them in place. */
  arrange?: boolean;
}

export interface InsertPatchOptions extends InsertOptions {
  /** Connect the new patch to a port ("out": the address drives the new patch's `portKey`). */
  connect?: { address: string; side: "in" | "out"; portKey: string };
  /** "exact" uses the position as given; otherwise the nearest free spot, looking to that side first. Default "any". */
  placement?: "exact" | PlacementBias;
}

export interface PatchEditorActions {
  apply(ops: readonly Op[], label: string, options?: { coalesceKey?: string; quiet?: boolean }): ApplyOpsResult;
  insertPatch(type: string, position: XY, options?: InsertPatchOptions): Id | undefined;
  insertAtPointer(type: string): void;
  connect(from: string, to: string): boolean;
  reroute(from: string, oldTo: string, newTo: string): void;
  disconnect(addresses: readonly string[], label?: string): void;
  explainConnection(from: string, to: string, position: XY): void;
  setLiteral(address: string, value: InputValue | null, options?: { coalesce?: boolean }): void;
  rename(patchId: Id, name: string): void;
  toggleMute(ids?: readonly Id[]): void;
  toggleCollapse(ids?: readonly Id[]): void;
  changeType(patchId: Id, typeParam: ValueType): void;
  setInputCount(patchId: Id, count: number): void;
  replaceWith(patchId: Id, type: string, componentTarget?: Id): void;
  duplicateWithInputs(ids: readonly Id[], positions: ReadonlyMap<Id, XY>): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  selectAll(): void;
  moveNodes(positions: ReadonlyMap<string, XY>, label?: string, coalesceKey?: string): void;
  /** Move a patch and splice it into a cable, through the chosen ports (default: the best fit). */
  moveAndSplice(patchId: Id, position: XY, cable: { from: string; to: string }, choice?: { inputKey: string; outputKey: string }): void;
  cutCables(edgeIds: readonly string[]): void;
  align(mode: AlignMode): void;
  /**
   * Tidy Up. Without options it follows the selection: selected comments tidy inside those frames,
   * two or more selected nodes tidy those nodes (each within its frame), nothing tidies everything.
   * Frames stay where they are, refit and pushed apart, unless `arrange` lays them out too.
   */
  tidyUp(options?: TidyUpOptions): Promise<void>;
  commentSelection(): void;
  updateComment(commentId: Id, changes: { text?: string; rect?: [number, number, number, number]; color?: string }, label: string): void;
  groupIntoComponent(): void;
  enterComponent(patchId: Id): boolean;
  exitComponent(): boolean;
  /** Enter a component patch with nothing selected, so the inspector shows its name, notes, and published ports. */
  openComponentInfo(patchId: Id): void;
  renameComponent(componentId: Id, name: string): void;
  /** Publish a port inside a component as a component input ("in") or output ("out"). */
  publishPort(address: string, side: PublishSide): boolean;
  unpublishPort(key: string, side: PublishSide): void;
  /** Publish the port, or unpublish it when it's already published (⌥P). */
  togglePublish(address: string, side: PublishSide): void;
  /** Select and reveal the broadcaster a Variable Receiver reads (in an enclosing component for a global variable). */
  jumpToBroadcaster(receiverId: Id): boolean;
  revealLayer(layerId: Id): void;
  /** Show a layer property on its node and open the picker to choose what drives it. */
  driveLayerProp(layerId: Id, prop: string): void;
  /** Hide undriven property targets (of one layer, or all). */
  removeLayerTargets(layerId?: Id): void;
  selectedPatchIds(): Id[];
  openPicker(request?: PickerRequest): void;
  openInfo(patchId: Id): void;
}

const quietToast = (title: string, description?: string) => void toast({ title, ...(description ? { description } : {}), tone: "warn" });

const article = (label: string) => `${/^[AEIOU]/.test(label) ? "an" : "a"} ${label.toLowerCase()}`;

export function createPatchEditorActions(deps: ActionDeps): PatchEditorActions {
  const { session, registry, componentId, ui } = deps;
  const docState = () => session.document.getState();
  const doc = () => docState().doc;
  const component = () => doc().components[componentId];
  const selection = () => session.selection.getState();
  const bridge = () => patchEditorBridge(session).getState();

  const nodeRect = (node: FlowNode): Rect => {
    const size = node.measured?.width && node.measured.height ? { width: node.measured.width, height: node.measured.height } : estimateNodeSize(node.data as GraphNodeData, layerNameIn(component()));
    return { x: node.position.x, y: node.position.y, ...size };
  };
  const flowNodes = () => deps.flow()?.getNodes() ?? [];

  /** What new patches must not overlap: rendered nodes (measured) and comment frames. */
  const obstacles = (): PlacementObstacles => {
    const nodes = flowNodes();
    if (nodes.length === 0) {
      const c = component();
      return c ? documentObstacles(doc(), c, registry, { measure: nodeTextMeasurer() }) : { nodes: [] };
    }
    return {
      nodes: nodes.filter((n) => n.type !== "comment").map(nodeRect),
      comments: nodes.filter((n) => n.type === "comment").map((n) => ({ x: n.position.x, y: n.position.y, width: n.width ?? n.measured?.width ?? 240, height: n.height ?? n.measured?.height ?? 120 })),
    };
  };

  const freeSpot = (node: PatchNode, preferred: XY, bias: PlacementBias, extra: readonly Rect[] = []): XY => {
    const base = obstacles();
    return findFreePosition(estimatePatchSize(doc(), registry, node, { component: componentId, measure: nodeTextMeasurer() }), preferred, { ...base, nodes: [...base.nodes, ...extra] }, { bias });
  };

  const apply: PatchEditorActions["apply"] = (ops, label, options = {}) => {
    const result = docState().apply(ops, { label, defaultComponent: componentId, ...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}) });
    if (!result.ok && !options.quiet) {
      const error = result.errors.find((e) => e.code !== "skipped") ?? result.errors[0];
      quietToast(error?.message ?? "That change couldn't be made.", error?.hint);
    }
    return result;
  };

  const select = (patches: readonly Id[], comments: readonly Id[] = []) => selection().select({ patches, comments, layers: [] });

  const selectedPatchIds = () => {
    const c = component();
    return c ? selection().patches.filter((id) => id in c.patches) : [];
  };

  const connected = (addresses: readonly string[]) => bridge().removeTargets(componentId, addresses);

  const actions: PatchEditorActions = {
    apply,
    selectedPatchIds,

    insertPatch(type, position, options = {}) {
      const spec = getPatchSpec(registry, type);
      if (!spec) {
        quietToast(`There's no patch type "${type}".`);
        return undefined;
      }
      const { connect, placement = "any", ...insert } = options;
      // Variables: a broadcaster gets a free name (after the output it's inserted from); a receiver the only variable it can read.
      const path = selection().componentPath;
      const variable = newVariablePatch(doc(), registry, path.at(-1) === componentId ? path : [componentId], type, connect?.side === "out" ? connect.address : undefined);
      if (variable.settings && !insert.settings) insert.settings = variable.settings;
      if (variable.typeParam && !insert.typeParam) insert.typeParam = variable.typeParam as ValueType;
      let at = position;
      if (placement !== "exact") {
        const virtual: PatchNode = { type, inputs: {}, ui: { x: 0, y: 0 } };
        if (insert.typeParam) virtual.typeParam = insert.typeParam;
        if (insert.inputCount !== undefined) virtual.inputCount = insert.inputCount;
        if (insert.component !== undefined) virtual.component = insert.component;
        if (insert.name) virtual.name = insert.name;
        at = freeSpot(virtual, position, placement);
      }
      const ops = insertPatchOps(componentId, type, at, { ...insert, ref: "inserted" });
      if (connect) {
        ops.push(connect.side === "out" ? { op: "connect", component: componentId, from: connect.address, to: `$inserted.${connect.portKey}` } : { op: "connect", component: componentId, from: `$inserted.${connect.portKey}`, to: connect.address });
      }
      const name = options.name ?? spec.name;
      const result = apply(ops, connect ? `Add ${name} and connect` : `Add ${name}`);
      const id = result.ok ? result.idMap.inserted : undefined;
      if (id) {
        select([id]);
        if (connect?.side === "in") connected([connect.address]);
      }
      return id;
    },

    insertAtPointer(type) {
      const flow = deps.flow();
      const pointer = deps.pointer() ?? (flow ? centerOfView(flow) : { x: 0, y: 0 });
      actions.insertPatch(type, { x: pointer.x - 24, y: pointer.y - HEADER_HEIGHT / 2 });
    },

    connect(from, to) {
      const current = doc().components[componentId];
      const existing = findInput(current, to);
      if (isLinkInput(existing) && existing.link === from) return true;
      const d = doc();
      const result = apply([{ op: "connect", component: componentId, from, to }], `Connect ${portLabel(d, componentId, registry, from)} to ${portLabel(d, componentId, registry, to)}`, { quiet: true });
      if (!result.ok) {
        const flow = deps.flow();
        actions.explainConnection(from, to, deps.pointer() ?? (flow ? centerOfView(flow) : { x: 0, y: 0 }));
      } else connected([to]);
      return result.ok;
    },

    reroute(from, oldTo, newTo) {
      if (oldTo === newTo) return;
      const d = doc();
      const result = apply(
        [
          { op: "disconnect", component: componentId, to: oldTo },
          { op: "connect", component: componentId, from, to: newTo },
        ],
        `Move cable to ${portLabel(d, componentId, registry, newTo)}`,
        { quiet: true },
      );
      if (!result.ok) {
        const flow = deps.flow();
        actions.explainConnection(from, newTo, deps.pointer() ?? (flow ? centerOfView(flow) : { x: 0, y: 0 }));
      } else connected([newTo]);
    },

    disconnect(addresses, label) {
      const c = component();
      const live = addresses.filter((a) => isLinkInput(findInput(c, a)));
      if (live.length === 0) return;
      apply(
        live.map((to): Op => ({ op: "disconnect", component: componentId, to })),
        label ?? (live.length === 1 ? `Disconnect ${portLabel(doc(), componentId, registry, live[0]!)}` : `Disconnect ${live.length} cables`),
      );
      ui.getState().set({ selectedEdges: ui.getState().selectedEdges.filter((id) => !live.some((a) => id === `cable:${a}`)) });
    },

    explainConnection(from, to, position) {
      const check = checkConnection(doc(), componentId, registry, from, to);
      if (check.ok) return;
      const suggestion = check.suggestions.find((s) => s.ops?.some((op) => op.op === "addPatch"));
      const added = suggestion?.ops?.find((op) => op.op === "addPatch");
      const converter = added && added.op === "addPatch" ? getPatchSpec(registry, added.patch.type) : undefined;
      const d = doc();
      const fromType = portTypeAt(d, componentId, registry, from, "out");
      const toType = portTypeAt(d, componentId, registry, to, "in");
      const title =
        check.code === "type_mismatch" && fromType && toType
          ? `${portLabel(d, componentId, registry, from)} is ${article(VALUE_TYPE_LABELS[fromType])}, but ${portLabel(d, componentId, registry, to)} needs ${article(VALUE_TYPE_LABELS[toType])}.`
          : (check.reason ?? "Those ports don't connect.");
      void toast({
        id: "patch-editor-connect",
        title,
        ...(suggestion ? { description: suggestion.description } : check.hint ? { description: check.hint } : {}),
        tone: "warn",
        ...(suggestion && converter
          ? {
              action: {
                label: `Insert ${converter.name}`,
                onClick: () => {
                  const placed: Rect[] = [];
                  const ops = placeSuggestion(suggestion, componentId, position).map((op): Op => {
                    if (op.op !== "addPatch" || !op.patch.ui) return op;
                    const node: PatchNode = { type: op.patch.type, inputs: {}, ui: { x: op.patch.ui.x, y: op.patch.ui.y } };
                    if (op.patch.typeParam) node.typeParam = op.patch.typeParam;
                    const at = freeSpot(node, op.patch.ui, "any", placed);
                    placed.push({ ...at, ...estimatePatchSize(doc(), registry, node, { component: componentId, measure: nodeTextMeasurer() }) });
                    return { ...op, patch: { ...op.patch, ui: { ...op.patch.ui, ...at } } };
                  });
                  const result = apply(ops, `Insert ${converter.name} between ${portLabel(doc(), componentId, registry, from)} and ${portLabel(doc(), componentId, registry, to)}`);
                  const id = Object.values(result.idMap)[0];
                  if (result.ok && id) {
                    select([id]);
                    connected([to]);
                  }
                },
              },
            }
          : {}),
      });
    },

    setLiteral(address, value, options = {}) {
      const label = `Change ${portLabel(doc(), componentId, registry, address)}`;
      apply([{ op: "setInput", component: componentId, target: address, value }], label, options.coalesce ? { coalesceKey: `literal:${componentId}:${address}` } : {});
    },

    rename(patchId, name) {
      const node = component()?.patches[patchId];
      if (!node) return;
      const spec = getPatchSpec(registry, node.type);
      const trimmed = name.trim();
      const next = trimmed === spec?.name ? "" : trimmed;
      if ((node.name ?? "") === next) return;
      apply([{ op: "rename", component: componentId, id: patchId, name: next }], next ? `Rename ${patchTitle(node, spec)} to ${next}` : `Reset name of ${patchTitle(node, spec)}`);
    },

    toggleMute(ids) {
      const c = component();
      const targets = (ids ?? selectedPatchIds()).filter((id) => c?.patches[id]);
      if (!c || targets.length === 0) return;
      const mute = !targets.every((id) => c.patches[id]!.muted);
      apply(
        targets.map((id): Op => ({ op: "updatePatch", component: componentId, id, muted: mute })),
        `${mute ? "Mute" : "Unmute"} ${patchesLabel(c, targets, registry)}`,
      );
    },

    toggleCollapse(ids) {
      const c = component();
      const targets = (ids ?? selectedPatchIds()).filter((id) => c?.patches[id]);
      if (!c || targets.length === 0) return;
      const collapse = !targets.every((id) => c.patches[id]!.ui.collapsed);
      apply(
        targets.map((id): Op => ({ op: "updatePatch", component: componentId, id, ui: { collapsed: collapse } })),
        `${collapse ? "Collapse" : "Expand"} ${patchesLabel(c, targets, registry)}`,
      );
    },

    changeType(patchId, typeParam) {
      const c = component();
      const node = c?.patches[patchId];
      if (!c || !node || node.typeParam === typeParam) return;
      apply([{ op: "updatePatch", component: componentId, id: patchId, typeParam }], `Change ${patchesLabel(c, [patchId], registry)} to ${typeParam}`);
    },

    setInputCount(patchId, count) {
      const c = component();
      const node = c?.patches[patchId];
      if (!c || !node || node.inputCount === count) return;
      apply([{ op: "updatePatch", component: componentId, id: patchId, inputCount: count }], `Set ${patchesLabel(c, [patchId], registry)} to ${count} inputs`);
    },

    replaceWith(patchId, type, componentTarget) {
      const c = component();
      const plan = replacePatchOp(doc(), componentId, registry, patchId, type, componentTarget);
      if ("error" in plan) {
        quietToast(plan.error);
        return;
      }
      const spec = getPatchSpec(registry, type);
      const result = apply([plan.op], `Replace ${c ? patchesLabel(c, [patchId], registry) : "patch"} with ${spec?.name ?? type}`);
      if (!result.ok) return;
      // The patch keeps its id, so the selection and simulator paths stay on it.
      select([patchId]);
      const cut = result.results[0]?.dropped?.filter((d) => isLinkInput(d.value)).length ?? 0;
      if (cut > 0) void toast({ title: `${cut === 1 ? "1 cable" : `${cut} cables`} didn't fit ${spec?.name ?? type} and ${cut === 1 ? "was" : "were"} removed.`, tone: "neutral" });
    },

    duplicateWithInputs(ids, positions) {
      const c = component();
      if (!c || ids.length === 0) return;
      const plan = duplicatePatchOps(c, ids, positions);
      const result = apply(plan.ops, `Duplicate ${patchesLabel(c, ids, registry)}`);
      if (result.ok) select([...plan.refs.values()].map((ref) => result.idMap[ref]).filter((id): id is Id => !!id));
    },

    duplicateSelection() {
      const result = duplicateSelection(session);
      if (!result.ok && result.message) quietToast(result.message, result.hint);
    },

    deleteSelection() {
      const c = component();
      if (!c) return;
      const s = selection();
      const patches = s.patches.filter((id) => id in c.patches);
      const comments = s.comments.filter((id) => c.comments.some((x) => x.id === id));
      const removed = new Set(patches);
      const ops: Op[] = [];
      const disconnected = new Set<string>();
      const disconnect = (to: string) => {
        if (disconnected.has(to) || !isLinkInput(findInput(c, to))) return;
        disconnected.add(to);
        ops.push({ op: "disconnect", component: componentId, to });
      };
      for (const edgeId of ui.getState().selectedEdges) {
        const to = edgeId.startsWith("cable:") ? edgeId.slice("cable:".length) : undefined;
        const target = to?.match(/^([A-Za-z_][A-Za-z0-9_]*)\./)?.[1];
        if (to && !(target && removed.has(target))) disconnect(to);
      }
      const layerNodes = flowNodes().filter((n) => n.selected && flowNodeKind(n.id) === "layer");
      for (const n of layerNodes) {
        const layerId = layerIdOfNode(n.id)!;
        actions.removeLayerTargets(layerId);
        const layer = findLayer(c.layers, layerId)?.layer;
        for (const [key, value] of Object.entries(layer?.props ?? {})) if (isLinkInput(value)) disconnect(`@${layerId}.${key}`);
      }
      ops.push(...patches.map((id): Op => ({ op: "removePatch", component: componentId, id })));
      ops.push(...comments.map((id): Op => ({ op: "removeComment", component: componentId, id })));
      if (ops.length === 0) {
        if (layerNodes.length) selection().clear();
        return;
      }
      const count = patches.length + comments.length + disconnected.size;
      const label =
        patches.length === 1 && count === 1
          ? `Delete ${patchesLabel(c, patches, registry)}`
          : comments.length === 1 && count === 1
            ? "Delete comment"
            : disconnected.size === count
              ? count === 1
                ? `Disconnect ${portLabel(doc(), componentId, registry, [...disconnected][0]!)}`
                : `Disconnect ${count} cables`
              : `Delete ${count} items`;
      const result = apply(ops, label);
      if (result.ok) {
        selection().clear();
        ui.getState().set({ selectedEdges: [] });
      }
    },

    selectAll() {
      const c = component();
      if (!c) return;
      selection().select({ patches: Object.keys(c.patches), comments: c.comments.map((x) => x.id), layers: [] });
    },

    moveNodes(positions, label, coalesceKey) {
      const c = component();
      if (!c) return;
      const patchPositions = new Map<string, XY>();
      const nodePositions = new Map<string, XY>();
      const ops: Op[] = [];
      let commentsMoved = 0;
      for (const [nodeId, pos] of positions) {
        const kind = flowNodeKind(nodeId);
        if (kind === "patch") patchPositions.set(nodeId, pos);
        else if (kind === "comment") {
          const comment = c.comments.find((x) => x.id === commentIdOfNode(nodeId));
          if (!comment) continue;
          const rect: [number, number, number, number] = [Math.round(pos.x), Math.round(pos.y), comment.rect[2], comment.rect[3]];
          if (rect[0] !== comment.rect[0] || rect[1] !== comment.rect[1]) {
            ops.push({ op: "updateComment", component: componentId, id: comment.id, rect });
            commentsMoved++;
          }
        } else nodePositions.set(nodeId, pos);
      }
      const moves = movePatchOps(c, patchPositions);
      ops.push(...moves);
      const metaOp = nodePositions.size ? nodePositionsOp(c, nodePositions) : undefined;
      if (metaOp) ops.push(metaOp);
      if (ops.length === 0) return;
      const movedPatches = moves.map((op) => (op.op === "updatePatch" ? op.id : "")).filter(Boolean);
      const movedNodes = metaOp ? nodePositions.size : 0;
      const total = movedPatches.length + commentsMoved + movedNodes;
      const nodeName = (nodeId: string) => {
        const layerId = layerIdOfNode(nodeId);
        if (layerId !== undefined) return findLayer(c.layers, layerId)?.layer.name ?? layerId;
        return nodeId === INPUTS_NODE_ID ? "component inputs" : "component outputs";
      };
      const fallback =
        total === movedPatches.length
          ? `Move ${patchesLabel(c, movedPatches, registry)}`
          : total === 1 && commentsMoved === 1
            ? "Move comment"
            : total === 1 && movedNodes === 1
              ? `Move ${nodeName([...nodePositions.keys()][0]!)}`
              : `Move ${total} items`;
      apply(ops, label ?? fallback, coalesceKey ? { coalesceKey } : {});
    },

    moveAndSplice(patchId, position, cable, choice) {
      const c = component();
      const plan = splicePatchOps(doc(), componentId, registry, patchId, cable, choice);
      if ("error" in plan) {
        quietToast(plan.error);
        actions.moveNodes(new Map([[patchId, position]]));
        return;
      }
      const ops = [...movePatchOps(c!, new Map([[patchId, position]])), ...plan.ops];
      apply(ops, `Splice ${patchesLabel(c!, [patchId], registry)} into cable`);
    },

    cutCables(edgeIds) {
      const addresses = edgeIds.filter((id) => id.startsWith("cable:")).map((id) => id.slice("cable:".length));
      if (addresses.length) actions.disconnect(addresses, addresses.length === 1 ? `Cut ${portLabel(doc(), componentId, registry, addresses[0]!)}` : `Cut ${addresses.length} cables`);
    },

    align(mode) {
      const c = component();
      const ids = new Set(selectedPatchIds());
      const commentIds = new Set(selection().comments);
      const nodes = flowNodes().filter((n) => ids.has(n.id) || commentIds.has(commentIdOfNode(n.id) ?? ""));
      if (!c || nodes.length < 2) return;
      const positions = alignPositions(nodes.map((n) => ({ id: n.id, ...nodeRect(n) })), mode);
      actions.moveNodes(positions, `Align ${nodes.length} items ${ALIGN_LABELS[mode]}`);
    },

    async tidyUp(options = {}) {
      const c = component();
      const flow = deps.flow();
      if (!c || !flow) return;
      const all = flowNodes();
      const nodes: TidyNode[] = [];
      const frames: TidyFrame[] = [];
      for (const n of all) {
        const data = n.data as GraphNodeData;
        if (data.kind === "comment") {
          frames.push({ id: data.commentId, x: n.position.x, y: n.position.y, width: n.width ?? n.measured?.width ?? 240, height: n.height ?? n.measured?.height ?? 120 });
          continue;
        }
        const shape = { collapsed: data.kind === "patch" && data.collapsed };
        const ports = [...data.inputs.map((p, i) => ({ id: p.handleId, side: "in" as const, y: portCenterY(shape, i) })), ...data.outputs.map((p, i) => ({ id: p.handleId, side: "out" as const, y: portCenterY(shape, i) }))];
        nodes.push({ id: n.id, ...nodeRect(n), ports });
      }
      if (nodes.length === 0) return;
      const edges = flow.getEdges().map((e) => ({ source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target, targetHandle: e.targetHandle ?? null }));
      // The selection picks the scope: comments → inside those frames, 2+ nodes → those nodes, nothing → everything.
      const present = new Set(nodes.map((n) => n.id));
      const selectedNodes = [...selectedPatchIds(), ...selection().layers.map(layerNodeId)].filter((id) => present.has(id));
      const selectedFrames = selection().comments.filter((id) => frames.some((f) => f.id === id));
      const scope: TidyScope = options.arrange
        ? { kind: "all" }
        : options.frames
          ? { kind: "frames", ids: options.frames }
          : selectedFrames.length
            ? { kind: "frames", ids: selectedFrames }
            : selectedNodes.length >= 2
              ? { kind: "nodes", ids: selectedNodes }
              : { kind: "all" };
      let plan;
      try {
        plan = await planTidy({ nodes, edges, frames, scope, frameMode: options.arrange ? "arrange" : "keep" }, await elkGroupLayout());
      } catch (err) {
        quietToast("Tidy Up couldn't lay out these patches.", err instanceof Error ? err.message : undefined);
        return;
      }
      const current = component();
      if (!current) return;
      const ops = tidyPlanOps(current, plan);
      const patches = ops.filter((op) => op.op === "updatePatch").length;
      const label = options.arrange ? "Arrange frames" : patches ? `Tidy up ${patches === 1 ? "1 patch" : `${patches} patches`}` : "Tidy up";
      if (ops.length) apply(ops, label);
    },

    commentSelection() {
      const ids = new Set(selectedPatchIds());
      const rects = flowNodes().filter((n) => ids.has(n.id)).map(nodeRect);
      const flow = deps.flow();
      if (rects.length === 0) {
        const at = deps.pointer() ?? (flow ? centerOfView(flow) : { x: 0, y: 0 });
        rects.push({ x: at.x, y: at.y, width: 280, height: 100 });
      }
      const result = apply(commentAroundOps(componentId, rects, "Comment"), "Add comment");
      const id = result.idMap.comment;
      if (result.ok && id) {
        select([], [id]);
        ui.getState().set({ editingTitle: commentNodeId(id) });
      }
    },

    updateComment(commentId, changes, label) {
      const c = component();
      const comment = c?.comments.find((x) => x.id === commentId);
      if (!comment) return;
      const op: Op = { op: "updateComment", component: componentId, id: commentId };
      if (changes.text !== undefined && changes.text !== comment.text) op.text = changes.text;
      if (changes.color !== undefined && changes.color !== comment.color) op.color = changes.color;
      if (changes.rect && changes.rect.some((v, i) => v !== comment.rect[i])) op.rect = changes.rect.map((v) => Math.round(v)) as [number, number, number, number];
      if (op.text === undefined && op.color === undefined && op.rect === undefined) return;
      apply([op], label);
    },

    groupIntoComponent() {
      const result = createComponentFromSelection(session);
      if (!result.ok) {
        if (result.message) quietToast(result.message, result.hint);
        return;
      }
      // Name it right away: the new component patch's title starts editing, and committing names the component.
      if (result.componentId && result.instanceId && component()?.patches[result.instanceId]) ui.getState().set({ editingTitle: result.instanceId, namingComponent: result.componentId });
    },

    enterComponent(patchId) {
      const node = component()?.patches[patchId];
      if (!node?.component || !doc().components[node.component]) return false;
      bridge().chooseInstance(instanceChoiceKey(componentId, node.component), patchId);
      selection().enterComponent(node.component);
      return true;
    },

    exitComponent: () => exitComponentAction(session),

    openComponentInfo(patchId) {
      if (actions.enterComponent(patchId)) selection().clear();
    },

    renameComponent(targetId, name) {
      const target = doc().components[targetId];
      const trimmed = name.trim();
      if (!target || !trimmed || trimmed === target.name) return;
      apply([{ op: "updateComponent", id: targetId, name: trimmed }], `Rename component “${target.name}” to “${trimmed}”`);
    },

    publishPort(address, side) {
      const d = doc();
      const plan = publishPortPlan(d, componentId, registry, address, side);
      if ("error" in plan) {
        quietToast(plan.error, plan.hint);
        return false;
      }
      const label = `Publish ${portLabel(d, componentId, registry, address)}`;
      let result = apply(plan.ops, label, { quiet: true });
      // A current value core can't keep as a default (an unusual type): publish without one.
      if (!result.ok && side === "in") result = apply(withoutDefault(plan).ops, label, { quiet: true });
      if (!result.ok) {
        const error = result.errors.find((e) => e.code !== "skipped") ?? result.errors[0];
        quietToast(error?.message ?? "That port couldn't be published.", error?.hint);
        return false;
      }
      void toast({
        id: "patch-editor-publish",
        title: `Published “${plan.name}”`,
        description: side === "in" ? "It's a property wherever this component is placed." : "Patches where this component is placed can read it now.",
        tone: "success",
      });
      return true;
    },

    unpublishPort(key, side) {
      const c = component();
      if (!c) return;
      const port = side === "in" ? c.interface.inputs[key] : c.interface.outputs[key];
      const ops = unpublishOps(c, key, side);
      if (port && ops.length) apply(ops, `Unpublish “${port.name}”`);
    },

    togglePublish(address, side) {
      const c = component();
      const key = c ? publishedKeyOf(c, address, side) : undefined;
      if (key !== undefined) actions.unpublishPort(key, side);
      else actions.publishPort(address, side);
    },

    jumpToBroadcaster(receiverId) {
      const result = revealBroadcaster(session, receiverId);
      if (!result.ok && result.message) quietToast(result.message, result.hint);
      return result.ok;
    },

    revealLayer(layerId) {
      selection().select({ layers: [layerId], patches: [], comments: [] });
      selection().requestReveal(componentId, [layerId]);
    },

    driveLayerProp(layerId, prop) {
      const layer = component() ? findLayer(component()!.layers, layerId)?.layer : undefined;
      if (!layer) return;
      const address = `@${layerId}.${prop}`;
      if (!isLinkInput(layer.props[prop])) bridge().addTarget(componentId, address);
      bridge().requestDrive(componentId, address);
    },

    removeLayerTargets(layerId) {
      const current = bridge().targets[componentId] ?? [];
      const drop = layerId === undefined ? current : current.filter((a) => a.startsWith(`@${layerId}.`));
      if (drop.length) bridge().removeTargets(componentId, drop);
    },

    openPicker: (request = {}) => deps.openPicker(request),
    openInfo: (patchId) => deps.openInfo(patchId),
  };
  return actions;
}

function findInput(component: ReturnType<EditorSession["document"]["getState"]>["doc"]["components"][string] | undefined, address: string): InputValue | undefined {
  if (!component) return undefined;
  const m = /^(@)?([A-Za-z_][A-Za-z0-9_]*|\$out)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(address);
  if (!m) return undefined;
  const [, at, id, key] = m as unknown as [string, string | undefined, string, string];
  if (id === "$out") {
    const link = component.interface.outputs[key]?.link;
    return link === undefined ? undefined : { link };
  }
  if (at) return findLayer(component.layers, id)?.layer.props[key];
  return component.patches[id]?.inputs[key];
}

/** The flow position at the center of the visible canvas. */
export function centerOfView(flow: Pick<ReactFlowInstance, "screenToFlowPosition">, element?: Element | null): XY {
  const rect = element?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : typeof window !== "undefined" ? window.innerWidth / 2 : 0;
  const y = rect ? rect.top + rect.height / 2 : typeof window !== "undefined" ? window.innerHeight / 2 : 0;
  return flow.screenToFlowPosition({ x, y });
}
