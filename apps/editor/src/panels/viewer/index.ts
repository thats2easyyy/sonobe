/**
 * Viewer panel: the live prototype. Mount inside <EditorProvider> (and <CommandProvider> for
 * commands and shortcuts); it renders its own shell <Panel> chrome.
 *
 *   <ViewerPanel
 *     session?        EditorSession    default: the provider's session
 *     lanPreviewUrl?  string | null    LAN web player URL; shows "On phone" (QR + link) when set
 *     onPopOut?       () => void       host window pop-out; without it the viewer floats in-app
 *     onCollapse?     () => void       shows "Hide viewer" (Mod+2)
 *     commands?       boolean          register viewer.* commands (default true)
 *     className?      string
 *   />
 *
 * Commands (registered only when missing): viewer.toggleDeviceFrame (Alt+D), viewer.toggleHitTargets,
 * viewer.actualSize, viewer.rotateDevice, viewer.popOut, viewer.previewOnDevice. Play/pause and
 * restart use the session runtime directly; their shortcuts come from registerDocumentCommands.
 */

export { ViewerPanel, type ViewerPanelProps } from "./ViewerPanel.tsx";
export { ViewerStage, type ViewerStageProps } from "./ViewerStage.tsx";
export { FloatingWindow, type FloatingWindowProps } from "./FloatingWindow.tsx";
export { PhonePreviewButton, type PhonePreviewButtonProps } from "./PhonePreview.tsx";
export {
  clampFloatingRect,
  devicePresetOps,
  fitScale,
  formatFps,
  interactiveLayerIds,
  isFloatingRect,
  nodesForLayers,
  outlinePoints,
  presetForDevice,
  qrPath,
  rotateDeviceOps,
  sceneKeysForLayers,
  type FloatingRect,
  type HighlightScope,
  type ViewerZoom,
} from "./viewerModel.ts";
