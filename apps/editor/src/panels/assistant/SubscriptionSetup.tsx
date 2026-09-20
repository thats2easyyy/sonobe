import { CircleAlert, CircleCheck, CircleUserRound, Copy, Info, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import type { AssistantController } from "./controller.ts";
import { billedElsewhere, CLAUDE_AGENT_INSTALL } from "./provider.ts";
import type { AssistantSubscriptionStatus } from "./types.ts";

export interface SubscriptionSetupProps {
  controller: AssistantController;
  /** status.subscription; undefined before the host reports one. */
  subscription: AssistantSubscriptionStatus | undefined;
  /** Shown once Claude is ready: go to the chat. */
  onDone?: () => void;
  /** The done button's label. Default "Use Claude subscription". */
  doneLabel?: string;
}

/**
 * Setup for the experimental Claude subscription path (off by default, awaiting Anthropic's
 * permission): what it does, whether Claude's agent adapter is installed and signed in, and how to fix
 * it when it isn't. Checks on its own when this launch hasn't yet.
 */
export function SubscriptionSetup({ controller, subscription, onDone, doneLabel = "Use Claude subscription" }: SubscriptionSetupProps) {
  const state = subscription?.state ?? "unknown";
  const [signIn, setSignIn] = useState<{ state: "idle" | "opening" | "opened" } | { state: "error"; message: string }>({ state: "idle" });
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  // Also on a "checking" main answered with (another window's check, or the adapter starting): the controller's check waits
  // for it, rather than the setup spinning until something else reads the status. It shares a check that's already running.
  useEffect(() => {
    if (state === "unknown" || state === "checking") void controller.checkSubscription();
  }, [state, controller]);

  useEffect(() => {
    if (copied !== "copied") return;
    const timer = setTimeout(() => setCopied("idle"), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const checking = state === "unknown" || state === "checking";
  const check = () => {
    setSignIn({ state: "idle" });
    void controller.checkSubscription();
  };

  const openSignIn = async () => {
    setSignIn({ state: "opening" });
    const result = await controller.signInToClaude();
    if (!result || result.ok) setSignIn({ state: "opened" });
    else setSignIn({ state: "error", message: result.error });
  };

  const copyInstall = async () => {
    try {
      await navigator.clipboard.writeText(CLAUDE_AGENT_INSTALL);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  const checkAgain = (
    <Button size="sm" onClick={check} loading={checking}>
      Check again
    </Button>
  );

  let body;
  if (checking) {
    body = (
      <p className="sb-assistant-key__status" role="status">
        <LoaderCircle size={13} className="sb-spin" aria-hidden /> Checking Claude…
      </p>
    );
  } else if (state === "ready") {
    const elsewhere = billedElsewhere(subscription);
    body = (
      <>
        {elsewhere ? (
          <p className="sb-assistant-key__status" data-tone="warn" role="status">
            <TriangleAlert size={13} aria-hidden className="sb-assistant-sub__status-icon" />
            <span>Claude's adapter is set to use {elsewhere}, so this bills that, not your Claude plan.</span>
          </p>
        ) : subscription?.kind === "account" ? (
          <div className="sb-assistant-key__saved-row sb-assistant-sub__account" role="status">
            <CircleCheck size={15} aria-hidden className="sb-assistant-key__ok" />
            <span className="sb-assistant-sub__account-text">{["Signed in", subscription.label, subscription.email].filter(Boolean).join(" · ")}</span>
          </div>
        ) : (
          // The adapter answered but never said which login it uses: Sonobe doesn't know that it's signed in.
          <p className="sb-assistant-key__status" role="status">
            <Info size={13} aria-hidden className="sb-assistant-sub__status-icon" />
            <span>Claude's agent adapter is running, but it didn't say which Claude account it uses. If it isn't signed in, your first message will say so.</span>
          </p>
        )}
        {subscription?.adapterVersion ? <p className="sb-assistant-key__replace">Claude's agent adapter {subscription.adapterVersion}</p> : null}
        <div className="sb-assistant-key__actions">
          {checkAgain}
          {onDone ? (
            <Button size="sm" variant="primary" onClick={onDone} className="sb-assistant-key__done">
              {doneLabel}
            </Button>
          ) : null}
        </div>
      </>
    );
  } else if (state === "not_installed") {
    body = (
      <>
        <p className="sb-assistant-sub__lead">Install Claude's agent adapter (it needs Node.js 22 or later):</p>
        <div className="sb-assistant-sub__command">
          <code className="sb-selectable">{CLAUDE_AGENT_INSTALL}</code>
          <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copyInstall()}>
            {copied === "copied" ? "Copied" : "Copy"}
          </Button>
        </div>
        {copied === "failed" ? (
          <p className="sb-assistant-key__status" data-tone="danger" role="alert">
            Sonobe couldn't use the clipboard. Select the command and copy it.
          </p>
        ) : null}
        <p className="sb-assistant-key__replace">Run it in Terminal, then check again.</p>
        <div className="sb-assistant-key__actions">{checkAgain}</div>
      </>
    );
  } else {
    // signed_out or failed.
    const signedOut = state === "signed_out";
    body = (
      <>
        <p className="sb-assistant-key__status" data-tone={signedOut ? undefined : "danger"} role={signedOut ? "status" : "alert"}>
          {signedOut ? null : <CircleAlert size={13} aria-hidden className="sb-assistant-sub__status-icon" />}
          <span>{subscription?.message ?? (signedOut ? "Claude isn't signed in on this computer." : "Claude's agent adapter didn't start.")}</span>
        </p>
        <div className="sb-assistant-key__actions">
          {signedOut ? (
            <Button size="sm" variant="primary" onClick={() => void openSignIn()} loading={signIn.state === "opening"}>
              Sign in…
            </Button>
          ) : null}
          {checkAgain}
        </div>
        {signIn.state === "opened" ? (
          <p className="sb-assistant-key__status" role="status">
            Finish signing in in Terminal, then choose Check again.
          </p>
        ) : signIn.state === "error" ? (
          <p className="sb-assistant-key__status" data-tone="danger" role="alert">
            {signIn.message}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="sb-assistant-key">
      <div className="sb-assistant-key__intro">
        <span className="sb-assistant-key__icon" aria-hidden>
          <CircleUserRound size={18} strokeWidth={1.75} />
        </span>
        <h3 className="sb-assistant-key__title">Use your Claude subscription</h3>
        <p className="sb-assistant-key__lead">The Assistant runs Claude through Claude's agent adapter, with the Claude account you're signed in to on this computer. It draws on your plan's usage limits. No API key.</p>
      </div>

      <div className="sb-assistant-key__saved sb-assistant-sub" data-state={state}>
        {body}
      </div>

      <div className="sb-assistant-privacy">
        <ShieldCheck size={15} aria-hidden className="sb-assistant-privacy__icon" />
        <ul>
          <li>Sonobe never sees your Claude login: the adapter uses the one Claude Code keeps on this computer.</li>
          <li>Your messages, the parts of this prototype Claude reads, and files from a linked code folder go to Anthropic under your Claude account.</li>
          <li>Experimental: awaiting Anthropic's permission, so it's off by default and not in any release.</li>
        </ul>
      </div>
    </div>
  );
}
