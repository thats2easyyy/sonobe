import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "../../ui/IconButton.tsx";
import { TextArea } from "../../ui/TextField.tsx";
import { budgetFraction, formatCost, formatTokens } from "./format.ts";
import type { AssistantLimits, AssistantUsage } from "./types.ts";

export interface ComposerProps {
  running: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  usage: AssistantUsage | null;
  limits: AssistantLimits | null;
}

/** Tokens used in this chat against its budget, with a list-price estimate. */
export function UsageMeter({ usage, limits }: { usage: AssistantUsage | null; limits: AssistantLimits | null }) {
  const used = usage?.totalTokens ?? 0;
  const budget = limits?.tokenBudget ?? 0;
  const fraction = budgetFraction(used, budget);
  const level = fraction >= 0.9 ? "high" : fraction >= 0.7 ? "medium" : "low";
  const label = budget ? `${formatTokens(used)} of ${formatTokens(budget)} tokens used in this chat` : `${formatTokens(used)} tokens used in this chat`;
  return (
    <div className="sb-assistant-usage" title={`Estimated at list prices from input, cache and output tokens. Your Anthropic Console shows what you're actually billed.${usage?.cacheReadTokens ? ` ${formatTokens(usage.cacheReadTokens)} tokens came from the prompt cache.` : ""}`}>
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
export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer({ running, disabled = false, onSend, onStop, usage, limits }, ref) {
  const [text, setText] = useState("");
  const canSend = !disabled && !running && text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(text);
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
          aria-label="Message the Assistant"
          placeholder={disabled ? "Add an API key to start chatting" : "Describe what to build or ask a question…"}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className="sb-assistant-composer__input"
        />
        {running ? (
          <IconButton icon={<Square size={12} fill="currentColor" />} label="Stop" shortcut="Escape" variant="solid" size="sm" className="sb-assistant-composer__stop" onClick={onStop} />
        ) : (
          <IconButton icon={<ArrowUp size={15} strokeWidth={2.25} />} label="Send" shortcut="Enter" variant="solid" size="sm" className="sb-assistant-composer__send" disabled={!canSend} onClick={send} />
        )}
      </div>
      <UsageMeter usage={usage} limits={limits} />
    </div>
  );
});
