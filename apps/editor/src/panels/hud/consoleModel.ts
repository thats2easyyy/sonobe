/** Console tab helpers: level and text filters, script locations in messages, and source resolution. */

import type { Id, SonobeDocument } from "@sonobe/core";
import { findLayer } from "@sonobe/core";
import type { ConsoleEntry, ConsoleLevel } from "../../state/console.ts";
import { itemKindOf, type ItemKind } from "../../state/selection.ts";

export type ConsoleLevelFilter = Record<ConsoleLevel, boolean>;

export const CONSOLE_LEVELS: readonly ConsoleLevel[] = ["error", "warn", "info", "log"];

export const ALL_CONSOLE_LEVELS: ConsoleLevelFilter = { log: true, info: true, warn: true, error: true };

export interface ConsoleFilter {
  levels: ConsoleLevelFilter;
  /** Case-insensitive; every whitespace-separated term must appear in the message or source. */
  query?: string;
}

export function filterConsoleEntries(entries: readonly ConsoleEntry[], filter: ConsoleFilter): ConsoleEntry[] {
  const terms = (filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (!filter.levels[entry.level]) return false;
    if (terms.length === 0) return true;
    const haystack = `${entry.source} ${entry.message}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export interface ScriptLocation {
  line: number;
  column?: number;
}

/**
 * The script line (and column) a message points at: "line 12", "Line 3, column 5", "(12:5)",
 * or a trailing "js_1.js:12:5". Null when there's none.
 */
export function scriptLocation(message: string): ScriptLocation | null {
  const words = /\bline (\d+)(?:,? (?:column|col) (\d+))?/i.exec(message);
  if (words) return words[2] ? { line: Number(words[1]), column: Number(words[2]) } : { line: Number(words[1]) };
  const pair = /(?:\.js|\(|<anonymous>|script):(\d+):(\d+)\)?|\((\d+):(\d+)\)/.exec(message);
  if (pair) {
    const line = Number(pair[1] ?? pair[3]);
    const column = Number(pair[2] ?? pair[4]);
    return { line, column };
  }
  return null;
}

/**
 * The component a console component path refers to. Paths are the root component id followed by
 * component instance ids ("main/card_instance"); each instance names the component it shows.
 */
export function componentForPath(doc: SonobeDocument, componentPath: string | undefined): Id | undefined {
  const root = doc.project.root;
  if (!componentPath) return root;
  const [first, ...instances] = componentPath.split("/").filter(Boolean);
  let current = first && doc.components[first] ? first : root;
  for (const instanceId of instances) {
    const component = doc.components[current];
    if (!component) return undefined;
    const target = component.patches[instanceId]?.component ?? findLayer(component.layers, instanceId)?.layer.component;
    if (!target || !doc.components[target]) return undefined;
    current = target;
  }
  return current;
}

export interface ConsoleSourceTarget {
  component: Id;
  id: Id;
  kind: ItemKind;
  /** Display name of the patch or layer. */
  name: string;
}

/** The patch or layer a console entry came from, when it still exists. */
export function consoleEntryTarget(doc: SonobeDocument, entry: Pick<ConsoleEntry, "source" | "componentPath">): ConsoleSourceTarget | null {
  const componentId = componentForPath(doc, entry.componentPath);
  const component = componentId ? doc.components[componentId] : undefined;
  if (!component || !componentId) return null;
  const kind = itemKindOf(component, entry.source);
  if (kind === "patch") {
    const node = component.patches[entry.source]!;
    return { component: componentId, id: entry.source, kind, name: node.name ?? entry.source };
  }
  if (kind === "layer") {
    const layer = findLayer(component.layers, entry.source)?.layer;
    return { component: componentId, id: entry.source, kind, name: layer?.name ?? entry.source };
  }
  return null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "14:03:27.512" in local time. */
export function formatConsoleTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
