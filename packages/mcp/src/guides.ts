/**
 * Agent guides (packages/mcp/guides/*.md): short, accurate workflow docs served by get_guide and
 * as resources. Loaded from disk once; SONOBE_GUIDES_DIR overrides the folder (bundles). Node only.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GUIDE_TOPICS = [
  "start-here",
  "importing",
  "graph-basics",
  "gestures",
  "animation",
  "layout",
  "loops",
  "components",
  "knobs",
  "simulation",
  "troubleshooting",
] as const;

export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export interface Guide {
  topic: string;
  title: string;
  markdown: string;
  /** Other topics this guide points to. */
  related: string[];
}

export interface GuideStore {
  list(): Guide[];
  get(topic: string): Guide | undefined;
}

/** Parse one guide: title from the first "# " heading, related topics from a "Related:" line. */
export function parseGuide(topic: string, markdown: string): Guide {
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? topic;
  const relatedLine = /^Related:\s*(.+)$/m.exec(markdown)?.[1] ?? "";
  const related = [...relatedLine.matchAll(/`([a-z-]+)`/g)]
    .map((m) => m[1]!)
    .filter((t) => t !== topic);
  return { topic, title, markdown, related };
}

/** The guides folder shipped next to this package (or SONOBE_GUIDES_DIR). */
export function defaultGuidesDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SONOBE_GUIDES_DIR) return env.SONOBE_GUIDES_DIR;
  const nextToModule = fileURLToPath(new URL("../guides/", import.meta.url));
  if (existsSync(nextToModule)) return nextToModule;
  return fileURLToPath(new URL("./guides/", import.meta.url));
}

/** Load every guide topic from `dir`. Missing files are skipped. */
export function loadGuides(dir: string = defaultGuidesDir()): GuideStore {
  const guides = new Map<string, Guide>();
  for (const topic of GUIDE_TOPICS) {
    const file = path.join(dir, `${topic}.md`);
    if (!existsSync(file)) continue;
    guides.set(topic, parseGuide(topic, readFileSync(file, "utf8")));
  }
  return {
    list: () => [...guides.values()],
    get: (topic) => guides.get(topic),
  };
}

let cached: GuideStore | undefined;

/** The default guide store, loaded on first use. */
export function defaultGuides(): GuideStore {
  cached ??= loadGuides();
  return cached;
}
