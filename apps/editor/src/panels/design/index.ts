/**
 * Design with Claude on the canvas: a box at the bottom of the canvas that sends the person's request
 * to the in-app Assistant with the canvas's context, and a sandboxed live preview of the page Claude
 * is writing over the artboard, from the Assistant or from an MCP client's preview_design (the
 * design.preview RPC; on the Claude subscription the Assistant draws that way too). The finished page
 * becomes real layers through import_design, in one undo step; the preview never writes the document.
 */

export { canvasContext, designTarget, type DesignTarget } from "./context.ts";
export { designCommands } from "./commands.ts";
export { DesignBox, type DesignBoxProps } from "./DesignBox.tsx";
export { DesignPreview, liveDraftWriter, PREVIEW_POST_MS, previewFrame, previewPillText, writerKey, type DesignPreviewProps, type PreviewFrameOptions } from "./DesignPreview.tsx";
export {
  activeDraft,
  applyPreviewUpdate,
  ASSISTANT_AUTHOR,
  assistantDraft,
  attachDesign,
  designStore,
  dismissDraft,
  initialDesignData,
  liveMcpDraft,
  MCP_DRAFT_IDLE_MS,
  MCP_DRAFT_STALLED_MS,
  mcpDraftIdleAt,
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
export { DESIGN_CANVAS_SPLIT, followDesignBox, liveMcpDrafts } from "./layout.ts";
export { claudePrompt, designFollowUp, type DesignFollowUpKind } from "./prompt.ts";
export { designResultChips, designRunState, designStatusLine, mcpDraftText, resultPlacement, toolStatusText, type DesignResultChip, type DesignStatusLine, type ResultPlacement } from "./status.ts";
