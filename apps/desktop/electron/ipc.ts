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
  rpcRequest: "sonobe:rpc:request",
  rpcResponse: "sonobe:rpc:response",
  /** renderer → main: the full list of registered rpc method names. */
  rpcMethods: "sonobe:rpc:methods",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
