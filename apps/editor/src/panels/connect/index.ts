/**
 * Connect Claude: bring your own Claude plan over MCP (Claude Desktop or Claude Code; no API key,
 * no claude.ai login). A dialog with MCP status, setup commands for this machine, example prompts,
 * and privacy notes; a toolbar Claude button; an app-wide open store; and the palette command.
 *
 * Integration (inside <EditorProvider> and <CommandProvider>):
 *
 *   // once near the root
 *   <ConnectClaudeHost onOpenGuide={(slug) => openLearnGuide(slug)} />
 *   // toolbar (replaces the mock presence button)
 *   <ConnectClaudeButton />
 *   // command palette + Help → Connect Claude (desktop menu "help.connectClaude" → "ai.connectClaude")
 *   useRegisterCommands([connectClaudeCommand()])   // replaces the shell mock's "ai.connectClaude"
 *
 * ConnectClaudeDialog props: open, onOpenChange, host? (default window.sonobeHost; null = browser
 * mode), onOpenGuide?, defaults? { mode, nodePath, repoPath, platform, headlessProject }, initialTab?
 * ("code" | "desktop"). ConnectClaudeButton props: onClick? (default: connectClaudeStore.show()),
 * host?, className?.
 */

export { ConnectClaudeDialog, ConnectClaudeHost, CLAUDE_GUIDE, type ConnectClaudeDialogProps, type ConnectDefaults, type ConnectHostLike } from "./ConnectClaudeDialog.tsx";
export { ConnectClaudeButton, type ClaudeButtonState, type ConnectClaudeButtonProps } from "./ConnectClaudeButton.tsx";
export { CopyBlock, type CopyBlockProps } from "./CopyBlock.tsx";
export { connectClaudeStore, createConnectClaudeStore, useConnectClaude, type ConnectClaudeState, type ConnectTab } from "./connectStore.ts";
export { CONNECT_CLAUDE_COMMAND_ID, connectClaudeCommand } from "./commands.ts";
export { useMcpStatus, type McpStatusOptions, type McpStatusSource, type McpStatusState } from "./useMcpStatus.ts";
export { claudeDesktopBundle, detectRepoPath, IS_DEV_BUILD, type DesktopBundleInfo } from "./buildInfo.ts";
export {
  claudeCodeCommand,
  claudeDesktopConfig,
  claudeDesktopConfigPath,
  CLI_ENTRY,
  EXAMPLE_PROMPTS,
  joinRepoPath,
  mcpLaunchSpec,
  parseMcpStatus,
  repoPathFromDevUrl,
  shellForPlatform,
  shellQuote,
  tildePath,
  type LaunchMode,
  type LaunchOptions,
  type LaunchSpec,
  type McpStatusInfo,
  type PromptGroup,
  type ShellFlavor,
} from "./connectInfo.ts";
