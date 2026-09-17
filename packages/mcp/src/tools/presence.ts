/** Presence and history tools: begin_work, finish_work, reveal, list_history, undo. */

import { z } from "zod";
import { plural } from "../format.ts";
import { success } from "../results.ts";
import { DESTRUCTIVE, READ_ONLY, UI_ONLY, type ToolContext } from "../server.ts";
import { DocIdSchema } from "../schemas.ts";
import { formatDiagnostic } from "./read.ts";

function ago(timestamp: number): string {
  const s = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function registerPresenceTools(tc: ToolContext): void {
  const { host } = tc;

  tc.tool(
    "begin_work",
    {
      title: "Begin work",
      description:
        'Show the person what you\'re about to change: a short intent ("Adding a press animation to the card") and the items involved get a working badge in the editor. Call before a series of edits.',
      input: z.object({
        docId: DocIdSchema.optional(),
        intent: z.string().min(1).max(160),
        ids: z.array(z.string()).max(200).optional().describe("Layers and patches you'll touch."),
      }),
      annotations: UI_ONLY,
    },
    async ({ docId, intent, ids }, ctx) => {
      const author = tc.author(ctx);
      await host.setWorking(
        { ids: ids ?? [], intent },
        { author, ...(docId !== undefined ? { docId } : {}) },
      );
      const note = host.capabilities.presence
        ? "The person sees your working badge."
        : "Recorded (headless: there's no editor to show it in).";
      return success(`Working: ${intent}. ${note} Call finish_work when done.`, {
        intent,
        ids: ids ?? [],
        author: author.name,
      });
    },
  );

  tc.tool(
    "finish_work",
    {
      title: "Finish work",
      description:
        "Clear your working badge when you're done editing (always call it, even after a failure).",
      input: z.object({
        docId: DocIdSchema.optional(),
        summary: z
          .string()
          .max(400)
          .optional()
          .describe("What you did, in one sentence for the person."),
      }),
      annotations: UI_ONLY,
    },
    async ({ docId, summary }, ctx) => {
      await host.setWorking(null, {
        author: tc.author(ctx),
        ...(docId !== undefined ? { docId } : {}),
      });
      return success(`Finished${summary ? `: ${summary}` : "."}`, { summary: summary ?? null });
    },
  );

  tc.tool(
    "reveal",
    {
      title: "Reveal",
      description:
        "Point the person at layers or patches in the editor (flash them; with focus, also scroll the canvas to them if their settings allow). Doesn't change the selection.",
      input: z.object({
        docId: DocIdSchema.optional(),
        ids: z.array(z.string()).min(1).max(50),
        focus: z.boolean().optional(),
      }),
      annotations: UI_ONLY,
    },
    async ({ docId, ids, focus }) => {
      const r = await host.reveal(ids, {
        ...(docId !== undefined ? { docId } : {}),
        ...(focus !== undefined ? { focus } : {}),
      });
      return success(
        r.revealed
          ? `Revealed ${ids.join(", ")}.`
          : `Not revealed: ${r.reason ?? "the editor declined."}`,
        { ...r },
      );
    },
  );

  tc.tool(
    "list_history",
    {
      title: "List history",
      description:
        'Undoable change groups, newest first: txnId, revision, author and label ("Claude: added press animation (12 ops)").',
      input: z.object({
        docId: DocIdSchema.optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Default 20."),
        author: z.string().optional().describe('"human", "agent", or an author name.'),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, limit, author }) => {
      const items = await host.history.list({
        ...(docId !== undefined ? { docId } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(author !== undefined ? { author } : {}),
      });
      if (!items.length) return success("No history yet.", { entries: [] });
      return success(
        items
          .map((e) => `${e.txnId} · r${e.revision} · ${e.summary} · ${ago(e.timestamp)}`)
          .join("\n"),
        { entries: items },
      );
    },
  );

  tc.tool(
    "undo",
    {
      title: "Undo",
      description:
        "Undo the newest change group (or everything back to and including txnId) as one step. Refuses to throw away a human's edit unless you name its txnId or pass allowHumanEdits after asking.",
      input: z.object({
        docId: DocIdSchema.optional(),
        txnId: z.string().optional(),
        allowHumanEdits: z.boolean().optional(),
      }),
      annotations: DESTRUCTIVE,
    },
    async ({ docId, txnId, allowHumanEdits }, ctx) => {
      const r = await host.history.undo({
        author: tc.author(ctx),
        ...(docId !== undefined ? { docId } : {}),
        ...(txnId !== undefined ? { txnId } : {}),
        ...(allowHumanEdits !== undefined ? { allowHumanEdits } : {}),
      });
      const lines = [
        `Undid ${r.undone.map((u) => `"${u.summary}"`).join(", ")} · revision ${r.revision}`,
      ];
      const d = r.diagnostics;
      lines.push(
        `Diagnostics: ${d.added.length} added, ${d.resolved.length} resolved · now ${plural(d.totals.errors, "error")}, ${plural(d.totals.warnings, "warning")}, ${d.totals.info} info`,
      );
      for (const x of d.added.filter((x) => x.severity !== "info").slice(0, 4))
        lines.push(...formatDiagnostic(x).map((l) => `  + ${l}`));
      if (r.saved) lines.push("Saved to disk.");
      return success(lines.join("\n"), { ...r });
    },
  );
}
