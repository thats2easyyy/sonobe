/** Host adapters (desktop, browser), project file helpers, and the MCP bridge RPC handlers. */

export type { DesktopHostApi, HostAdapter, HostCapabilities, RpcRegistrar, WriteProjectOptions, WriteSummary } from "./types.ts";
export { createDesktopHost } from "./desktopHost.ts";
export {
  BROWSER_PREFIX,
  createBrowserHost,
  createDefaultProjectStorage,
  createDirectoryProjectStorage,
  createLocalStorageProjectStorage,
  createMemoryProjectStorage,
  FSA_PREFIX,
  readDirectoryTree,
  writeDirectoryTree,
  type BrowserDialogs,
  type BrowserHost,
  type BrowserHostOptions,
  type DirectoryHandleLike,
  type FileHandleLike,
  type LocalStorageProjectStorageOptions,
  type ProjectStorage,
  type ProjectStorageWrite,
  type StoredProject,
} from "./browserHost.ts";
export { createHostAdapter, getDesktopHostApi } from "./detect.ts";
export { assetMimeType, documentFiles, isDocumentFile, planProjectWrite, projectDisplayName, PROJECT_EXTENSION, sanitizeProjectName, type ProjectWritePlan } from "./projectFiles.ts";
export { registerRpcHandlers, RPC_METHODS, type RpcHandlerOptions, type RpcMethod } from "./rpcHandlers.ts";
