/**
 * The Layers panel. Mount inside <EditorProvider> (and <CommandProvider> so context-menu actions
 * share the document commands and their shortcuts):
 *
 *   <AppShell slots={{ layers: <LayersPanel onCollapse={() => toggleCollapsed("layers", true)} /> }} />
 *
 * Props: `onCollapse?()` shows the collapse button, `className?` styles the panel section.
 * Everything else comes from the session: the current component (selection.componentPath), the
 * selected and hovered layers, reveal requests, and document commands.
 *
 * While the patch editor drags a cable, every row carries `layerDropAttributes(layer.id)`, so a
 * cable released over a row lists that layer's properties; rows whose layer has a property that
 * fits light up. Files dropped on the panel replace a media layer's content, go into a group, or
 * become new Image, Video, and Lottie layers (imported through `session.assets`).
 */

export { LayersPanel, type LayersPanelProps } from "./LayersPanel.tsx";
export { addTouchInteraction, TOUCH_ICONS, touchMenuEntries, type TouchResult } from "./touchActions.tsx";
export { planTouch, TOUCH_OPTIONS, TOUCH_REF, touchOptions, touchPlacement, type TouchKind, type TouchOption, type TouchPlan } from "./touch.ts";
export { cableHoverKey, layerAcceptsCable, layerHoverKey, propHoverKey, useCableHover } from "./cableHover.ts";
export { dragMediaKinds, dropFilesOnLayers, mediaNoun, planLayerFileDrop, type LayerFileDrop, type LayerFileDropResult } from "./mediaDrop.ts";
export {
  displayTree,
  filterLayerTree,
  INSERT_REF,
  isFiltering,
  layerMatches,
  parentLayerIds,
  planInsertLayer,
  planLayerMove,
  relatedPatchIds,
  treeIds,
  type InsertPlan,
  type LayerFilter,
} from "./layerTree.ts";
