/**
 * What the Assistant runs on, as the drawer and the canvas's box show it: the person's API key, or
 * (experimental, off by default) their Claude subscription through Claude's agent adapter.
 */

import type { AssistantProvider, AssistantStatus, AssistantSubscriptionState } from "./types.ts";

/** The command that installs Claude's agent adapter. */
export const CLAUDE_AGENT_INSTALL = "npm install -g @agentclientprotocol/claude-agent-acp";

/** What a new chat runs on. Older preloads have only the API key. */
export function activeProvider(status: AssistantStatus | null | undefined): AssistantProvider {
  return status?.connection?.active ?? "api_key";
}

/** What this window's next message runs on: its chat's provider, kept until New chat, else what a new chat runs on. */
export function chatProvider(status: AssistantStatus | null | undefined): AssistantProvider {
  return status?.chatProvider ?? activeProvider(status);
}

const NOT_READY: ReadonlySet<AssistantSubscriptionState> = new Set(["signed_out", "not_installed", "failed"]);

/**
 * Whether `provider` can take a message: a saved key, or a subscription that isn't signed out, missing or
 * failing. Unknown and checking count as ready: a send then says what's wrong.
 */
export function providerReady(status: AssistantStatus, provider: AssistantProvider = chatProvider(status)): boolean {
  if (provider === "api_key") return status.hasKey;
  return !NOT_READY.has(status.subscription?.state ?? "unknown");
}

/** The header's subtitle: "Claude subscription · Claude Max", "Your API key · sk-ant-…1234", or what's missing. */
export function providerSubtitle(status: AssistantStatus | null, provider: AssistantProvider): string {
  if (provider === "subscription") return status?.subscription?.label ? `Claude subscription · ${status.subscription.label}` : "Claude subscription";
  return status?.hasKey ? `Your API key · ${status.keyHint ?? ""}` : "Bring your own API key";
}

/** "your API key", "your Claude subscription": for sentences. */
export const providerName = (provider: AssistantProvider): string => (provider === "subscription" ? "your Claude subscription" : "your API key");
