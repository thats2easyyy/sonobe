/**
 * The optional in-app Assistant (bring your own Anthropic API key), main-process side.
 *
 * Sonobe's primary AI path is MCP: people with a Claude plan connect Claude Desktop or Claude Code.
 * The Assistant is for people who'd rather chat inside Sonobe with their own API key. It never offers
 * claude.ai login and never reads Claude credentials; the key lives in the OS keychain
 * (sonobeHost.secrets, "anthropic.apiKey") and is read only by the main process.
 *
 * Wiring:
 *   main.ts     registerAssistant({ ipcMain, isTrustedSender, host: () => appHost, secrets: () => secrets, version, guides, log })
 *   preload.ts  attachAssistantBridge(host, ipcRenderer)   // before contextBridge.exposeInMainWorld
 *
 * Import the preload side from ./preload.ts directly (it bundles into the sandboxed preload); this
 * barrel pulls in the SDK and the MCP server.
 */

export { createAssistantAgent, DEFAULT_LIMITS, requestParams, resolveLimits, systemPrompt, toAssistantError, type AnthropicClientLike, type AssistantAgent, type AssistantAgentOptions, type ConversationSnapshot, type MessageStreamLike } from "./agent.ts";
export { applyOpsDeletion, DELETE_CONFIRM_THRESHOLD, deleteConfirmation, isReadOnlyRefusal, type DeletionPrompt } from "./guardrails.ts";
export { addUsage, DEFAULT_MODEL, emptyUsage, estimateCostUsd, FALLBACK_BETA, isModelId, modelInfos, MODELS, resolveModel, type ModelSpec } from "./models.ts";
export * from "./protocol.ts";
export { createAnthropicClient, keyHint, registerAssistant, type AssistantIpcEvent, type AssistantIpcMain, type AssistantRegistration, type AssistantSender, type RegisterAssistantOptions } from "./register.ts";
export { ASSISTANT_AUTHOR_NAME, createMcpToolBridge, describeToolInput, describeToolResult, toAnthropicTools, toolResultContent, type AssistantToolInfo, type ToolBridge, type ToolCallResult } from "./toolBridge.ts";
