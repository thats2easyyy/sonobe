/**
 * The patch graph view model: what the patch editor draws for a component (patch nodes, layer
 * property targets, component interface nodes, comments, and cables). Pure data, shaped so React
 * Flow takes the nodes and edges as they are. Headless tools (MCP, graph drawings) read the same
 * model, so there is one rule for what a node shows.
 */

import type { EnumOption, Id, InputValue, PatchCategory, Suggestion, Value, ValueSubtype, ValueType } from "../types.ts";
import { INPUTS_NODE_ID, OUTPUTS_NODE_ID } from "./graphNodes.ts";

export type PortSide = "in" | "out";

export interface PortIssue {
  severity: "error" | "warning";
  message: string;
}

/** One port row as the patch editor shows it. */
export interface PortModel {
  key: string;
  name: string;
  side: PortSide;
  type: ValueType;
  subtype?: ValueSubtype;
  description: string;
  /** Document address: "pop.number", "@card.scale", "$in.key", "$out.key". */
  address: string;
  /** React Flow handle id: "in:number", "out:output". */
  handleId: string;
  connected: boolean;
  /** Inputs: the driving address when linked. */
  link?: string;
  /** Inputs: the stored literal (undefined means the default applies). */
  literal?: InputValue;
  /** Declared default in runtime form. */
  defaultValue?: Value;
  min?: number;
  max?: number;
  step?: number;
  enumOptions?: EnumOption[];
  /** Statically carries a loop (outputs) or receives one (inputs). */
  loop?: boolean;
  /** Takes or produces the whole loop at once. */
  wholeLoop?: boolean;
  issue?: PortIssue;
  /**
   * Inputs linked to a knob: a chip with the knob's name (and value) instead of a cable. A color
   * knob's chip shows its running color ("#RRGGBBAA") as a swatch instead of the value text.
   */
  knob?: { id: string; name: string; valueText?: string; color?: string };
}

export interface NodeIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  port?: string;
  suggestions?: Suggestion[];
}

export interface PatchNodeData extends Record<string, unknown> {
  kind: "patch";
  componentId: Id;
  patchId: Id;
  type: string;
  /** Custom name, or the type's name. */
  title: string;
  /** The type's display name ("Pop Animation"). */
  specName: string;
  customName: boolean;
  category: PatchCategory;
  /** False when the patch type isn't in the registry. */
  known: boolean;
  typeParam?: ValueType;
  variants?: readonly ValueType[];
  inputCount?: number;
  variadic?: { min: number; max: number; name: string };
  inputs: PortModel[];
  outputs: PortModel[];
  /** Advanced inputs hidden because they're unset and unconnected. */
  hiddenInputs: number;
  muted: boolean;
  collapsed: boolean;
  looped: boolean;
  /** Loop length known without running (literal loops, loop counts). */
  loopLength?: number;
  issues: NodeIssue[];
  /** Agents working on this patch ("Claude"). */
  working: readonly string[];
  /** Component patches: the component they run. */
  componentTarget?: Id;
  /** The layer a layer input points at, for "Reveal layer". */
  layerRef?: Id;
}

export interface LayerNodeData extends Record<string, unknown> {
  kind: "layer";
  componentId: Id;
  layerId: Id;
  title: string;
  layerType: string;
  layerTypeName: string;
  /** Bound properties (driven by cables). */
  inputs: PortModel[];
  /** Outputs and properties other patches read. */
  outputs: PortModel[];
  issues: NodeIssue[];
}

export interface InterfaceNodeData extends Record<string, unknown> {
  kind: "interface";
  componentId: Id;
  /** "inputs": published inputs as sources; "outputs": published outputs as targets. */
  side: "inputs" | "outputs";
  title: string;
  inputs: PortModel[];
  outputs: PortModel[];
}

export interface CommentNodeData extends Record<string, unknown> {
  kind: "comment";
  componentId: Id;
  commentId: Id;
  text: string;
  color?: string;
}

export type GraphNodeData = PatchNodeData | LayerNodeData | InterfaceNodeData | CommentNodeData;

/** A graph node with the fields React Flow reads, so the editor's node state holds these as they are. */
interface GraphNodeOf<D, T extends string> {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: D;
  /** Comment frames: the frame's size. */
  width?: number;
  height?: number;
  zIndex?: number;
}

export type PatchGraphNode = GraphNodeOf<PatchNodeData, "patch">;
export type LayerGraphNode = GraphNodeOf<LayerNodeData, "layer">;
export type InterfaceGraphNode = GraphNodeOf<InterfaceNodeData, "interface">;
export type CommentGraphNode = GraphNodeOf<CommentNodeData, "comment">;
export type GraphNode = PatchGraphNode | LayerGraphNode | InterfaceGraphNode | CommentGraphNode;

export interface CableData extends Record<string, unknown> {
  /** Source address ("pop.output"). */
  from: string;
  /** Target address ("transition.progress"); unique per cable. */
  to: string;
  sourceType: ValueType;
  targetType: ValueType;
  /** Implicit conversion applied on the wire. */
  conversion?: string;
  /** Why the link is invalid (type mismatch, missing port). */
  invalid?: string;
  suggestions?: Suggestion[];
  /** The cable carries a loop. */
  loop: boolean;
}

/** A cable from an output handle to an input handle. */
export interface CableEdge {
  id: string;
  type: "cable";
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  data: CableData;
}

export interface GraphModel {
  componentId: Id;
  nodes: GraphNode[];
  edges: CableEdge[];
  /** Cable ids by source address. */
  cablesBySource: ReadonlyMap<string, readonly string[]>;
  /** Every output address shown (live value subscriptions). */
  outputAddresses: readonly string[];
  /** Ports by `portKey(side, address)`. */
  ports: ReadonlyMap<string, PortModel>;
  /** Flow node id → the node's ports, for quick lookups while dragging. */
  nodeIds: ReadonlySet<string>;
}

export const portKey = (side: PortSide, address: string): string => `${side}|${address}`;

/** Session-only positions for nodes the document doesn't store (layer targets, interface nodes). */
export type SessionPositions = Readonly<Record<string, { x: number; y: number }>>;

// ---------------------------------------------------------------------------
// Ids and handles
// ---------------------------------------------------------------------------

export const commentNodeId = (commentId: Id): string => `comment:${commentId}`;
export const cableId = (to: string): string => `cable:${to}`;

export const inHandle = (key: string): string => `in:${key}`;
export const outHandle = (key: string): string => `out:${key}`;

export function parseHandleId(handleId: string | null | undefined): { side: PortSide; key: string } | undefined {
  if (!handleId) return undefined;
  const m = /^(in|out):(.+)$/.exec(handleId);
  return m ? { side: m[1] as PortSide, key: m[2]! } : undefined;
}

export type FlowNodeKind = "patch" | "layer" | "interface" | "comment";

export function flowNodeKind(nodeId: string): FlowNodeKind {
  if (nodeId.startsWith("@")) return "layer";
  if (nodeId === INPUTS_NODE_ID || nodeId === OUTPUTS_NODE_ID) return "interface";
  if (nodeId.startsWith("comment:")) return "comment";
  return "patch";
}

/** The document address of a port on a flow node. */
export function portAddress(nodeId: string, key: string): string {
  switch (flowNodeKind(nodeId)) {
    case "layer":
      return `${nodeId}.${key}`;
    case "interface":
      return nodeId === INPUTS_NODE_ID ? `$in.${key}` : `$out.${key}`;
    default:
      return `${nodeId}.${key}`;
  }
}

/** Flow node id and port key for an address ("pop.output" → pop, "@card.scale" → @card). */
export function addressNode(address: string): { nodeId: string; key: string } | undefined {
  const m = /^(@?\$?[A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(address);
  if (!m) return undefined;
  const id = m[1]!;
  if (id === "$in") return { nodeId: INPUTS_NODE_ID, key: m[2]! };
  if (id === "$out") return { nodeId: OUTPUTS_NODE_ID, key: m[2]! };
  return { nodeId: id, key: m[2]! };
}

/** Patch id → patch node id (ids are used as-is). */
export const patchIdOfNode = (nodeId: string): Id | undefined => (flowNodeKind(nodeId) === "patch" ? nodeId : undefined);
export const commentIdOfNode = (nodeId: string): Id | undefined => (nodeId.startsWith("comment:") ? nodeId.slice("comment:".length) : undefined);
