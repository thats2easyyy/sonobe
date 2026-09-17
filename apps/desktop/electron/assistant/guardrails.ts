/**
 * Guardrails around the Assistant's tool calls: deletions that need the person's confirmation, and
 * refusals from the "Read only" agent permission. Pure functions over tool inputs and results.
 */

import type { ToolCallResult } from "./toolBridge.ts";

/** Deleting more than this many items asks first (matches @sonobe/mcp delete_items). */
export const DELETE_CONFIRM_THRESHOLD = 10;

const REMOVE_OPS = new Set(["removeLayer", "removePatch", "removeComment", "removeComponent", "removeAsset"]);

export interface DeletionPrompt {
  count: number;
  title: string;
  message: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** An apply_ops batch that removes more than `threshold` items (checked before it runs). Dry runs never ask. */
export function applyOpsDeletion(input: unknown, threshold = DELETE_CONFIRM_THRESHOLD): DeletionPrompt | null {
  if (!input || typeof input !== "object") return null;
  const { ops, dryRun } = input as { ops?: unknown; dryRun?: unknown };
  if (dryRun === true || !Array.isArray(ops)) return null;
  const counts = new Map<string, number>();
  for (const op of ops) {
    const kind = op && typeof op === "object" ? (op as { op?: unknown }).op : undefined;
    if (typeof kind === "string" && REMOVE_OPS.has(kind)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const count = [...counts.values()].reduce((a, b) => a + b, 0);
  if (count <= threshold) return null;
  const parts = [
    ["removeLayer", "layer"],
    ["removePatch", "patch"],
    ["removeComment", "comment"],
    ["removeComponent", "component"],
    ["removeAsset", "asset"],
  ]
    .filter(([op]) => counts.has(op!))
    .map(([op, word]) => plural(counts.get(op!)!, word!).replace(/patchs$/, "patches"));
  return {
    count,
    title: `Delete ${plural(count, "item")}?`,
    message: `The Assistant wants to remove ${parts.join(", ")} in one change. You can undo it afterwards.`,
  };
}

/** A delete_items result that stopped to ask (status "confirmation_required"). */
export function deleteConfirmation(result: ToolCallResult): { token: string; summary: string; count: number } | null {
  const s = result.structuredContent;
  if (!s || s.status !== "confirmation_required" || typeof s.confirmToken !== "string") return null;
  const summary = typeof s.summary === "string" ? s.summary : "The Assistant wants to delete several items.";
  const match = /Deleting (\d+) item/.exec(summary);
  return { token: s.confirmToken, summary, count: match ? Number(match[1]) : 0 };
}

/** The editor refused a write because Settings → Claude is "Read only". */
export function isReadOnlyRefusal(result: ToolCallResult): boolean {
  if (!result.isError) return false;
  const error = result.structuredContent?.error;
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "agent_read_only") return true;
  return result.content.some((c) => c.type === "text" && typeof c.text === "string" && c.text.includes("agent_read_only"));
}
