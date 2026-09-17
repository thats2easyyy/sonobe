/**
 * Patch editor panel.
 *
 * Mount inside <CommandProvider> and <EditorProvider> (for the session, clipboard events, and
 * document commands), with <Toaster /> somewhere in the app:
 *
 *   <Panel title="Patches" scope="patchEditor" surface="sunken" headerContent={<PatchEditorBreadcrumbs />}>
 *     <PatchEditor showBreadcrumbs={false} />
 *   </Panel>
 *
 * Props (all optional): `session` (default: the EditorProvider's), `showBreadcrumbs` (overlay crumbs,
 * default true), `showToolbar` (tidy up / comment / insert, default true), `defaultMinimap` (default
 * false), `commands` (register "patchEditor.*" commands and single-key inserts, default true),
 * `className`, `style`, `aria-label`. The editor fills its parent (flex: 1), follows
 * selection.componentPath, and persists its viewport per component in selection.patchViewports.
 * Layer target and component interface node positions are saved in the component's
 * `meta.patchEditor.nodes` (updateComponent `meta`), so they're undoable and survive reloads.
 *
 * "Drive with a patch" from other panels:
 *
 *   startLinkToLayerProp({ layerId: "photo", prop: "scale" })          // Inspector "Drive with a patch…"
 *   completeConnectionToLayerProp("pop.output", { layerId, prop })     // a cable dropped on a row
 *   <div {...layerPropDropAttributes({ layerId, prop })}>              // rows that accept cable drops
 *   <div {...layerDropAttributes(layerId)}>                            // layer rows: drop lists its properties
 *   const drag = useCableDrag(); acceptsCable(drag, prop.type)         // highlight rows while dragging
 *
 * xyflow's canvas attribution is hidden with CSS (`proOptions.hideAttribution` logs a warning on every
 * mount); credit xyflow (MIT) in the app's About or credits.
 */

export { PatchEditor, type PatchEditorProps } from "./PatchEditor.tsx";
export { LiveScopeChip, PatchEditorBreadcrumbs, type PatchEditorBreadcrumbsProps } from "./components/Chrome.tsx";
export { deriveGraph, type DeriveGraphOptions } from "./model/graph.ts";
export { checkConnection, orientConnection, placeSuggestion, portTypeAt, quickConnectCheck, type ConnectionCheck, type HandleRef, type OrientedConnection } from "./model/connect.ts";
export {
  layerLinkItems,
  linkCandidateGroup,
  linkCandidates,
  linkSearchItems,
  outputLinkItems,
  searchLinkItems,
  LINK_SEARCH_KEYS,
  type LayerLinkItem,
  type LayerLinkOptions,
  type LinkCandidate,
  type LinkCandidatesRequest,
  type LinkPort,
  type LinkSearchItem,
  type LinkSearchSource,
  type OutputLinkItem,
} from "./model/linkSearch.ts";
export { cablesCutByKnife, polylinesIntersect, segmentsIntersect, simplifyStroke, type CableGeometry } from "./model/knife.ts";
export { chordFromEvent, chordOf, DEFAULT_SINGLE_KEYS, resolveSingleKeyInsert, singleKeyInserts, type SingleKeyInsert } from "./model/singleKey.ts";
export { tidyLayout, type TidyInput, type TidyResult } from "./model/tidy.ts";
export { pickerItems, searchPicker, PICKER_KEYS, type PickerItem } from "./model/picker.ts";
export {
  alignPositions,
  commentAroundOps,
  duplicatePatchOps,
  insertPatchOps,
  movePatchOps,
  replacePatchOps,
  spliceOptions,
  splicePatchOps,
  COMMENT_COLORS,
  type AlignMode,
  type SpliceOption,
} from "./model/editOps.ts";
export { boundsVisible, cablePath, cablePoint, readableViewport, sampleCable, type ReadableViewportOptions } from "./model/geometry.ts";
export { documentObstacles, estimatePatchSize, findFreePosition, freeInsertPosition, type PlacementBias, type PlacementObstacles, type PlacementOptions } from "./model/placement.ts";
export { componentInstances, instanceChoiceKey, resolveLiveScope, scopedAddress, type ComponentInstance, type LiveScope, type LiveScopeStep } from "./model/instances.ts";
export { nodePositionsMetaOp, readNodePositions, PATCH_EDITOR_META_KEY } from "./model/meta.ts";
export { formatValue, formatValueLong } from "./model/format.ts";
export type { CableData, CableFlowEdge, FlowNode, GraphModel, LayerNodeData, PatchNodeData, PortModel } from "./model/types.ts";
export { createPatchEditorActions, type ActionDeps, type InsertPatchOptions, type LinkSearchRequest, type PatchEditorActions } from "./state/actions.ts";
export { patchEditorBridge, type CableDrag, type DriveRequest, type LayerPropTarget, type PatchEditorBridge, type PatchEditorBridgeState } from "./state/bridge.ts";
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
