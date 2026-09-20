import { describe, expect, it } from "vitest";
import { billedElsewhere, providerReady, providerSubtitle, subscriptionSwitchedOff } from "./provider.ts";
import { fakeAssistantHost, signedIn, subscriptionStatus } from "./testing.ts";
import type { AssistantStatus, AssistantSubscriptionStatus } from "./types.ts";

async function statusWith(subscription: AssistantSubscriptionStatus, extra: Partial<AssistantStatus> = {}): Promise<AssistantStatus> {
  const host = fakeAssistantHost({ connection: { subscriptionEnabled: true, provider: "subscription" }, subscription });
  return { ...(await host.assistant!.status()), ...extra };
}

describe("providerSubtitle on the Claude subscription", () => {
  it("puts the plan first, and says what pays when it isn't the plan", async () => {
    expect(providerSubtitle(await statusWith(signedIn()), "subscription")).toEqual({ text: "Claude Max · subscription", full: "Claude Max · subscription" });
    expect(providerSubtitle(await statusWith(subscriptionStatus({ state: "ready", kind: "api_key", label: "Anthropic API key" })), "subscription")).toEqual({
      text: "Billed to Anthropic API key",
      full: "Claude subscription · billed to Anthropic API key",
    });
    expect(providerSubtitle(await statusWith(subscriptionStatus()), "subscription").text).toBe("Claude subscription");
  });

  it("says not signed in while signed out, whatever the last login's label says", async () => {
    // After auth_required mid-chat the status can keep the plan's label, or an API key's kind.
    for (const stale of [
      subscriptionStatus({ state: "signed_out", kind: "none", label: "Claude Max" }),
      subscriptionStatus({ state: "signed_out", kind: "api_key", label: "Anthropic API key" }),
      subscriptionStatus({ state: "signed_out", kind: "none", label: "Not logged in" }),
      // While Check again reads it.
      subscriptionStatus({ state: "checking", kind: "none", label: "Not logged in" }),
    ]) {
      const status = await statusWith(stale);
      expect(providerSubtitle(status, "subscription")).toEqual({ text: "Claude subscription · not signed in", full: "Claude subscription · not signed in" });
      expect(billedElsewhere(status.subscription)).toBeNull();
    }
  });
});

describe("subscriptionSwitchedOff", () => {
  it("is a subscription chat whose switch has gone off since, which no setup fixes", async () => {
    const signedOut = subscriptionStatus({ state: "signed_out", kind: "none", label: "Not logged in" });
    const off = await statusWith(signedOut, { connection: { available: true, subscriptionEnabled: false, provider: "subscription", active: "api_key" }, chatProvider: "subscription" });
    expect(subscriptionSwitchedOff(off)).toBe(true);
    expect(providerReady(off)).toBe(false);
    // The switch on: the setup can fix it. A chat on the API key, or a new chat: nothing to hold.
    expect(subscriptionSwitchedOff({ ...off, connection: { ...off.connection!, subscriptionEnabled: true, active: "subscription" } })).toBe(false);
    expect(subscriptionSwitchedOff({ ...off, chatProvider: "api_key" })).toBe(false);
    expect(subscriptionSwitchedOff({ ...off, chatProvider: null })).toBe(false);
    expect(subscriptionSwitchedOff(null)).toBe(false);
  });
});
