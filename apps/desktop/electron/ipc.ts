/** IPC channel names shared by the main process and the preload script. */
export const IPC = {
  /** main → renderer: a menu command id. */
  command: "sonobe:command",
  /** renderer → main: number of active onCommand subscribers in this window. */
  commandListeners: "sonobe:command:listeners",
  /** main → renderer: a project folder to open. */
  openProject: "sonobe:open-project",
  /** renderer → main: an onOpenProject subscriber exists; flush queued paths. */
  openProjectReady: "sonobe:open-project:ready",
  dialogOpenProject: "sonobe:dialog:open-project",
  dialogSaveProject: "sonobe:dialog:save-project",
  readProject: "sonobe:project:read",
  /** Like readProject, but a folder that doesn't exist yet reads as null (Save As into a new folder). */
  readProjectIfExists: "sonobe:project:read-if-exists",
  writeProject: "sonobe:project:write",
  watchProject: "sonobe:project:watch",
  unwatchProject: "sonobe:project:unwatch",
  /** main → renderer: files changed on disk under a watched project. */
  projectChanged: "sonobe:project:changed",
  revealInFinder: "sonobe:shell:reveal",
  recentProjects: "sonobe:recent:list",
  setDocumentEdited: "sonobe:window:set-edited",
  setTitle: "sonobe:window:set-title",
  mcpStatus: "sonobe:mcp:status",
  previewStatus: "sonobe:preview:status",
  previewStart: "sonobe:preview:start",
  previewStop: "sonobe:preview:stop",
  /** main → renderer: phone preview status changed. */
  previewChanged: "sonobe:preview:changed",
  /** renderer → main: the editor's document reached a new revision. */
  documentChanged: "sonobe:document:changed",
  secretsStatus: "sonobe:secrets:status",
  secretsGet: "sonobe:secrets:get",
  secretsSet: "sonobe:secrets:set",
  secretsDelete: "sonobe:secrets:delete",
  openExternal: "sonobe:shell:open-external",
  viewerWindowOpen: "sonobe:viewer-window:open",
  viewerWindowClose: "sonobe:viewer-window:close",
  viewerWindowStatus: "sonobe:viewer-window:status",
  /** main → renderer: the pop-out viewer window opened, closed, or changed. */
  viewerWindowChanged: "sonobe:viewer-window:changed",
  /** renderer → main: render a URL or HTML page in a hidden window and capture it for import. */
  captureDesign: "sonobe:design:capture",
  /** renderer → main: cancel the capture started with this captureId. */
  captureDesignCancel: "sonobe:design:cancel",
  /** main → renderer: what a capture started with a captureId is doing now. */
  captureDesignProgress: "sonobe:design:progress",
  /** renderer → main: download a pasted capture's image or font (no CORS in main). */
  fetchCaptureFile: "sonobe:design:fetch-file",
  /** renderer → main: drafts of unsaved work (electron/drafts.ts). */
  draftsWrite: "sonobe:drafts:write",
  draftsRemove: "sonobe:drafts:remove",
  draftsList: "sonobe:drafts:list",
  draftsRead: "sonobe:drafts:read",
  draftsReveal: "sonobe:drafts:reveal",
  rpcRequest: "sonobe:rpc:request",
  rpcResponse: "sonobe:rpc:response",
  /** renderer → main: the full list of registered rpc method names. */
  rpcMethods: "sonobe:rpc:methods",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
