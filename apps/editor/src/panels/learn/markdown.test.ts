import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getGuideCatalog } from "./guides.ts";
import { Markdown } from "./Markdown.tsx";
import { collectLinks, inlineText, parseInline, parseMarkdown, sanitizeHref, slugify, type MdBlock } from "./markdown.ts";

const render = (source: string) => renderToStaticMarkup(createElement(Markdown, { source }));

const ALLOWED_TAGS = new Set(["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "hr", "a", "strong", "em", "del", "br", "button", "svg", "path", "rect", "line", "polyline", "circle"]);

const NUL = String.fromCharCode(0);
const ZERO_WIDTH = String.fromCharCode(0x200b);

function tagNames(html: string): string[] {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]!.toLowerCase());
}

describe("parseMarkdown", () => {
  it("parses headings with unique GitHub-style ids", () => {
    const blocks = parseMarkdown("# Title\n\n## What you'll be able to do\n\n## Try it\n\n## Try it");
    const headings = blocks.filter((b): b is Extract<MdBlock, { type: "heading" }> => b.type === "heading");
    expect(headings.map((h) => [h.level, h.id])).toEqual([
      [1, "title"],
      [2, "what-youll-be-able-to-do"],
      [2, "try-it"],
      [2, "try-it-1"],
    ]);
    expect(parseMarkdown("#hashtag")[0]!.type).toBe("paragraph");
  });

  it("joins soft line breaks and keeps hard breaks", () => {
    const [p] = parseMarkdown("one\ntwo  \nthree");
    expect(p).toEqual({ type: "paragraph", children: [{ type: "text", text: "one two" }, { type: "break" }, { type: "text", text: "three" }] });
  });

  it("keeps fenced code verbatim", () => {
    const [code] = parseMarkdown("```sh\nclaude mcp add sonobe -- sonobe mcp\n<b>not bold</b>\n```");
    expect(code).toEqual({ type: "code", lang: "sh", text: "claude mcp add sonobe -- sonobe mcp\n<b>not bold</b>" });
  });

  it("parses nested and ordered lists", () => {
    const [list] = parseMarkdown("3. first\n4. second\n   - nested a\n   - nested b\n5. third");
    expect(list).toMatchObject({ type: "list", ordered: true, start: 3, tight: true });
    const items = (list as Extract<MdBlock, { type: "list" }>).items;
    expect(items).toHaveLength(3);
    expect(items[1]![1]).toMatchObject({ type: "list", ordered: false });
    expect((items[1]![1] as Extract<MdBlock, { type: "list" }>).items.map((item) => inlineText((item[0] as Extract<MdBlock, { type: "paragraph" }>).children))).toEqual(["nested a", "nested b"]);
  });

  it("marks lists with blank lines between items as loose", () => {
    const [list] = parseMarkdown("- a\n\n- b");
    expect(list).toMatchObject({ type: "list", tight: false });
  });

  it("parses GFM tables with alignment, escaped pipes, and pipes in code", () => {
    const [table] = parseMarkdown("| Level | Read |\n|:---|---:|\n| 0 | `a|b` and a\\|b |");
    expect(table).toMatchObject({ type: "table", align: ["left", "right"] });
    const t = table as Extract<MdBlock, { type: "table" }>;
    expect(inlineText(t.rows[0]![1]!)).toBe("a|b and a|b");
  });

  it("parses block quotes and rules", () => {
    const blocks = parseMarkdown("> quoted\n> more\n\n---\n\ntext");
    expect(blocks.map((b) => b.type)).toEqual(["blockquote", "hr", "paragraph"]);
  });

  it("parses inline code, strong, emphasis, strikethrough, links, and autolinks", () => {
    const nodes = parseInline('Use `sonobe mcp`, **bold *nested***, _em_, ~~old~~, [guide](02-isat.md "ISAT") and <https://example.com>.');
    expect(nodes.map((n) => n.type)).toEqual(["text", "code", "text", "strong", "text", "em", "text", "del", "text", "link", "text", "link", "text"]);
    const links = collectLinks(nodes);
    expect(links.map((l) => l.href)).toEqual(["02-isat.md", "https://example.com"]);
    expect(parseInline("snake_case_name")).toEqual([{ type: "text", text: "snake_case_name" }]);
    expect(parseInline("2 * 3 * 4")).toEqual([{ type: "text", text: "2 * 3 * 4" }]);
  });

  it("uses image alt text instead of loading images", () => {
    expect(parseInline("![a diagram](https://example.com/x.png)")).toEqual([{ type: "text", text: "a diagram" }]);
  });

  it("slugifies like GitHub", () => {
    expect(slugify("Level 0: never prototyped")).toBe("level-0-never-prototyped");
    expect(slugify("!!!")).toBe("section");
  });
});

describe("sanitizeHref", () => {
  it("allows http(s), mailto, relative paths, and anchors", () => {
    for (const href of ["https://claude.com", "http://127.0.0.1:52817/mcp", "mailto:hi@example.com", "02-isat.md", "05-springs-and-feel.md#handoff-to-engineers", "#try-it", "../research/notes.md", "?q=1"]) {
      expect(sanitizeHref(href)).toBe(href);
    }
  });

  it("rejects dangerous or disguised schemes", () => {
    const bad = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      `${NUL}javascript:alert(1)`,
      `java${ZERO_WIDTH}script:alert(1)`,
      "javascript&colon;alert(1)",
      "javascript&#58;alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "//evil.example",
      "\\\\evil.example",
      "/\\evil.example",
      "",
    ];
    for (const href of bad) expect(sanitizeHref(href), JSON.stringify(href)).toBeNull();
  });
});

describe("Markdown rendering safety", () => {
  it("renders raw HTML as text, never as elements", () => {
    const html = render('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>\n\nHi <b onclick="x()">there</b>\n\n<iframe src="https://evil.example"></iframe>');
    expect(html).not.toMatch(/<script|<img|<iframe|<b[ >]/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    for (const tag of tagNames(html)) expect(ALLOWED_TAGS.has(tag), tag).toBe(true);
  });

  it("drops unsafe link targets but keeps the label", () => {
    const html = render("[click me](javascript:alert(1)) [data](data:text/html;base64,PHNjcmlwdD4=) [ok](https://example.com)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).toContain("click me");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("escapes HTML in link labels, code spans, fenced code, and table cells", () => {
    const html = render('[<img src=x>](https://example.com) `<script>` \n\n```html\n<script>alert(1)</script>\n```\n\n| a |\n|---|\n| <svg onload=alert(1)> |');
    expect(html).not.toMatch(/<script|<img|<svg onload/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes attribute-breaking characters in hrefs", () => {
    const html = render('[x](https://example.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/"\s*onmouseover=/);
  });

  it("renders every bundled guide with only allowed elements", () => {
    const catalog = getGuideCatalog();
    for (const guide of [...catalog.guides, ...(catalog.readme ? [catalog.readme] : [])]) {
      const html = renderToStaticMarkup(createElement(Markdown, { blocks: guide.blocks }));
      for (const tag of tagNames(html)) expect(ALLOWED_TAGS.has(tag), `${guide.slug}: <${tag}>`).toBe(true);
      expect(html).not.toMatch(/<[a-z]+[^>]*\son[a-z]+=/i);
    }
  });
});
