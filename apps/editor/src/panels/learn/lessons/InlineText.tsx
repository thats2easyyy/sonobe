import type { ReactNode } from "react";

/** Lesson copy markup: **bold** and `code`. Everything else renders as plain text. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let key = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(match[1] !== undefined ? <strong key={key++}>{match[1]}</strong> : <code key={key++}>{match[2]}</code>);
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function InlineText({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}
