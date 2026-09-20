/**
 * Guardrails around the Assistant's tool calls: deletions that need the person's confirmation, and
 * refusals from the "Read only" agent permission. Pure functions over tool inputs and results.
 *
 * Deletions are counted by impact, not by op: the agent dry-runs a destructive batch first, and the
 * server's `removed` summary counts cascades (a removeLayer takes its children, a removeComponent
 * takes everything inside it, setScript with no source deletes a script file). The agent also keeps a
 * running total per reply, so splitting a big deletion into small batches still asks.
 */

import { describeRemovals, isDestructiveOp, type RemovalSummary } from "@sonobe/mcp";
import type { ToolCallResult } from "./toolBridge.ts";

/** Removing more than this many items in one reply without asking stops to ask. delete_items' own server-side confirmation uses the same number. */
export const DELETE_CONFIRM_THRESHOLD = 10;

/** What the agent asks the person before a change (a big deletion, or a replace the person may not want). */
export interface ConfirmPrompt { count: number; title: string; message: string; kind?: "delete" | "replace"; approveLabel?: string; declineLabel?: string }
export type DeletionPrompt = ConfirmPrompt;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function opsOf(input: unknown): unknown[] | null {
  if (!input || typeof input !== "object") return null;
  const { ops, dryRun } = input as { ops?: unknown; dryRun?: unknown };
  if (dryRun === true || !Array.isArray(ops)) return null;
  return ops;
}

/** An apply_ops input (not a dry run) with ops that can delete content. */
export function isDestructiveApplyOps(input: unknown): boolean {
  return opsOf(input)?.some(isDestructiveOp) ?? false;
}

/** One item per destructive op: the fallback when a dry run couldn't count cascades. Null when nothing is removed. */
export function estimateRemovals(input: unknown): RemovalSummary | null {
  const ops = opsOf(input);
  if (!ops) return null;
  const out: RemovalSummary = { layers: 0, patches: 0, comments: 0, components: 0, assets: 0, scripts: 0, total: 0 };
  const field: Record<string, keyof Omit<RemovalSummary, "total">> = {
    removeLayer: "layers",
    removePatch: "patches",
    removeComment: "comments",
    removeComponent: "components",
    removeAsset: "assets",
    setScript: "scripts",
  };
  for (const op of ops) {
    if (!isDestructiveOp(op)) continue;
    const key = field[(op as { op: string }).op];
    if (key) out[key]++;
  }
  out.total = out.layers + out.patches + out.comments + out.components + out.assets + out.scripts;
  return out.total ? out : null;
}

/** The `removed` summary a write tool reports for destructive batches (cascades included). */
export function removalsFromResult(result: ToolCallResult): RemovalSummary | null {
  const removed = result.structuredContent?.removed;
  if (!removed || typeof removed !== "object") return null;
  const r = removed as Record<string, unknown>;
  const num = (key: string) => (typeof r[key] === "number" && Number.isFinite(r[key]) ? Math.max(0, r[key] as number) : 0);
  const out: RemovalSummary = { layers: num("layers"), patches: num("patches"), comments: num("comments"), components: num("components"), assets: num("assets"), scripts: num("scripts"), total: 0 };
  out.total = Math.max(num("total"), out.layers + out.patches + out.comments + out.components + out.assets + out.scripts);
  return out;
}

/**
 * Ask before a change that removes `removed`, when it plus what the Assistant already removed in this
 * reply without asking goes over `threshold`.
 */
export function deletionPrompt(removed: RemovalSummary | null, alreadyRemoved = 0, threshold = DELETE_CONFIRM_THRESHOLD): DeletionPrompt | null {
  if (!removed || removed.total <= 0 || removed.total + alreadyRemoved <= threshold) return null;
  const what = describeRemovals(removed) || plural(removed.total, "item");
  if (alreadyRemoved > 0) {
    return {
      count: removed.total,
      title: `Delete ${removed.total} more item${removed.total === 1 ? "" : "s"}?`,
      message: `The Assistant wants to remove ${what}. It already removed ${plural(alreadyRemoved, "item")} in this reply without asking. You can undo it afterwards.`,
    };
  }
  return {
    count: removed.total,
    title: `Delete ${plural(removed.total, "item")}?`,
    message: `The Assistant wants to remove ${what} in one change. You can undo it afterwards.`,
  };
}

/** An apply_ops batch whose destructive ops alone go over `threshold` (one item per op; dry runs never ask). */
export function applyOpsDeletion(input: unknown, threshold = DELETE_CONFIRM_THRESHOLD): DeletionPrompt | null {
  return deletionPrompt(estimateRemovals(input), 0, threshold);
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
