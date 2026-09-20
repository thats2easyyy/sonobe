/**
 * Design with Claude on the canvas: a box at the bottom of the canvas that sends the person's request
 * to the in-app Assistant with the canvas's context, and a sandboxed live preview of the page Claude
 * is writing over the artboard. The finished page becomes real layers through the Assistant's
 * import_design, in one undo step; the preview never writes the document.
 */

export { canvasContext, designTarget, type DesignTarget } from "./context.ts";
export { designCommands } from "./commands.ts";
export { DesignBox } from "./DesignBox.tsx";
export { DesignPreview, PREVIEW_POST_MS, previewFrame, type DesignPreviewProps, type PreviewFrameOptions } from "./DesignPreview.tsx";
export {
  activeDraft,
  attachDesign,
  designStore,
  initialDesignData,
  reduceDesignEvent,
  sendDesign,
  useDesign,
  type DesignData,
  type DesignDraft,
  type DesignRequest,
  type DesignResult,
  type DesignState,
  type DraftStatus,
} from "./designStore.ts";
export { PREVIEW_BOOTSTRAP, PREVIEW_MESSAGE_TYPE, PREVIEW_SCRIPT_PREFIXES, previewCsp, previewShellHtml, renderablePrefix } from "./previewShell.ts";
export { claudePrompt } from "./prompt.ts";
export { designStatusLine, toolStatusText, type DesignStatusLine } from "./status.ts";
