/**
 * The patch editor's light API: what other panels use to work with patches without loading the
 * patch editor itself (React Flow, d3, ELK). Layers, Inspector, and the app import from here, so the
 * patch editor chunk stays a real dynamic import. `index.ts` re-exports all of it.
 */

export { PatchEditorBreadcrumbs, type PatchEditorBreadcrumbsProps } from "./components/Breadcrumbs.tsx";
export { checkConnection, orientConnection, placeSuggestion, portTypeAt, quickConnectCheck, type ConnectionCheck, type HandleRef, type OrientedConnection } from "./model/connect.ts";
export { documentObstacles, estimatePatchSize, findFreePosition, freeInsertPosition, type PlacementBias, type PlacementObstacles, type PlacementOptions } from "./model/placement.ts";
export { nodePositionsMetaOp, readNodePositions, PATCH_EDITOR_META_KEY } from "./model/meta.ts";
export { patchEditorBridge, type CableDrag, type DriveRequest, type LayerPropTarget, type PatchEditorBridge, type PatchEditorBridgeState } from "./state/bridge.ts";
export { useInstanceCopies, useWatchedCopy, useWatchedScope, type WatchedScope } from "./state/watch.ts";
export { pickCopy } from "./model/format.ts";
export {
  acceptsCable,
  cableSourceName,
  canDriveLayerProp,
  completeConnectionToLayerProp,
  dropTargetAt,
  getCableDrag,
  layerDropAttributes,
  layerPropDropAttributes,
  startLinkToLayerProp,
  useCableDrag,
  DROP_COMPONENT_ATTRIBUTE,
  LAYER_DROP_ATTRIBUTE,
  LAYER_PROP_DROP_ATTRIBUTE,
  type DriveCheck,
  type DropTarget,
  type LinkToLayerOptions,
} from "./state/linkToLayer.ts";
