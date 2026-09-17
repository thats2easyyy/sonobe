/**
 * Viewer panel: the live prototype. Mount inside <EditorProvider> (and <CommandProvider> for
 * commands and shortcuts); it renders its own shell <Panel> chrome.
 *
 *   <ViewerPanel
 *     session?        EditorSession    default: the provider's session
 *     lanPreviewUrl?  string | null    fixed LAN web player URL ("On phone"); omit to use the desktop
 *                                      host's phone preview server when it has one
 *     onPopOut?       () => void       default: sonobeHost.popOutViewer when available, else a floating window
 *     onCollapse?     () => void       shows "Hide viewer" (Mod+2)
 *     commands?       boolean          register viewer.* commands and the viewer.showPhonePreview RPC (default true)
 *     className?      string
 *   />
 *
 * Header: zoom menu (fit, 1:1), restart, device frame, hit targets, and a "More viewer options" menu
 * (rotate, device, frame, hit targets, pop out, phone preview). It reflows with container queries.
 *
 * Commands (registered only when missing): viewer.toggleDeviceFrame (Alt+D), viewer.toggleHitTargets,
 * viewer.actualSize, viewer.rotateDevice, viewer.popOut, viewer.previewOnDevice. Play/pause and
 * restart use the session runtime directly; their shortcuts come from registerDocumentCommands.
 *
 * Screenshot targets: the primary ViewerStage registers `viewer.layerBounds({ layerId })` through
 * registerBoundsProvider (the session's bounds registry, or the desktop RPC bridge).
 */

export { ViewerPanel, type ViewerPanelProps } from "./ViewerPanel.tsx";
export { ViewerStage, type ViewerStageProps } from "./ViewerStage.tsx";
export { FloatingWindow, type FloatingWindowProps } from "./FloatingWindow.tsx";
export { PhonePreviewButton, usePhonePreview, type PhonePreviewButtonProps, type PhonePreviewController } from "./PhonePreview.tsx";
export {
  getPreviewHostApi,
  getViewerWindowApi,
  registerBoundsProvider,
  toPreviewStatus,
  toViewerWindowStatus,
  type BoundsMethod,
  type BoundsProvider,
  type BoundsRect,
  type BoundsRegistration,
  type PreviewHostApi,
  type PreviewStatus,
  type ViewerWindowApi,
  type ViewerWindowStatus,
} from "./hostBridge.ts";
export {
  clampFloatingRect,
  devicePresetOps,
  fitScale,
  formatFps,
  interactiveLayerIds,
  isFloatingRect,
  layerScreenRect,
  nodeCorners,
  nodesForLayers,
  outlinePoints,
  phoneClientsLabel,
  presetForDevice,
  qrPath,
  rotateDeviceOps,
  sceneKeysForLayers,
  type FloatingRect,
  type HighlightScope,
  type ScreenRect,
  type ViewerZoom,
} from "./viewerModel.ts";
