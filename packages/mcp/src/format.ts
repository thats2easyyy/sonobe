/** Token-lean text formatting shared by tools, resources and the CLI. Browser-safe. */

import { formatColor, formatNumber, isColor } from "@sonobe/core";
import { isLoop } from "@sonobe/engine";

const MAX_TEXT = 80;

/** Round for display: up to 4 decimals, no trailing zeros, -0 → 0. */
export function roundForDisplay(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const r = Math.round(n * 10000) / 10000;
  return formatNumber(Object.is(r, -0) ? 0 : r);
}

/** A runtime value as short text: 1.08, true, "Hi", [16, 120], #FF3B30FF, loop×3[0|1|2], @card#2. */
export function formatValue(value: unknown, depth = 0): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") return roundForDisplay(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string")
    return JSON.stringify(value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value);
  if (isLoop(value)) {
    const items = value.items.slice(0, 5).map((v) => formatValue(v, depth + 1));
    return `loop×${value.items.length}[${items.join("|")}${value.items.length > 5 ? "|…" : ""}]`;
  }
  if (Array.isArray(value)) {
    if (value.every((n) => typeof n === "number"))
      return `[${value.map((n) => roundForDisplay(n as number)).join(", ")}]`;
    if (depth > 1) return `[…${value.length}]`;
    return `[${value
      .slice(0, 5)
      .map((v) => formatValue(v, depth + 1))
      .join(", ")}${value.length > 5 ? ", …" : ""}]`;
  }
  if (isColor(value)) return formatColor(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.layerId === "string")
      return `@${o.layerId}${typeof o.instance === "number" ? `#${o.instance}` : ""}`;
    if (typeof o.assetId === "string") return `asset:${o.assetId}`;
    if (typeof o.path === "string" && Object.keys(o).length === 1)
      return `shape(${JSON.stringify(o.path.slice(0, 40))})`;
    let text: string;
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
  }
  return String(value);
}

/** A runtime value as plain JSON (loops become { loop: [...] }, non-finite numbers null). */
export function toJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === undefined) return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
  if (typeof value !== "object" || value === null) return value;
  if (isLoop(value)) return { loop: value.items.map((v) => toJsonValue(v, depth + 1)) };
  if (Array.isArray(value)) return value.map((v) => toJsonValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = toJsonValue(v, depth + 1);
  return out;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  nextCursor?: string;
}

/** Offset pagination with an opaque string cursor. */
export function paginate<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number,
): Page<T> {
  const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const page = items.slice(offset, offset + limit);
  const out: Page<T> = { items: page, total: items.length, offset };
  if (offset + page.length < items.length) out.nextCursor = String(offset + page.length);
  return out;
}

/** "Showing 1–40 of 212. Pass cursor: "40" for more." or "". */
export function pageNote(page: Page<unknown>, noun: string): string {
  if (page.nextCursor === undefined && page.offset === 0) return "";
  const from = page.total ? page.offset + 1 : 0;
  const to = page.offset + page.items.length;
  const more =
    page.nextCursor !== undefined
      ? ` ${page.total - to} more; pass cursor "${page.nextCursor}" to continue.`
      : "";
  return `Showing ${noun} ${from}–${to} of ${page.total}.${more}`;
}

/** Cut long text at a line budget with an explicit continuation note. */
export function truncateLines(
  text: string,
  maxLines: number,
  offset = 0,
): { text: string; truncated: boolean; totalLines: number; nextOffset?: number } {
  const lines = text.split("\n");
  const slice = lines.slice(offset, offset + maxLines);
  const truncated = offset + maxLines < lines.length;
  const out: { text: string; truncated: boolean; totalLines: number; nextOffset?: number } = {
    text: slice.join("\n"),
    truncated,
    totalLines: lines.length,
  };
  if (truncated) {
    out.nextOffset = offset + maxLines;
    out.text += `\n… ${lines.length - offset - maxLines} more lines (pass offset: ${offset + maxLines}).`;
  }
  return out;
}

/** Left-aligned columns separated by two spaces. */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

/** Plural helper: plural(3, "patch", "patches") → "3 patches". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Oxford-free list join: "a, b and c". */
export function joinList(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

/** Evenly spaced sample indices, always including the first and last. */
export function sampleIndices(length: number, max: number): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i);
  if (max <= 1) return [length - 1];
  const out = new Set<number>();
  for (let i = 0; i < max; i++) out.add(Math.round((i * (length - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}
