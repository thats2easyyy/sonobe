import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "../../ui/IconButton.tsx";
import { TextArea } from "../../ui/TextField.tsx";
import { budgetFraction, formatCost, formatTokens } from "./format.ts";
import type { AssistantLimits, AssistantProvider, AssistantUsage } from "./types.ts";

export interface ComposerProps {
  running: boolean;
  disabled?: boolean;
  /** Return false to keep the text in the field (nothing was sent). A promise clears it once it resolves true, unless the text changed meanwhile. */
  onSend: (text: string) => boolean | void | Promise<boolean>;
  onStop: () => void;
  usage: AssistantUsage | null;
  limits: AssistantLimits | null;
  placeholder?: string;
  ariaLabel?: string;
  /** The field's aria-describedby: a notice about what sending does. */
  ariaDescribedBy?: string;
  /** What the send button says it does. Default "Send". */
  sendLabel?: string;
  /** Hide the usage meter until this share of the budget is used (0–1). Default 0: always shown. */
  usageThreshold?: number;
  /** What the chat runs on. The subscription has no budget here (the plan's own limits apply): the meter shows tokens only, and a threshold hides it. */
  provider?: AssistantProvider;
  /** On the subscription, what pays when it isn't the person's Claude plan (billedElsewhere: "Anthropic API key"). */
  billedTo?: string | null;
}

/** What the budget counts: billed-weight tokens, or the plain total from older hosts. */
const budgetUsed = (usage: AssistantUsage | null) => usage?.budgetTokens ?? usage?.totalTokens ?? 0;

/** Tokens used in this chat against its budget, with a list-price estimate. On the subscription, the tokens only, and what pays for them. */
export function UsageMeter({ usage, limits, provider = "api_key", billedTo = null }: { usage: AssistantUsage | null; limits: AssistantLimits | null; provider?: AssistantProvider; billedTo?: string | null }) {
  if (provider === "subscription") {
    const total = usage?.totalTokens ?? 0;
    const title = billedTo
      ? `Tokens this chat used, as Claude's agent adapter counts them. Claude's adapter is set to use ${billedTo}, so that pays for them at its own rates, not your Claude plan.`
      : "Tokens this chat used, as Claude's agent adapter counts them. Your Claude plan's own usage limits apply.";
    return (
      <div className="sb-assistant-usage" title={title}>
        <span className="sb-assistant-usage__text">
          {formatTokens(total)} tokens · {billedTo ? `billed to ${billedTo}` : "your Claude plan"}
        </span>
      </div>
    );
  }
  const used = budgetUsed(usage);
  const budget = limits?.tokenBudget ?? 0;
  const fraction = budgetFraction(used, budget);
  const level = fraction >= 0.9 ? "high" : fraction >= 0.7 ? "medium" : "low";
  const label = budget ? `${formatTokens(used)} of ${formatTokens(budget)} budget used in this chat` : `${formatTokens(used)} tokens used in this chat`;
  const title = [
    "Cache reads count at a tenth and cache writes at 1.25×, the way they're billed.",
    "Estimated at list prices from input, cache and output tokens. Your Anthropic Console shows what you're actually billed.",
    usage?.cacheReadTokens ? `${formatTokens(usage.cacheReadTokens)} tokens came from the prompt cache.` : "",
    usage && usage.budgetTokens !== undefined ? `${formatTokens(usage.totalTokens)} tokens in all.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="sb-assistant-usage" title={title}>
      <div className="sb-assistant-usage__bar" role="meter" aria-label="Token budget" aria-valuemin={0} aria-valuemax={budget || 1} aria-valuenow={used} aria-valuetext={label} data-level={level}>
        <span style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <span className="sb-assistant-usage__text">
        {formatTokens(used)}
        {budget ? ` / ${formatTokens(budget)}` : ""} tokens · ≈ {formatCost(usage?.estimatedCostUsd ?? 0)}
      </span>
    </div>
  );
}

/** Message field with Send and Stop. Enter sends; Shift+Enter adds a line. */
export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer({ running, disabled = false, onSend, onStop, usage, limits, placeholder, ariaLabel, ariaDescribedBy, sendLabel = "Send", usageThreshold = 0, provider = "api_key", billedTo = null }, ref) {
  const [text, setText] = useState("");
  const canSend = !disabled && !running && text.trim().length > 0;
  const showMeter = provider === "subscription" ? usageThreshold === 0 : budgetFraction(budgetUsed(usage), limits?.tokenBudget ?? 0) >= usageThreshold;

  const send = () => {
    if (!canSend) return;
    const sent = onSend(text);
    if (sent === false) return;
    if (sent instanceof Promise) {
      void sent.then((ok) => {
        if (ok) setText((current) => (current === text ? "" : current));
      });
      return;
    }
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="sb-assistant-composer">
      <div className="sb-assistant-composer__field" data-disabled={disabled || undefined}>
        <TextArea
          ref={ref}
          value={text}
          rows={1}
          aria-label={ariaLabel ?? "Message the Assistant"}
          aria-describedby={ariaDescribedBy}
          placeholder={placeholder ?? (disabled ? "Add an API key to start chatting" : "Describe what to build or ask a question…")}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className="sb-assistant-composer__input"
        />
        {running ? (
          <IconButton icon={<Square size={12} fill="currentColor" />} label="Stop" shortcut="Escape" variant="solid" size="sm" className="sb-assistant-composer__stop" onClick={onStop} />
        ) : (
          <IconButton icon={<ArrowUp size={15} strokeWidth={2.25} />} label={sendLabel} shortcut="Enter" variant="solid" size="sm" className="sb-assistant-composer__send" disabled={!canSend} onClick={send} />
        )}
      </div>
      {showMeter ? <UsageMeter usage={usage} limits={limits} provider={provider} billedTo={billedTo} /> : null}
    </div>
  );
});
