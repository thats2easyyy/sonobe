/**
 * A small, safe Markdown parser for the Learn drawer. Blocks: ATX headings, paragraphs, fenced and
 * indented code, nested lists, block quotes, thematic breaks, and GFM tables. Inlines: code spans,
 * strong, emphasis, strikethrough, links, autolinks, and hard breaks. The output is a plain AST that
 * renders to React elements: raw HTML in the source stays literal text, and link targets are limited
 * to http(s), mailto, and relative paths or anchors.
 */

export type MdInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "del"; children: MdInline[] }
  /** `href` is null when the target was unsafe or empty (render the label as text). */
  | { type: "link"; href: string | null; children: MdInline[] }
  | { type: "break" };

export type MdAlign = "left" | "center" | "right" | null;

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type MdBlock =
  | { type: "heading"; level: HeadingLevel; id: string; text: string; children: MdInline[] }
  | { type: "paragraph"; children: MdInline[] }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; ordered: boolean; start: number; tight: boolean; items: MdBlock[][] }
  | { type: "table"; align: MdAlign[]; head: MdInline[][]; rows: MdInline[][][] }
  | { type: "blockquote"; children: MdBlock[] }
  | { type: "hr" };

const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);
const INVISIBLE_RANGES: readonly [number, number][] = [
  [0x00, 0x20],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0xfeff, 0xfeff],
];

/** Drop whitespace, control, and zero-width characters (browsers skip them inside URL schemes). */
function stripInvisible(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (!INVISIBLE_RANGES.some(([lo, hi]) => code >= lo && code <= hi)) out += ch;
  }
  return out;
}

/**
 * A link target that is safe to put in `href`, or null. Allows http, https, and mailto URLs plus
 * relative paths, queries, and anchors. Rejects every other scheme (javascript:, data:, vbscript:,
 * file:...), including ones disguised with whitespace, control characters, or entities, and
 * protocol-relative or backslash URLs that browsers resolve to another host.
 */
export function sanitizeHref(raw: string): string | null {
  const compact = stripInvisible(raw);
  if (!compact) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (scheme) return SAFE_SCHEMES.has(scheme[1]!.toLowerCase()) ? compact : null;
  if (compact.startsWith("//") || compact.includes("\\")) return null;
  const head = compact.split(/[/?#]/, 1)[0] ?? "";
  const beforePath = compact.split(/[/?]/, 1)[0] ?? "";
  if (head.includes(":") || /&(#|[a-z]+;)/i.test(beforePath)) return null;
  return compact;
}

/** GitHub-style heading slug: "What you'll be able to do" → "what-youll-be-able-to-do". */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
  return slug || "section";
}

/** Plain text of inline nodes (for headings, table cells, search). */
export function inlineText(nodes: readonly MdInline[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "code") out += node.text;
    else if (node.type === "break") out += " ";
    else out += inlineText(node.children);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;

function runLength(src: string, from: number, ch: string): number {
  let n = 0;
  while (src[from + n] === ch) n++;
  return n;
}

/** Index of a backtick run of exactly `run` characters at or after `from`, or -1. */
function findBacktickClose(src: string, from: number, run: number): number {
  let j = from;
  while (j < src.length) {
    if (src[j] === "`") {
      const n = runLength(src, j, "`");
      if (n === run) return j;
      j += n;
    } else {
      j++;
    }
  }
  return -1;
}

/** Skip a code span starting at `j` (a backtick); returns the index after it, or j + 1 when unclosed. */
function skipCode(src: string, j: number): number {
  const run = runLength(src, j, "`");
  const close = findBacktickClose(src, j + run, run);
  return close < 0 ? j + run : close + run;
}

function findDelimiter(src: string, from: number, ch: string, width: number): number {
  let j = from;
  while (j < src.length) {
    const c = src[j]!;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      j = skipCode(src, j);
      continue;
    }
    if (c === ch) {
      const n = runLength(src, j, ch);
      const before = src[j - 1] ?? " ";
      if (j > from && !/\s/.test(before) && n >= width) {
        if (width === 1 && n === 1) return j;
        if (width === 2) return n === 3 ? j + 1 : j;
      }
      j += n;
      continue;
    }
    j++;
  }
  return -1;
}

function parseEmphasisAt(src: string, i: number): { node: MdInline; end: number } | null {
  const ch = src[i]!;
  const run = runLength(src, i, ch);
  if (ch === "~" && run !== 2) return null;
  const width = ch === "~" ? 2 : run >= 2 ? 2 : 1;
  const after = src[i + width];
  if (after === undefined || /\s/.test(after)) return null;
  if (ch === "_" && i > 0 && WORD.test(src[i - 1]!)) return null;
  const close = findDelimiter(src, i + width, ch, width);
  if (close < 0) return null;
  if (ch === "_" && WORD.test(src[close + width] ?? "")) return null;
  const children = parseInline(src.slice(i + width, close));
  const node: MdInline = ch === "~" ? { type: "del", children } : width === 2 ? { type: "strong", children } : { type: "em", children };
  return { node, end: close + width };
}

interface LinkParts {
  label: string;
  href: string;
  end: number;
}

/** `[label](destination "title")` starting at `i` (the `[`). */
function parseLinkAt(src: string, i: number): LinkParts | null {
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "`") {
      j = skipCode(src, j) - 1;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  if (j >= src.length || src[j + 1] !== "(") return null;
  let parens = 0;
  let k = j + 1;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "(") parens++;
    else if (c === ")" && --parens === 0) break;
    else if (c === "\n") return null;
  }
  if (k >= src.length) return null;
  const destination = src.slice(j + 2, k).trim();
  const parts = /^(<[^>]*>|\S*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/.exec(destination);
  if (!parts) return null;
  const href = parts[1]!.replace(/^<|>$/g, "");
  return { label: src.slice(i + 1, j), href, end: k + 1 };
}

/** Parse inline Markdown (newlines are soft breaks; two trailing spaces or a backslash make a hard break). */
export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    const last = out.at(-1);
    if (last?.type === "text") last.text += buffer;
    else out.push({ type: "text", text: buffer });
    buffer = "";
  };
  const push = (node: MdInline) => {
    flush();
    out.push(node);
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        push({ type: "break" });
        i += 2;
        continue;
      }
      if (next !== undefined && PUNCTUATION.test(next)) {
        buffer += next;
        i += 2;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }
    if (ch === "\n") {
      if (/ {2,}$/.test(buffer)) {
        buffer = buffer.replace(/ +$/, "");
        push({ type: "break" });
      } else {
        buffer = `${buffer.replace(/ +$/, "")} `;
      }
      i++;
      while (src[i] === " ") i++;
      continue;
    }
    if (ch === "`") {
      const run = runLength(src, i, "`");
      const close = findBacktickClose(src, i + run, run);
      if (close >= 0) {
        let text = src.slice(i + run, close).replace(/\n/g, " ");
        if (text.length > 2 && text.startsWith(" ") && text.endsWith(" ") && text.trim()) text = text.slice(1, -1);
        push({ type: "code", text });
        i = close + run;
        continue;
      }
      buffer += src.slice(i, i + run);
      i += run;
      continue;
    }
    if (ch === "!" && src[i + 1] === "[") {
      const image = parseLinkAt(src, i + 1);
      if (image) {
        // Images aren't loaded; their alt text stands in.
        buffer += image.label;
        i = image.end;
        continue;
      }
    }
    if (ch === "[") {
      const link = parseLinkAt(src, i);
      if (link) {
        push({ type: "link", href: sanitizeHref(link.href), children: parseInline(link.label) });
        i = link.end;
        continue;
      }
    }
    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(src.slice(i));
      if (auto) {
        push({ type: "link", href: sanitizeHref(auto[1]!), children: [{ type: "text", text: auto[1]!.replace(/^mailto:/i, "") }] });
        i += auto[0].length;
        continue;
      }
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const emphasis = parseEmphasisAt(src, i);
      if (emphasis) {
        push(emphasis.node);
        i = emphasis.end;
        continue;
      }
      const run = runLength(src, i, ch);
      buffer += src.slice(i, i + run);
      i += run;
      continue;
    }
    buffer += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

interface ListMarker {
  indent: number;
  ordered: boolean;
  start: number;
  /** Column where item content starts. */
  contentIndent: number;
  rest: string;
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const TABLE_SEPARATOR = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const isBlank = (line: string) => line.trim() === "";
const indentOf = (line: string) => line.length - line.trimStart().length;

function listMarker(line: string): ListMarker | null {
  const m = /^( {0,3})([-*+]|\d{1,9}[.)])(?:( +)(.*))?$/.exec(line);
  if (!m) return null;
  const indent = m[1]!.length;
  const marker = m[2]!;
  const spaces = m[3]?.length ?? 0;
  const rest = m[4] ?? "";
  const ordered = /\d/.test(marker.charAt(0));
  const wide = spaces > 4;
  return {
    indent,
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    contentIndent: indent + marker.length + (spaces === 0 || wide ? 1 : spaces),
    rest: wide ? `${" ".repeat(spaces - 1)}${rest}` : rest,
  };
}

function isTableStart(lines: readonly string[], i: number): boolean {
  const header = lines[i];
  const separator = lines[i + 1];
  if (header === undefined || separator === undefined || !header.includes("|")) return false;
  return TABLE_SEPARATOR.test(separator) && (separator.includes("|") || header.trim().startsWith("|"));
}

function startsBlock(lines: readonly string[], i: number): boolean {
  const line = lines[i]!;
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || isTableStart(lines, i)) return true;
  const marker = listMarker(line);
  return !!marker && marker.rest.trim() !== "" && (!marker.ordered || marker.start === 1);
}

/** Split a table row on unescaped pipes outside code spans. */
function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === "\\" && row[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      const end = skipCode(row, i);
      cell += row.slice(i, end);
      i = end - 1;
    } else if (c === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

class SlugRegistry {
  #counts = new Map<string, number>();
  next(text: string): string {
    const base = slugify(text);
    const count = this.#counts.get(base) ?? 0;
    this.#counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  }
}

function parseBlockLines(lines: readonly string[], slugs: SlugRegistry): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence && !(fence[2]!.startsWith("`") && fence[3]!.includes("`"))) {
      const indent = fence[1]!.length;
      const marker = fence[2]!;
      const lang = fence[3]!.trim().split(/\s+/)[0] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]!);
        if (close && close[1]!.charAt(0) === marker.charAt(0) && close[1]!.length >= marker.length) {
          i++;
          break;
        }
        const l = lines[i]!;
        body.push(l.slice(Math.min(indent, indentOf(l))));
        i++;
      }
      out.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const children = parseInline(heading[2] ?? "");
      const text = inlineText(children);
      out.push({ type: "heading", level: heading[1]!.length as HeadingLevel, id: slugs.next(text), text, children });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ type: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i]!)) {
        const quote = QUOTE.exec(lines[i]!);
        if (quote) body.push(quote[1]!);
        else if (!startsBlock(lines, i)) body.push(lines[i]!);
        else break;
        i++;
      }
      out.push({ type: "blockquote", children: parseBlockLines(body, slugs) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align: MdAlign[] = splitRow(lines[i + 1]!).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      const columns = align.length;
      const fit = (cells: string[]) => Array.from({ length: columns }, (_, c) => parseInline(cells[c] ?? ""));
      const rows: MdInline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes("|")) {
        rows.push(fit(splitRow(lines[i]!)));
        i++;
      }
      out.push({ type: "table", align, head: fit(head), rows });
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const items: MdBlock[][] = [];
      let tight = true;
      while (i < lines.length) {
        const item = listMarker(lines[i]!);
        if (!item || item.ordered !== marker.ordered || item.indent >= marker.contentIndent) break;
        const content: string[] = [item.rest];
        i++;
        let sawBlank = false;
        while (i < lines.length) {
          const l = lines[i]!;
          if (isBlank(l)) {
            content.push("");
            sawBlank = true;
            i++;
            continue;
          }
          if (indentOf(l) >= item.contentIndent) {
            if (sawBlank && content.slice(0, -1).some((c) => c.trim() !== "")) tight = false;
            content.push(l.slice(item.contentIndent));
            sawBlank = false;
            i++;
            continue;
          }
          if (sawBlank) break;
          const inner = listMarker(l);
          if (inner || startsBlock(lines, i)) break;
          content.push(l.trim());
          i++;
        }
        let trailingBlank = false;
        while (content.length > 1 && isBlank(content.at(-1)!)) {
          content.pop();
          trailingBlank = true;
        }
        const next = i < lines.length ? listMarker(lines[i]!) : null;
        if (trailingBlank && next && next.ordered === marker.ordered && next.indent < marker.contentIndent) tight = false;
        items.push(parseBlockLines(content, slugs));
      }
      out.push({ type: "list", ordered: marker.ordered, start: marker.start, tight, items });
      continue;
    }

    if (indentOf(line) >= 4) {
      const body: string[] = [];
      while (i < lines.length && (isBlank(lines[i]!) || indentOf(lines[i]!) >= 4)) {
        body.push(lines[i]!.slice(4));
        i++;
      }
      while (body.length && isBlank(body.at(-1)!)) body.pop();
      out.push({ type: "code", lang: "", text: body.join("\n") });
      continue;
    }

    const paragraph: string[] = [line.trimStart()];
    i++;
    while (i < lines.length && !isBlank(lines[i]!) && !startsBlock(lines, i)) {
      paragraph.push(lines[i]!.trimStart());
      i++;
    }
    out.push({ type: "paragraph", children: parseInline(paragraph.join("\n").trimEnd()) });
  }
  return out;
}

/** Parse a Markdown document into blocks. Heading ids are unique within the document. */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return parseBlockLines(lines, new SlugRegistry());
}

/** Every link node in a subtree (blocks or inlines), in document order. */
export function collectLinks(nodes: readonly (MdBlock | MdInline)[]): Extract<MdInline, { type: "link" }>[] {
  const out: Extract<MdInline, { type: "link" }>[] = [];
  const visit = (node: MdBlock | MdInline) => {
    switch (node.type) {
      case "link":
        out.push(node);
        node.children.forEach(visit);
        break;
      case "strong":
      case "em":
      case "del":
      case "heading":
      case "paragraph":
        node.children.forEach(visit);
        break;
      case "blockquote":
        node.children.forEach(visit);
        break;
      case "list":
        for (const item of node.items) item.forEach(visit);
        break;
      case "table":
        for (const cell of node.head) cell.forEach(visit);
        for (const row of node.rows) for (const cell of row) cell.forEach(visit);
        break;
      default:
        break;
    }
  };
  nodes.forEach(visit);
  return out;
}
