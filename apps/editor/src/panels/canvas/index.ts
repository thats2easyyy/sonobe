/**
 * Canvas panel: direct manipulation of the component being edited. Mount inside <EditorProvider>
 * (and <CommandProvider> for commands and shortcuts); it renders its own shell <Panel> chrome.
 *
 *   <CanvasPanel
 *     session?              EditorSession        default: the provider's session
 *     sceneSource?          "design" | "live"    controlled scene source; uncontrolled default "design"
 *     onSceneSourceChange?  (source) => void
 *     commands?             boolean              register canvas.* commands and canvas-scope shortcuts (default true)
 *     className?            string
 *   />
 *
 * Commands (registered only when missing, scope "canvas"): canvas.tool.select (V), canvas.tool.rectangle
 * (R), canvas.tool.oval (O), canvas.tool.text (T), canvas.zoomToFit (Shift+1), canvas.zoomToSelection
 * (Shift+2), canvas.actualSize (Shift+0), canvas.zoomIn (Mod+=), canvas.zoomOut (Mod+-). Canvas-scope
 * bindings: Escape, Enter, arrows (⇧ ×10), Mod+G when layer.group isn't registered. Delete, duplicate,
 * undo, and group come from registerDocumentCommands.
 */

export { CanvasPanel, type CanvasPanelProps, type CanvasTool } from "./CanvasPanel.tsx";
export { CanvasOverlay, EMPTY_DRAFT, type CanvasOverlayProps, type OverlayDraft } from "./CanvasOverlay.tsx";
export { InlineTextEditor, type InlineTextEditorProps } from "./InlineTextEditor.tsx";
export { artboardSize, componentDocument, useCanvasScene, type CanvasSceneState, type SceneSource } from "./useCanvasScene.ts";
export { createEditTransaction, type EditTransaction, type EditTransactionOptions } from "./editTransaction.ts";
export * from "./geometry.ts";
export * from "./viewport.ts";
export * from "./snapping.ts";
export * from "./transform.ts";
export * from "./sceneIndex.ts";
export * from "./ops.ts";
export * from "./gestures.ts";
export * from "./handles.ts";
