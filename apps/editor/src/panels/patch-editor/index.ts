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
 */

export { PatchEditor, type PatchEditorProps } from "./PatchEditor.tsx";
export { PatchEditorBreadcrumbs, type PatchEditorBreadcrumbsProps } from "./components/Chrome.tsx";
export { deriveGraph, type DeriveGraphOptions } from "./model/graph.ts";
export { checkConnection, orientConnection, placeSuggestion, portTypeAt, quickConnectCheck, type ConnectionCheck, type HandleRef, type OrientedConnection } from "./model/connect.ts";
export { linkSearchItems, searchLinkItems, LINK_SEARCH_KEYS, type LinkSearchItem, type LinkSearchSource } from "./model/linkSearch.ts";
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
  splicePatchOps,
  COMMENT_COLORS,
  type AlignMode,
} from "./model/editOps.ts";
export { cablePath, cablePoint, sampleCable } from "./model/geometry.ts";
export { formatValue, formatValueLong } from "./model/format.ts";
export type { CableData, CableFlowEdge, FlowNode, GraphModel, LayerNodeData, PatchNodeData, PortModel } from "./model/types.ts";
export { createPatchEditorActions, type PatchEditorActions } from "./state/actions.ts";
