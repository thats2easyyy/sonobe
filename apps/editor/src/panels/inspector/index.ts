/**
 * The Inspector. Mount inside <EditorProvider>:
 *
 *   <AppShell slots={{ inspector: <InspectorPanel onCollapse={() => toggleCollapsed("inspector", true)} onLearnMore={openPatchDocs} /> }} />
 *
 * Props: `onCollapse?()` shows the collapse button; `onLearnMore?(patchType)` sends "Learn More" to
 * the Learn drawer (without it the docs expand inline); `className?`. Everything else comes from the
 * session: the current component, selected layers and patches, live runtime values, and history.
 */

export { InspectorPanel, type InspectorPanelProps } from "./InspectorPanel.tsx";
export { LayerInspector, type LayerInspectorProps } from "./LayerInspector.tsx";
export { PatchInspector, type PatchInspectorProps } from "./PatchInspector.tsx";
export { HandoffCode, SpringCurve, SpringSection, type SpringSectionProps } from "./SpringSection.tsx";
export { FieldRow, LiveValue, useFieldActions, type FieldRowProps } from "./FieldRow.tsx";
export { colorAtOffset, controlKind, gradientPreviewCss, LiveReadout, STACKED_CONTROLS, ValueControl, type ControlKind, type FieldActions, type ValueControlProps } from "./controls.tsx";
export { InspectorSection, SECTION_STORAGE_KEY, type InspectorSectionProps } from "./Section.tsx";
export { InspectorHeader, type InspectorHeaderProps } from "./Header.tsx";
export { DocsText, parseDocBlocks, type DocBlock } from "./DocsText.tsx";
export { useInspectorEdit, type InspectorEdit } from "./useInspectorEdit.ts";
export {
  editLabel,
  encodeDefault,
  formatLiveValue,
  intersectFields,
  LAYER_SECTION_ORDER,
  layerSections,
  layerSources,
  linkSourceItem,
  literalValue,
  offsetNumber,
  patchSources,
  planFieldDisconnect,
  planFieldReset,
  planFieldSet,
  readStoredInput,
  sameInputValue,
  SECTION_TITLES,
  splitAdvanced,
  subjectLabel,
  summarizeField,
  updateVectorComponent,
  type FieldPort,
  type FieldSource,
  type FieldTarget,
  type FieldUpdate,
  type InspectorField,
  type InspectorSection as InspectorSectionModel,
} from "./model.ts";
export {
  activePreset,
  handoffSnippets,
  isSpringPatch,
  planPreset,
  presetInputs,
  SPRING_INPUTS,
  SPRING_PATCH_TYPES,
  SPRING_PRESETS,
  springConfigForNode,
  springCurveGeometry,
  type HandoffSnippet,
  type HandoffTarget,
  type SpringCurveGeometry,
  type SpringReading,
} from "./spring.ts";
