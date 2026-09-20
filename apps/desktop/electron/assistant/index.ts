/**
 * The optional in-app Assistant (bring your own Anthropic API key), main-process side.
 *
 * Sonobe's primary AI path is MCP: people with a Claude plan connect Claude Desktop or Claude Code.
 * The Assistant is for people who'd rather chat inside Sonobe with their own API key. The key lives
 * in the OS keychain (sonobeHost.secrets, "anthropic.apiKey") and is read only by the main process.
 *
 * Experimental, off by default and not released until Anthropic agrees: behind Settings → Claude's
 * switch, the Assistant can also run on the person's Claude subscription through Claude's agent
 * adapter (acp/). Sonobe never reads Claude credentials: the adapter's Claude Code does its own login.
 *
 * Wiring:
 *   main.ts     registerAssistant({ ipcMain, isTrustedSender, host: () => appHost, secrets: () => secrets, version, guides, log,
 *                 documentFor: (id) => appHost.targetDocument(id),       // pins each window's tool calls to its document
 *                 codeFolders: createCodeFolderStore({ file, home }),     // Match my code… links (codeFolder.ts)
 *                 pickFolder,                                             // the native folder dialog
 *                 handoff: { platform, dir, server, openPath },           // Open in Claude Code (../claude-handoff.ts)
 *                 connection: createConnectionStore({ file }),            // the subscription switch and pick (connection.ts)
 *                 subscription: { available, sessionsDir, signIn: { platform, dir, openPath } } })  // the Claude subscription (acp/); available: !app.isPackaged
 *   preload.ts  attachAssistantBridge(host, ipcRenderer)   // before contextBridge.exposeInMainWorld
 *
 * Designing on the canvas (design.ts, draftStream.ts, designGuard.ts): the Design with Claude box
 * sends a canvas context with the message; the API key's engine streams import_design's html back as
 * design_draft events, the subscription's draws through preview_design; and a replace the person may
 * not want asks first (toolRunner.ts, shared by both engines).
 *
 * Import the preload side from ./preload.ts directly (it bundles into the sandboxed preload); this
 * barrel pulls in the SDK and the MCP server.
 */

export { createSubscriptionAgent, type SubscriptionAgent, type SubscriptionAgentOptions } from "./acp/engine.ts";
export { startAssistantToolServer, type AssistantToolServer, type ToolServerHandler } from "./acp/toolServer.ts";
export { createAssistantAgent, DEFAULT_LIMITS, requestParams, resolveLimits, systemPrompt, toAssistantError, UNPINNED_TOOLS, type AnthropicClientLike, type AssistantAgent, type AssistantAgentOptions, type AssistantEngine, type ConversationSnapshot, type MessageStreamLike } from "./agent.ts";
export { createConnectionStore, type ConnectionStore, type SavedConnection } from "./connection.ts";
export { applyOpsDeletion, DELETE_CONFIRM_THRESHOLD, deleteConfirmation, isReadOnlyRefusal, type ConfirmPrompt, type DeletionPrompt } from "./guardrails.ts";
export { addUsage, DEFAULT_MODEL, emptyUsage, estimateCostUsd, FALLBACK_BETA, isModelId, modelInfos, MODELS, resolveModel, type ModelSpec } from "./models.ts";
export * from "./protocol.ts";
export { createAnthropicClient, keyHint, registerAssistant, type AssistantIpcEvent, type AssistantIpcMain, type AssistantRegistration, type AssistantSender, type RegisterAssistantOptions, type SubscriptionSetup } from "./register.ts";
export { ASSISTANT_AUTHOR_NAME, createMcpToolBridge, describeToolInput, describeToolResult, toAnthropicTools, toolResultContent, type AssistantToolInfo, type LocalTools, type LocalToolScope, type ToolBridge, type ToolCallResult } from "./toolBridge.ts";
export { createToolRunner, type ReplaceGuardKit, type ToolRunner, type ToolRunScope } from "./toolRunner.ts";
