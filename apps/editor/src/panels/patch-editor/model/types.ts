/**
 * Patch editor view model: the shared graph model from @sonobe/core/graph (what a component's graph
 * shows), plus the React Flow node and edge types that carry it.
 */

import type { CableData, CommentNodeData, InterfaceNodeData, LayerNodeData, PatchNodeData } from "@sonobe/core/graph";
import type { Edge, Node } from "@xyflow/react";

export {
  addressNode,
  cableId,
  commentIdOfNode,
  commentNodeId,
  flowNodeKind,
  INPUTS_NODE_ID,
  inHandle,
  layerIdOfNode,
  layerNodeId,
  outHandle,
  OUTPUTS_NODE_ID,
  parseHandleId,
  patchIdOfNode,
  portAddress,
  portKey,
  type CableData,
  type CommentNodeData,
  type FlowNodeKind,
  type GraphModel,
  type GraphNodeData,
  type InterfaceNodeData,
  type LayerNodeData,
  type NodeIssue,
  type PatchNodeData,
  type PortIssue,
  type PortModel,
  type PortSide,
  type SessionPositions,
} from "@sonobe/core/graph";

export type PatchFlowNode = Node<PatchNodeData, "patch">;
export type LayerFlowNode = Node<LayerNodeData, "layer">;
export type InterfaceFlowNode = Node<InterfaceNodeData, "interface">;
export type CommentFlowNode = Node<CommentNodeData, "comment">;
export type FlowNode = PatchFlowNode | LayerFlowNode | InterfaceFlowNode | CommentFlowNode;

export type CableFlowEdge = Edge<CableData, "cable">;
