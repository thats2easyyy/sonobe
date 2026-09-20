/**
 * Design with Claude on the canvas: a box at the bottom of the canvas that sends the person's request
 * to the in-app Assistant with the canvas's context, and a sandboxed live preview of the page Claude
 * is writing over the artboard, from the Assistant or from an MCP client's preview_design (the
 * design.preview RPC). The finished page becomes real layers through import_design, in one undo
 * step; the preview never writes the document.
 */

export { canvasContext, designTarget, type DesignTarget } from "./context.ts";
export { designCommands } from "./commands.ts";
export { DesignBox, type DesignBoxProps } from "./DesignBox.tsx";
export { DesignPreview, PREVIEW_POST_MS, previewFrame, previewPillText, type DesignPreviewProps, type PreviewFrameOptions } from "./DesignPreview.tsx";
export {
  activeDraft,
  applyPreviewUpdate,
  attachDesign,
  designStore,
  initialDesignData,
  MCP_DRAFT_IDLE_MS,
  reduceDesignEvent,
  reducePreviewUpdate,
  runReply,
  sendDesign,
  useDesign,
  type DesignData,
  type DesignDraft,
  type DesignRequest,
  type DesignResult,
  type DesignState,
  type DraftSource,
  type DraftStatus,
  type McpDraftSession,
  type PreviewTarget,
} from "./designStore.ts";
export { PREVIEW_BOOTSTRAP, PREVIEW_MESSAGE_TYPE, PREVIEW_SCRIPT_PREFIXES, previewCsp, previewShellHtml, renderablePrefix } from "./previewShell.ts";
export { DESIGN_CANVAS_SPLIT, followDesignBox } from "./layout.ts";
export { claudePrompt, designFollowUp, type DesignFollowUpKind } from "./prompt.ts";
export { designResultChips, designRunState, designStatusLine, toolStatusText, type DesignResultChip, type DesignStatusLine } from "./status.ts";
