import { Check, Copy } from "lucide-react";
import { createElement, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { IconButton } from "../../ui/IconButton.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { parseMarkdown, type MdBlock, type MdInline } from "./markdown.ts";
import "./markdown.css";

export interface MarkdownProps {
  source?: string;
  /** Pre-parsed blocks (takes precedence over `source`). */
  blocks?: readonly MdBlock[];
  /** Relative links ("02-isat.md", "#anchor"). Without it, anchors scroll to their heading and other relative links do nothing. */
  onNavigate?: (href: string) => void;
  /** Prefix for heading ids so several documents can share a page. */
  idPrefix?: string;
  /** Copy buttons on fenced code that names a language. Default true. */
  copyCode?: boolean;
  /** Render headings this many levels deeper (1: "#" becomes h2). Default 0. */
  headingOffset?: number;
  className?: string;
}

interface RenderContext {
  onNavigate?: (href: string) => void;
  idPrefix: string;
  copyCode: boolean;
  headingOffset: number;
}

/**
 * Renders Markdown as React elements (never innerHTML): raw HTML in the source shows as text, and
 * unsafe link targets render as plain text. External links open in a new window.
 */
export function Markdown({ source, blocks, onNavigate, idPrefix = "", copyCode = true, headingOffset = 0, className }: MarkdownProps) {
  const parsed = useMemo(() => blocks ?? parseMarkdown(source ?? ""), [blocks, source]);
  const ctx: RenderContext = { idPrefix, copyCode, headingOffset, ...(onNavigate ? { onNavigate } : {}) };
  return <div className={cx("sb-md", className)}>{renderBlocks(parsed, ctx)}</div>;
}

function renderBlocks(blocks: readonly MdBlock[], ctx: RenderContext, tight = false): ReactNode[] {
  return blocks.map((block, i) => renderBlock(block, ctx, i, tight));
}

function renderBlock(block: MdBlock, ctx: RenderContext, key: number, tight: boolean): ReactNode {
  switch (block.type) {
    case "heading": {
      const level = Math.min(6, block.level + ctx.headingOffset);
      return createElement(`h${level}`, { key, id: `${ctx.idPrefix}${block.id}`, className: "sb-md__h", "data-level": block.level }, renderInlines(block.children, ctx));
    }
    case "paragraph":
      return tight ? (
        <span key={key} className="sb-md__tight">
          {renderInlines(block.children, ctx)}
        </span>
      ) : (
        <p key={key} className="sb-md__p">
          {renderInlines(block.children, ctx)}
        </p>
      );
    case "code":
      return <CodeBlock key={key} lang={block.lang} text={block.text} copy={ctx.copyCode} />;
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="sb-md__li">
          {renderBlocks(item, ctx, block.tight)}
        </li>
      ));
      return block.ordered ? (
        <ol key={key} className="sb-md__list" data-tight={block.tight || undefined} start={block.start !== 1 ? block.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key} className="sb-md__list" data-tight={block.tight || undefined}>
          {items}
        </ul>
      );
    }
    case "table":
      return (
        <div key={key} className="sb-md__table sb-scroll">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, c) => (
                  <th key={c} style={block.align[c] ? { textAlign: block.align[c]! } : undefined}>
                    {renderInlines(cell, ctx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={block.align[c] ? { textAlign: block.align[c]! } : undefined}>
                      {renderInlines(cell, ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "blockquote":
      return (
        <blockquote key={key} className="sb-md__quote">
          {renderBlocks(block.children, ctx)}
        </blockquote>
      );
    case "hr":
      return <hr key={key} className="sb-md__hr" />;
  }
}

function renderInlines(nodes: readonly MdInline[], ctx: RenderContext): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return (
          <code key={i} className="sb-md__code-inline">
            {node.text}
          </code>
        );
      case "strong":
        return <strong key={i}>{renderInlines(node.children, ctx)}</strong>;
      case "em":
        return <em key={i}>{renderInlines(node.children, ctx)}</em>;
      case "del":
        return <del key={i}>{renderInlines(node.children, ctx)}</del>;
      case "break":
        return <br key={i} />;
      case "link":
        return (
          <LinkNode key={i} href={node.href} ctx={ctx}>
            {renderInlines(node.children, ctx)}
          </LinkNode>
        );
    }
  });
}

function LinkNode({ href, ctx, children }: { href: string | null; ctx: RenderContext; children: ReactNode }) {
  if (!href) return <span className="sb-md__link-text">{children}</span>;
  if (/^(https?|mailto):/i.test(href)) {
    return (
      <a className="sb-md__link" href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (ctx.onNavigate) {
      ctx.onNavigate(href);
      return;
    }
    if (href.startsWith("#")) {
      const target = event.currentTarget.ownerDocument.getElementById(`${ctx.idPrefix}${decodeURIComponent(href.slice(1))}`);
      target?.scrollIntoView({ block: "start" });
    }
  };
  return (
    <a className="sb-md__link" href={href} onClick={onClick}>
      {children}
    </a>
  );
}

function CodeBlock({ lang, text, copy }: { lang: string; text: string; copy: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  const canCopy = copy && lang !== "" && lang !== "text";
  return (
    <div className="sb-md__code" data-lang={lang || undefined}>
      <pre className="sb-md__pre sb-scroll sb-selectable">
        <code>{text}</code>
      </pre>
      {canCopy && (
        <IconButton
          size="xs"
          variant="secondary"
          className="sb-md__copy"
          icon={copied ? <Check size={12} /> : <Copy size={12} />}
          label={copied ? "Copied" : "Copy code"}
          tooltipPlacement="left"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => setCopied(true),
              () => undefined,
            );
          }}
        />
      )}
    </div>
  );
}
