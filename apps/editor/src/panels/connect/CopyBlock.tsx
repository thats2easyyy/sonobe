import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { toast } from "../../ui/Toast.tsx";

export interface CopyBlockProps {
  text: string;
  /** What this is, for the copy button's accessible name ("Claude Code command"). */
  label: string;
}

/** Copyable monospace text: a command or a config snippet. */
export function CopyBlock({ text, label }: CopyBlockProps) {
  const [copied, setCopied] = useState(false);
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
    } catch {
      toast.error("Couldn't copy", { description: "Select the text and copy it instead." });
    }
  };

  return (
    <div className="sb-copyblock" data-multiline={text.includes("\n") || undefined}>
      <pre className="sb-copyblock__code sb-scroll sb-selectable" aria-label={label}>
        <code>{text}</code>
      </pre>
      <Button size="sm" variant="secondary" className="sb-copyblock__button" icon={copied ? <Check size={12} /> : <Copy size={12} />} aria-label={copied ? `${label} copied` : `Copy ${label}`} onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
