/**
 * What the Assistant runs on, as the drawer and the canvas's box show it: the person's API key, or
 * (experimental, off by default) their Claude subscription through Claude's agent adapter.
 */

import type { AssistantProvider, AssistantStatus, AssistantSubscriptionState, AssistantSubscriptionStatus } from "./types.ts";

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

/** The logins that bill something other than the person's Claude plan: an API key or Console login (at API rates), a gateway, another provider. */
const OTHER_BILLING: ReadonlySet<string> = new Set(["api_key", "gateway", "external"]);

/**
 * What pays on the Claude subscription when it isn't the person's plan: the adapter's label ("Anthropic API key").
 * Null for a plan, and while the adapter hasn't said (the copy then speaks of the plan).
 */
export function billedElsewhere(subscription: AssistantSubscriptionStatus | null | undefined): string | null {
  return subscription?.kind && OTHER_BILLING.has(subscription.kind) ? (subscription.label ?? "another account") : null;
}

/**
 * The header's subtitle, and its whole wording for the tooltip. What matters comes first, since a narrow header cuts the end:
 * "Claude Max · subscription"; "Billed to Anthropic API key" when the plan doesn't pay (whole: "Claude subscription · billed to
 * Anthropic API key"); "Your API key · sk-ant-…1234"; or what's missing.
 */
export function providerSubtitle(status: AssistantStatus | null, provider: AssistantProvider): { text: string; full: string } {
  const same = (text: string) => ({ text, full: text });
  if (provider === "subscription") {
    const subscription = status?.subscription;
    const elsewhere = billedElsewhere(subscription);
    if (elsewhere) return { text: `Billed to ${elsewhere}`, full: `Claude subscription · billed to ${elsewhere}` };
    if (!subscription?.label) return same("Claude subscription");
    return same(subscription.kind === "none" ? `Claude subscription · ${subscription.label}` : `${subscription.label} · subscription`);
  }
  return same(status?.hasKey ? `Your API key · ${status.keyHint ?? ""}` : "Bring your own API key");
}

/** "your API key", "your Claude subscription": for sentences. */
export const providerName = (provider: AssistantProvider): string => (provider === "subscription" ? "your Claude subscription" : "your API key");
