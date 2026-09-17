/** Simulation tools: sim_reset, sim_dispatch, sim_step, sim_trace, sim_get_values, get_screenshot. */

import type { TraceSummary } from "@sonobe/engine";
import { z } from "zod";
import { formatValue, roundForDisplay, sampleIndices, table } from "../format.ts";
import type { ScreenshotTarget, SimEvent, SimState } from "../host.ts";
import { failure, success } from "../results.ts";
import { READ_ONLY, SIMULATION, type ToolContext } from "../server.ts";
import { DocIdSchema, SimEventSchema, SimStateOutputSchema } from "../schemas.ts";

function issuesText(state: SimState): string[] {
  const lines: string[] = [];
  if (state.documentUpdated)
    lines.push(
      "Note: the document changed since the last call; the simulation picked up the edits (laid out without advancing time) and kept compatible state. Use sim_reset for a clean start.",
    );
  for (const issue of state.issues.slice(0, 5))
    lines.push(
      `Runtime ${issue.severity}${issue.patchId ? ` in ${issue.patchId}` : issue.layerId ? ` on @${issue.layerId}` : ""}: ${issue.message}`,
    );
  if (state.issues.length > 5) lines.push(`… ${state.issues.length - 5} more runtime issues.`);
  return lines;
}

const header = (s: SimState) => `${s.simId} · frame ${s.frame} · ${roundForDisplay(s.timeMs)} ms`;

/** "settles at 1.08 after 412 ms, overshoot 0.012 (15%), range 1…1.092". */
export function summaryText(summary: TraceSummary | null): string {
  if (!summary) return "no numeric summary (non-numeric values)";
  const moved = Math.abs(summary.end - summary.start);
  const pct = moved > 1e-9 ? ` (${Math.round((summary.overshoot / moved) * 100)}%)` : "";
  const settle =
    summary.settleTime === null
      ? "still moving at the end (extend durationMs)"
      : summary.min === summary.max
        ? "constant"
        : `settled by ${Math.round(summary.settleTime * 1000)} ms`;
  return `start ${roundForDisplay(summary.start)} → end ${roundForDisplay(summary.end)}, ${settle}, overshoot ${roundForDisplay(summary.overshoot)}${pct}, range ${roundForDisplay(summary.min)}…${roundForDisplay(summary.max)}`;
}

/** A columnar trace with evenly sampled rows. */
export function traceTable(
  times: readonly number[],
  targets: readonly string[],
  values: Record<string, readonly unknown[]>,
  maxRows: number,
): { text: string; rows: number } {
  const indices = sampleIndices(times.length, maxRows);
  const rows = indices.map((i) => [
    roundForDisplay(times[i]!),
    ...targets.map((t) => formatValue(values[t]?.[i])),
  ]);
  return { text: table(["t_ms", ...targets], rows), rows: indices.length };
}

const TargetsSchema = z.array(z.string()).min(1);

export function registerSimulationTools(tc: ToolContext): void {
  const { host } = tc;

  tc.tool(
    "sim_reset",
    {
      title: "Reset simulation",
      description:
        "Start a deterministic simulation of the document (fixed timestep, seeded randomness), independent of the person's live viewer, and step frame 0. Returns a simId for the other sim_* tools. Pass simId to restart an existing session.",
      input: z.object({
        docId: DocIdSchema.optional(),
        simId: z.string().optional(),
        seed: z.number().int().optional().describe("Default 1."),
        fps: z
          .union([z.literal(60), z.literal(120)])
          .optional()
          .describe("Default: the document's fps (60)."),
      }),
      output: SimStateOutputSchema,
      annotations: SIMULATION,
    },
    async (args) => {
      const state = await host.sim.reset({
        ...(args.docId !== undefined ? { docId: args.docId } : {}),
        ...(args.simId !== undefined ? { simId: args.simId } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        ...(args.fps !== undefined ? { fps: args.fps } : {}),
      });
      return success(
        [
          `Simulation ready: ${header(state)} · ${state.fps} fps · seed ${state.seed}`,
          ...issuesText(state),
        ].join("\n"),
        { ...state },
      );
    },
  );

  tc.tool(
    "sim_dispatch",
    {
      title: "Dispatch input",
      description:
        'Send input to a simulation and step through it: tap, longPress, drag, hover, scroll, key, text, focus, submit, raw pointer, orientation, deviceMotion. Targets are "@layerId" (its center), "@card/badge" for a layer inside a component instance, or [x, y]. Each input resolves its target when it fires, and reports which layer it hit, which interaction patches heard it, and warnings when it hits nothing or the wrong layer. Follow with sim_step or sim_trace to watch the result.',
      input: z.object({ simId: z.string(), events: z.array(SimEventSchema).min(1).max(50) }),
      output: SimStateOutputSchema,
      annotations: SIMULATION,
    },
    async ({ simId, events }) => {
      const r = await host.sim.dispatch(simId, events as SimEvent[]);
      const lines = [
        `Dispatched ${events.length} event${events.length === 1 ? "" : "s"} over ${r.framesStepped} frame${r.framesStepped === 1 ? "" : "s"} · ${header(r)}`,
      ];
      for (const e of r.events) {
        const at = e.point ? ` at (${Math.round(e.point[0])}, ${Math.round(e.point[1])})` : "";
        const hit = e.hit
          ? e.hit.layerId
            ? ` → hit ${e.hit.instancePath ? `${e.hit.instancePath}/` : ""}${e.hit.layerId}${e.hit.chain.length > 1 ? ` (bubbles to ${e.hit.chain.slice(1).join(", ")})` : ""}${e.hit.handledBy.length ? ` · heard by ${e.hit.handledBy.join(", ")}` : ""}`
            : " → hit nothing"
          : "";
        lines.push(`${e.index}. ${e.kind}${at}${hit}`);
        for (const w of e.warnings) lines.push(`   warning: ${w}`);
      }
      lines.push(...issuesText(r));
      return success(lines.join("\n"), { ...r });
    },
  );

  tc.tool(
    "sim_step",
    {
      title: "Step simulation",
      description:
        'Advance a simulation by frames or ms, or until "idle" (nothing animating and watched values stable) or until a value condition holds ({ "target": "@card.scale", "op": ">=", "value": 1.07 }). Reports watched values that changed (default: every linked layer property).',
      input: z.object({
        simId: z.string(),
        frames: z.number().int().min(0).max(7200).optional(),
        ms: z.number().min(0).max(120000).optional(),
        until: z
          .union([
            z.literal("idle"),
            z.object({
              target: z.string(),
              op: z.enum([">", ">=", "<", "<=", "==", "!="]),
              value: z.union([z.number(), z.boolean(), z.string()]),
            }),
          ])
          .optional(),
        maxMs: z
          .number()
          .min(1)
          .max(120000)
          .optional()
          .describe("Give up waiting for until after this long (default 10000)."),
        watch: z
          .array(z.string())
          .max(30)
          .optional()
          .describe('Values to report changes for, e.g. ["@card.scale", "toggle.on"].'),
      }),
      output: SimStateOutputSchema,
      annotations: SIMULATION,
    },
    async ({ simId, ...options }) => {
      const r = await host.sim.step(simId, options as never);
      const status =
        options.until !== undefined
          ? r.settled
            ? options.until === "idle"
              ? "idle"
              : "condition met"
            : `timed out after ${r.framesStepped} frames`
          : r.settled
            ? "nothing animating"
            : "still animating";
      const lines = [
        `Stepped ${r.framesStepped} frame${r.framesStepped === 1 ? "" : "s"} · ${header(r)} · ${status}`,
      ];
      if (r.changed.length)
        for (const ch of r.changed)
          lines.push(`  ${ch.target}: ${formatValue(ch.from)} → ${formatValue(ch.to)}`);
      else lines.push("  No watched values changed.");
      lines.push(...issuesText(r));
      return success(lines.join("\n"), { ...r });
    },
  );

  tc.tool(
    "sim_trace",
    {
      title: "Trace simulation",
      description:
        "Sample values every frame for a duration, with optional scheduled events (same shapes as sim_dispatch, with atMs), and summarize each: start, end, settle time, overshoot, range. Rows are downsampled to maxRows; summaries use every frame; times count frames from the start of the trace. By default traces a copy so the session doesn't move; advance: true moves the session through the traced time.",
      input: z.object({
        simId: z.string(),
        targets: TargetsSchema.max(8).describe(
          'Addresses like "@card.scale" or "pop.output"; inside a component instance, "card/tap_badge.down" or "@card/badge.scale".',
        ),
        durationMs: z.number().min(1).max(60000),
        events: z.array(SimEventSchema).max(50).optional(),
        maxRows: z.number().int().min(2).max(600).optional().describe("Default 30."),
        advance: z.boolean().optional(),
      }),
      output: SimStateOutputSchema,
      annotations: SIMULATION,
    },
    async ({ simId, targets, durationMs, events, maxRows, advance }) => {
      const r = await host.sim.trace(simId, {
        targets,
        durationMs,
        ...(events ? { events: events as SimEvent[] } : {}),
        ...(advance ? { advance } : {}),
      });
      const t = traceTable(r.times, r.targets, r.values, maxRows ?? 30);
      const warnings = r.events.flatMap((e) =>
        e.warnings.map((w) => `Event ${e.index} (${e.kind}) warning: ${w}`),
      );
      const lines = [
        `Trace of ${durationMs} ms (${r.times.length} frames${t.rows < r.times.length ? `, showing ${t.rows} rows` : ""}) from ${header(r)}${advance ? "" : " (session not advanced)"}:`,
        ...warnings,
        t.text,
        "Summaries:",
        ...r.targets.map((target) => `  ${target}: ${summaryText(r.summaries[target] ?? null)}`),
        ...issuesText(r),
      ];
      const sampled = sampleIndices(r.times.length, maxRows ?? 30);
      return success(lines.join("\n"), {
        ...r,
        times: sampled.map((i) => r.times[i]!),
        values: Object.fromEntries(r.targets.map((k) => [k, sampled.map((i) => r.values[k]![i])])),
        frames: r.times.length,
      });
    },
  );

  tc.tool(
    "sim_get_values",
    {
      title: "Get simulation values",
      description:
        'Current values in a simulation: patch ports ("toggle.on", inputs too) and layer properties or outputs ("@card.scale", or "@row.position#2" for one loop copy). Reach inside component instances with an instance path: "like_button_2/liked.on", "@like_button_2/like_button.color", "card#2/..." for copy 2 of a looped instance.',
      input: z.object({ simId: z.string(), targets: TargetsSchema.max(30) }),
      output: SimStateOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ simId, targets }) => {
      const r = await host.sim.values(simId, targets);
      return success(
        [
          header(r),
          ...targets.map((t) => `  ${t} = ${formatValue(r.values[t])}`),
          ...issuesText(r),
        ].join("\n"),
        { ...r },
      );
    },
  );

  tc.tool(
    "get_screenshot",
    {
      title: "Get screenshot",
      description:
        'A PNG of the live viewer, the canvas, the patch graph, or one layer ("@layerId"), optionally at a simulation\'s current frame. For visual QA only; read structure and values with get_outline and sim_get_values. Needs the Sonobe app.',
      input: z.object({
        docId: DocIdSchema.optional(),
        target: z
          .string()
          .optional()
          .describe('"viewer" (default), "canvas", "graph", or "@layerId".'),
        simId: z.string().optional(),
        scale: z.number().min(0.25).max(3).optional(),
        maxWidth: z.number().int().min(64).max(1600).optional().describe("Default 800."),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, target, simId, scale, maxWidth }) => {
      if (!host.capabilities.screenshots) {
        try {
          await host.screenshot({ kind: "viewer" }, {});
        } catch (err) {
          const { failureFromThrown } = await import("../results.ts");
          return failureFromThrown(err);
        }
      }
      const raw = target ?? "viewer";
      let shot: ScreenshotTarget;
      if (raw === "viewer" || raw === "canvas" || raw === "graph") shot = { kind: raw };
      else if (/^@[A-Za-z_][A-Za-z0-9_]*$/.test(raw))
        shot = { kind: "layer", layerId: raw.slice(1) };
      else
        return failure({
          code: "invalid_target",
          message: `"${raw}" isn't a screenshot target.`,
          hint: 'Use "viewer", "canvas", "graph", or "@layerId".',
        });
      const image = await host.screenshot(shot, {
        ...(docId !== undefined ? { docId } : {}),
        ...(simId !== undefined ? { simId } : {}),
        ...(scale !== undefined ? { scale } : {}),
        maxWidth: maxWidth ?? 800,
      });
      // No structuredContent: clients that prefer it (Claude Code) would drop the image block.
      return {
        content: [
          { type: "image", data: image.data, mimeType: image.mimeType },
          {
            type: "text",
            text: `${raw} · ${image.width}×${image.height}${image.timeMs !== undefined ? ` · ${roundForDisplay(image.timeMs)} ms` : ""}`,
          },
        ],
      };
    },
  );
}
