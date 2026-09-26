import { Check, Copy } from "lucide-react";
import { Fragment, useEffect, useId, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { connectClaudeStore, type CopiedKind } from "./connectStore.ts";

export interface CopyBlockProps {
  text: string;
  /** What this is, for the copy button's accessible name ("Claude Code command"). */
  label: string;
  /** Recorded in connectClaudeStore.copied after a successful copy. Default "setup". */
  kind?: CopiedKind;
  /** Turns Copy off, and says why in its tooltip and to screen readers. */
  disabledReason?: string | undefined;
  /** A stand-in inside `text` that isn't filled in yet: shown dimmed. */
  placeholder?: string | undefined;
}

/** Copyable monospace text: a command or a config snippet. */
export function CopyBlock({ text, label, kind = "setup", disabledReason, placeholder }: CopyBlockProps) {
  const [copied, setCopied] = useState(false);
  const reasonId = useId();
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => setCopied(false), [text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      connectClaudeStore.getState().markCopied(kind);
    } catch {
      toast.error("Couldn't copy", { description: "Select the text and copy it instead." });
    }
  };

  const copyButton = (
    <Button size="sm" variant="secondary" className="sb-copyblock__button" icon={copied ? <Check size={12} /> : <Copy size={12} />} aria-label={copied ? `${label} copied` : `Copy ${label}`} disabled={disabledReason !== undefined} aria-describedby={disabledReason !== undefined ? reasonId : undefined} onClick={() => void copy()}>
      {copied ? "Copied" : "Copy"}
    </Button>
  );

  return (
    <div className="sb-copyblock" data-multiline={text.includes("\n") || undefined}>
      <pre className="sb-copyblock__code sb-scroll sb-selectable" aria-label={label}>
        <code>
          {placeholder && text.includes(placeholder)
            ? text.split(placeholder).map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="sb-copyblock__placeholder">{placeholder}</span>}
                  {part}
                </Fragment>
              ))
            : text}
        </code>
      </pre>
      {disabledReason === undefined ? (
        copyButton
      ) : (
        <>
          <Tooltip content={disabledReason} placement="left">
            <span className="sb-copyblock__action">{copyButton}</span>
          </Tooltip>
          <span id={reasonId} className="sb-visually-hidden">
            {disabledReason}
          </span>
        </>
      )}
    </div>
  );
}
