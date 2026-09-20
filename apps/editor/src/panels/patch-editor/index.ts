/**
 * Patch editor panel.
 *
 * Mount inside <CommandProvider> and <EditorProvider> (for the session, clipboard events, and
 * document commands), with <Toaster /> somewhere in the app:
 *
 *   const [tools, setTools] = useState<HTMLDivElement | null>(null);
 *   <Panel title="Patches" scope="patchEditor" surface="sunken" headerContent={<PatchEditorBreadcrumbs />} actions={<div ref={setTools} />}>
 *     <PatchEditor showBreadcrumbs={false} toolbarContainer={tools} />
 *   </Panel>
 *
 * Props (all optional): `session` (default: the EditorProvider's), `showBreadcrumbs` (crumbs in the
 * canvas's top bar, default true), `showToolbar` (tidy up / comment / insert, default true),
 * `toolbarContainer` (dock the toolbar in that element, such as a panel header, instead of the top
 * bar; while it's null the toolbar isn't shown), `defaultMinimap` (default false), `commands`
 * (register "patchEditor.*" commands and single-key inserts, default true), `className`, `style`,
 * `aria-label`. The editor fills its parent (flex: 1), follows
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
 * Panels that are on screen at startup import from `api.ts` (bridge, placement, drop attributes,
 * breadcrumbs), which doesn't pull in React Flow; only the app's lazy import loads `PatchEditor.tsx`.
 *
 * React Flow's attribution shows small in the bottom-left corner, as its maintainers ask (hiding it
 * logs a dev warning); About also credits xyflow (MIT).
 */

export * from "./api.ts";
export { PatchEditor, type PatchEditorProps } from "./PatchEditor.tsx";
export { LiveScopeChip, Toolbar, type ToolbarProps } from "./components/Chrome.tsx";
export { deriveGraph, type DeriveGraphOptions } from "./model/graph.ts";
export { edgesWithRegisteredHandles, type HandleLookup } from "./model/handles.ts";
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
  replacePatchOp,
  spliceOptions,
  splicePatchOps,
  COMMENT_COLORS,
  type AlignMode,
  type SpliceOption,
} from "./model/editOps.ts";
export { boundsVisible, cablePath, cablePoint, readableViewport, sampleCable, type ReadableViewportOptions } from "./model/geometry.ts";
export { componentInstances, instanceChoiceKey, resolveLiveScope, scopedAddress, type ComponentInstance, type LiveScope, type LiveScopeStep } from "./model/instances.ts";
export { formatValue, formatValueLong } from "./model/format.ts";
export type { CableData, CableFlowEdge, FlowNode, GraphModel, LayerNodeData, PatchNodeData, PortModel } from "./model/types.ts";
export { createPatchEditorActions, type ActionDeps, type InsertPatchOptions, type LinkSearchRequest, type PatchEditorActions } from "./state/actions.ts";
