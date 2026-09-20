/**
 * The optional in-app Assistant: chat with Claude inside Sonobe using your own Anthropic API key.
 *
 * Policy: Sonobe's primary AI path is MCP (Connect Claude: Claude Desktop or Claude Code on the
 * person's own plan). The Assistant uses only the person's API key, stored in the OS keychain through
 * sonobeHost.secrets ("anthropic.apiKey"); Sonobe never offers claude.ai login or reads Claude
 * credentials. It runs in the desktop app's main process (apps/desktop/electron/assistant), which
 * drives Sonobe's MCP tools in process, so edits land in history as "Assistant". In the browser the
 * drawer shows a desktop-only notice.
 *
 * Integration (inside <EditorProvider> and <CommandProvider>): its own sheet, bound to
 * assistantStore.open, with no shell changes.
 *
 *   <AssistantHost onConnectClaude={() => connectClaudeStore.getState().show()} />
 *   useRegisterCommands([assistantCommand()])   // id "ai.assistant", replaces the hidden alias that opens Connect Claude
 *
 * AssistantDrawer props (all optional): onClose, onConnectClaude (default connectClaudeStore.show()),
 * onImportDesign (default appPanels.show("importDesign")), host (default window.sonobeHost; null =
 * browser mode), store, controller, className. The canvas's Design with Claude box (panels/design)
 * is a second front door to the same chat, through sharedAssistantController().
 */

export { AssistantDrawer, type AssistantDrawerProps } from "./AssistantDrawer.tsx";
export { AssistantHost } from "./AssistantHost.tsx";
export { assistantStore, createAssistantStore, draftKb, initialAssistantData, MODEL_STORAGE_KEY, reduceEvent, useAssistant, type AssistantData, type AssistantState, type ChatItem, type KeyCheckState, type ToolChip } from "./assistantStore.ts";
export { ASSISTANT_COMMAND_ID, assistantCommand } from "./commands.ts";
export { Composer, UsageMeter, type ComposerProps } from "./Composer.tsx";
export { createAssistantController, openLink, sharedAssistantController, type AssistantController, type SaveKeyResult } from "./controller.ts";
export { budgetFraction, formatCost, formatTokens, validateApiKey, type KeyValidation } from "./format.ts";
export { KeySetup, type KeySetupProps } from "./KeySetup.tsx";
export { ConfirmCard, SUGGESTIONS, Transcript, type TranscriptProps } from "./Transcript.tsx";
export * from "./types.ts";
