/**
 * The guide library, bundled at build time from docs/guides with Vite's import.meta.glob (?raw).
 * Parses each guide's title and meta line (level, minutes, next steps), its outcomes and headings,
 * the level map from the README's learning-path table, links between guides, and search.
 */

import { fuzzyMatch } from "../../ui/lib/fuzzy.ts";
import { collectLinks, inlineText, parseMarkdown, type MdBlock } from "./markdown.ts";

const GUIDE_FILES = import.meta.glob("../../../../../docs/guides/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const README_SLUG = "README";
export const CLAUDE_GUIDE_SLUG = "11-working-with-claude";

export interface GuideLink {
  slug: string;
  anchor: string | null;
  label: string;
}

export interface GuideHeading {
  id: string;
  text: string;
  level: number;
}

export interface Guide {
  /** File name without .md: "01-first-prototype". */
  slug: string;
  /** "01", or null for unnumbered files. */
  number: string | null;
  title: string;
  /** "Level 0", "Level 0–1", "Any level", or "" when the guide has no meta line. */
  levelLabel: string;
  /** Levels the guide covers (empty for any-level guides). */
  levels: number[];
  anyLevel: boolean;
  minutes: number | null;
  /** Audience note from the meta line ("for Origami Studio users"). */
  audience: string | null;
  /** First outcome, or the first paragraph. */
  summary: string;
  /** "What you'll be able to do" bullets. */
  outcomes: string[];
  next: GuideLink[];
  headings: GuideHeading[];
  markdown: string;
  blocks: MdBlock[];
}

export interface LevelRow {
  level: number;
  /** "New to prototyping, or new to patch editors" */
  audience: string;
  guides: GuideLink[];
  /** "Tap to zoom, a like button, a card that expands" */
  outcomes: string;
}

export interface GuideCatalog {
  /** Numbered guides in order (README excluded). */
  guides: Guide[];
  readme: Guide | null;
  levels: LevelRow[];
  anyLevel: Guide[];
  get(slug: string): Guide | undefined;
}

export function guideSlug(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/**
 * Where a link inside a guide points: another guide (and anchor), an anchor on the same page, or
 * null for external links and files outside docs/guides.
 */
export function resolveGuideHref(href: string): { slug: string | null; anchor: string | null } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const hash = href.indexOf("#");
  const path = hash >= 0 ? href.slice(0, hash) : href;
  const rawAnchor = hash >= 0 ? href.slice(hash + 1) : "";
  let anchor: string | null = null;
  if (rawAnchor) {
    try {
      anchor = decodeURIComponent(rawAnchor);
    } catch {
      anchor = rawAnchor;
    }
  }
  if (!path) return anchor ? { slug: null, anchor } : null;
  const clean = path.replace(/^\.\//, "");
  if (!/^[^/?]+\.md$/i.test(clean)) return null;
  return { slug: clean.replace(/\.md$/i, ""), anchor };
}

function linksToGuides(nodes: Parameters<typeof collectLinks>[0]): GuideLink[] {
  const out: GuideLink[] = [];
  for (const link of collectLinks(nodes)) {
    const target = link.href ? resolveGuideHref(link.href) : null;
    if (target?.slug) out.push({ slug: target.slug, anchor: target.anchor, label: inlineText(link.children).trim() });
  }
  return out;
}

export function parseGuide(slug: string, markdown: string): Guide {
  const blocks = parseMarkdown(markdown);
  const titleIndex = blocks.findIndex((b) => b.type === "heading" && b.level === 1);
  const titleBlock = blocks[titleIndex];
  const title = titleBlock?.type === "heading" ? titleBlock.text : slug;

  const metaBlock = blocks[titleIndex + 1];
  const metaText = metaBlock?.type === "paragraph" ? inlineText(metaBlock.children).trim() : "";
  const isMeta = metaBlock?.type === "paragraph" && /^(level\s+\d|any level)/i.test(metaText);
  const parts = isMeta ? metaText.split("·").map((p) => p.trim()) : [];

  let levels: number[] = [];
  const range = /^level\s+(\d+)(?:\s*(?:to|–|-)\s*(\d+))?/i.exec(parts[0] ?? "");
  if (range) {
    const from = Number(range[1]);
    const to = range[2] !== undefined ? Number(range[2]) : from;
    levels = Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i);
  }
  const anyLevel = /^any level/i.test(parts[0] ?? "");
  const levelLabel = anyLevel ? "Any level" : levels.length > 1 ? `Level ${levels[0]}–${levels.at(-1)}` : levels.length ? `Level ${levels[0]}` : "";
  const minutesMatch = /(\d+)\s*min/i.exec(metaText);
  const audience = parts.find((p) => /^for\s/i.test(p)) ?? null;
  const next = isMeta && metaBlock ? linksToGuides([metaBlock]) : [];

  const outcomes: string[] = [];
  const outcomesIndex = blocks.findIndex((b) => b.type === "heading" && /be able to do/i.test(b.text));
  const outcomeList = outcomesIndex >= 0 ? blocks.slice(outcomesIndex + 1).find((b) => b.type !== "paragraph" || b.type === "paragraph") : undefined;
  if (outcomeList?.type === "list") {
    for (const item of outcomeList.items) {
      const text = item.map((b) => (b.type === "paragraph" ? inlineText(b.children) : "")).join(" ").trim();
      if (text) outcomes.push(text);
    }
  }
  const firstParagraph = blocks.slice(isMeta ? titleIndex + 2 : titleIndex + 1).find((b) => b.type === "paragraph");
  const summary = outcomes[0] ?? (firstParagraph?.type === "paragraph" ? inlineText(firstParagraph.children).trim() : "");

  const headings: GuideHeading[] = [];
  for (const b of blocks) if (b.type === "heading" && b.level >= 2 && b.level <= 3) headings.push({ id: b.id, text: b.text, level: b.level });

  return {
    slug,
    number: /^(\d+)-/.exec(slug)?.[1] ?? null,
    title,
    levelLabel,
    levels,
    anyLevel,
    minutes: minutesMatch ? Number(minutesMatch[1]) : null,
    audience,
    summary,
    outcomes,
    next,
    headings,
    markdown,
    blocks,
  };
}

/** Rows of the first table whose first header cell is "Level" (the README's learning path). */
export function parseLevelMap(blocks: readonly MdBlock[]): LevelRow[] {
  const table = blocks.find((b): b is Extract<MdBlock, { type: "table" }> => b.type === "table" && /^level$/i.test(inlineText(b.head[0] ?? []).trim()));
  if (!table) return [];
  const header = table.head.map((cell) => inlineText(cell).trim().toLowerCase());
  const column = (pattern: RegExp, fallback: number) => {
    const index = header.findIndex((h) => pattern.test(h));
    return index >= 0 ? index : fallback;
  };
  const audienceColumn = column(/you are|who/, 1);
  const readColumn = column(/read/, 2);
  const outcomesColumn = column(/build|afterwards|can/, 3);
  const rows: LevelRow[] = [];
  for (const row of table.rows) {
    const level = Number.parseInt(inlineText(row[0] ?? []).trim(), 10);
    if (!Number.isFinite(level)) continue;
    rows.push({
      level,
      audience: inlineText(row[audienceColumn] ?? []).trim(),
      guides: linksToGuides(row[readColumn] ?? []),
      outcomes: inlineText(row[outcomesColumn] ?? []).trim(),
    });
  }
  return rows.sort((a, b) => a.level - b.level);
}

/** Build a catalog from `{ path: markdown }` (paths end in the guide file name). */
export function createGuideCatalog(files: Record<string, string>): GuideCatalog {
  let readme: Guide | null = null;
  const guides: Guide[] = [];
  for (const [path, markdown] of Object.entries(files)) {
    const slug = guideSlug(path);
    const guide = parseGuide(slug, markdown);
    if (slug.toLowerCase() === README_SLUG.toLowerCase()) readme = guide;
    else guides.push(guide);
  }
  guides.sort((a, b) => (a.number ?? "999").localeCompare(b.number ?? "999") || a.slug.localeCompare(b.slug));
  const bySlug = new Map(guides.map((g) => [g.slug, g]));

  let levels = readme ? parseLevelMap(readme.blocks) : [];
  if (levels.length === 0) {
    const byLevel = new Map<number, Guide[]>();
    for (const g of guides) {
      const first = g.levels[0];
      if (first !== undefined) byLevel.set(first, [...(byLevel.get(first) ?? []), g]);
    }
    levels = [...byLevel].sort(([a], [b]) => a - b).map(([level, list]) => ({ level, audience: "", outcomes: "", guides: list.map((g) => ({ slug: g.slug, anchor: null, label: g.title })) }));
  }

  return {
    guides,
    readme,
    levels,
    anyLevel: guides.filter((g) => g.anyLevel),
    get: (slug) => (slug.toLowerCase() === README_SLUG.toLowerCase() ? (readme ?? undefined) : bySlug.get(slug)),
  };
}

let catalog: GuideCatalog | undefined;

/** The bundled docs/guides catalog (parsed once). */
export function getGuideCatalog(): GuideCatalog {
  catalog ??= createGuideCatalog(GUIDE_FILES);
  return catalog;
}

export interface GuideSearchResult {
  guide: Guide;
  score: number;
  /** A heading that contains every term. */
  heading: GuideHeading | null;
  /** A line of prose around the first term. */
  snippet: string | null;
}

function plainLine(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>|]/g, "")
    .replace(/^\s*(?:[-+]|\d+\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function snippetFor(markdown: string, term: string): string | null {
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*#/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) continue;
    const text = plainLine(line);
    const at = text.toLowerCase().indexOf(term);
    if (at < 0) continue;
    const start = Math.max(0, at - 48);
    const end = Math.min(text.length, at + term.length + 72);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
  }
  return null;
}

/** Rank guides for a query: title matches first, then headings, then prose. */
export function searchGuides(guides: readonly Guide[], query: string): GuideSearchResult[] {
  const q = query.trim();
  if (!q) return guides.map((guide) => ({ guide, score: 0, heading: null, snippet: null }));
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results: GuideSearchResult[] = [];
  for (const guide of guides) {
    let score = 0;
    const title = guide.title.toLowerCase();
    if (terms.every((t) => title.includes(t))) score += 60 + (title.startsWith(terms[0]!) ? 10 : 0);
    else if (q.length >= 3) {
      const fuzzy = fuzzyMatch(q, guide.title);
      if (fuzzy && fuzzy.score > q.length * 4) score += 20;
    }
    const heading = guide.headings.find((h) => terms.every((t) => h.text.toLowerCase().includes(t))) ?? null;
    if (heading) score += 25;
    const body = guide.markdown.toLowerCase();
    let snippet: string | null = null;
    if (terms.every((t) => body.includes(t))) {
      const occurrences = body.split(terms[0]!).length - 1;
      score += 8 + Math.min(12, occurrences);
      snippet = snippetFor(guide.markdown, terms[0]!);
    }
    if (score > 0) results.push({ guide, score, heading, snippet });
  }
  return results.sort((a, b) => b.score - a.score || (a.guide.number ?? "").localeCompare(b.guide.number ?? ""));
}
