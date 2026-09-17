/** Minimal Markdown for patch docs: headings, paragraphs, lists, tables, code blocks, bold, inline code, and link text. */

import { Fragment, type ReactNode } from "react";
import { cx } from "../../ui/lib/cx.ts";

export type DocBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "code"; text: string };

const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
const BLOCK_START = /^(#{1,6}\s|```|\s*(?:[-*]|\d+\.)\s+|\s*\|)/;

export function parseDocBlocks(markdown: string): DocBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: DocBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1]!.trim() });
      i++;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i]!)) {
        items.push(lines[i++]!.replace(LIST_ITEM, ""));
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !LIST_ITEM.test(lines[i]!)) items[items.length - 1] += ` ${lines[i++]!.trim()}`;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i++]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) rows.push(cells);
      }
      blocks.push({ kind: "table", rows });
      continue;
    }
    const paragraph = [line.trim()];
    i++;
    while (i < lines.length && lines[i]!.trim() && !BLOCK_START.test(lines[i]!)) paragraph.push(lines[i++]!.trim());
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]*\))/g).map((part, i) => {
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\([^)]*\)$/.exec(part);
    return <Fragment key={i}>{link ? link[1] : part}</Fragment>;
  });
}

export function DocsText({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={cx("sb-insp-docs sb-selectable", className)}>
      {parseDocBlocks(markdown).map((block, i) => {
        switch (block.kind) {
          case "heading":
            return <h4 key={i}>{inline(block.text)}</h4>;
          case "paragraph":
            return <p key={i}>{inline(block.text)}</p>;
          case "list":
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case "code":
            return (
              <pre key={i} className="sb-mono">
                {block.text}
              </pre>
            );
          case "table":
            return (
              <table key={i}>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (j === 0 ? <th key={k}>{inline(cell)}</th> : <td key={k}>{inline(cell)}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
        }
      })}
    </div>
  );
}
