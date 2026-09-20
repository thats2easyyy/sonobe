/** Simulation tools: sim_reset, sim_dispatch, sim_step, sim_trace, sim_get_values, sim_override, get_screenshot. */

import type { Op } from "@sonobe/core";
import type { TraceSummary } from "@sonobe/engine";
import { z } from "zod";
import { formatValue, plural, roundForDisplay, sampleIndices, table } from "../format.ts";
import type { ScreenshotTarget, SimEvent, SimOverrideSet, SimState } from "../host.ts";
import { failure, formatSuggestions, success } from "../results.ts";
import { READ_ONLY, SIMULATION, type ToolContext } from "../server.ts";
import {
  ComponentIdSchema,
  DocIdSchema,
  OpSchema,
  SimEventSchema,
  SimStateOutputSchema,
} from "../schemas.ts";

function issuesText(state: SimState): string[] {
  const lines: string[] = [];
  if (state.documentUpdated)
    lines.push(
      "Note: the document changed since the last call; the simulation picked up the edits (laid out without advancing time) and kept compatible state. Use sim_reset for a clean start.",
    );
  for (const issue of state.issues.slice(0, 5))
    lines.push(
      `Runtime ${issue.severity}${issue.patchId ? ` in ${issue.patchId}` : issue.layerId ? ` on @${issue.layerId}` : ""}: ${issue.message}${issue.hint ? ` ${issue.hint}` : ""}`,
      ...formatSuggestions(issue.suggestions, "  "),
    );
  if (state.issues.length > 5) lines.push(`… ${state.issues.length - 5} more runtime issues.`);
  for (const d of state.droppedOverrides ?? [])
    lines.push(
      `Note: dropped the override on ${d.target}; the person's latest edit doesn't accept it (${d.reason})`,
    );
  return lines;
}

/**
 * One sim_get_values target. A short clause ("overridden in this simulation, was 1") reads inline
 * after the value; an explanation in sentences (why it's null or an empty loop) gets its own line.
 */
function valueLines(target: string, value: unknown, note: string | undefined): string[] {
  const line = `  ${target} = ${formatValue(value)}`;
  if (!note) return [line];
  return /[.!?]$/.test(note) ? [line, `    ${note}`] : [`${line} (${note})`];
}

const header = (s: SimState) =>
  `${s.simId} · frame ${s.frame} · ${roundForDisplay(s.timeMs)} ms${s.knobs?.preset ? ` · preset ${s.knobs.preset.name}` : ""}${s.knobs?.values ? ` · ${plural(Object.keys(s.knobs.values).length, "knob value")}` : ""}${s.overrides?.length ? ` · ${plural(s.overrides.length, "override")}` : ""}`;

/** "Shipped app with commit_distance = 110": what a session's knob override runs. */
const knobsText = (k: NonNullable<SimState["knobs"]>) =>
  [
    k.preset ? k.preset.name : "",
    k.values
      ? Object.entries(k.values)
          .map(([id, v]) => `$knob.${id} = ${formatValue(v)}`)
          .join(", ")
      : "",
  ]
    .filter(Boolean)
    .join(" with ");

const SIM_ONLY = "simulation only: the person's document, viewer and history are unchanged";

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

/** Largest image a get_screenshot result carries (base64 characters). */
const MAX_IMAGE_BASE64 = 4_000_000;

export function registerSimulationTools(tc: ToolContext): void {
  const { host } = tc;

  tc.tool(
    "sim_reset",
    {
      title: "Reset simulation",
      description:
        "Start a deterministic simulation of the document (fixed timestep, seeded randomness), independent of the person's live viewer, and step frame 0. Returns a simId for the other sim_* tools. preset and knobs run other knob values in this simulation only (the person's document and viewer keep theirs); two sessions under two presets compare them. Pass simId to restart an existing session; that clears its sim_override overrides and knob values unless keepOverrides is true.",
      input: z.object({
        docId: DocIdSchema.optional(),
        simId: z.string().optional(),
        seed: z.number().int().optional().describe("Default 1."),
        fps: z
          .union([z.literal(60), z.literal(120)])
          .optional()
          .describe("Default: the document's fps (60)."),
        keepOverrides: z
          .boolean()
          .optional()
          .describe(
            "With simId: keep the session's sim_override overrides and knob values (default false).",
          ),
        preset: z.string().optional().describe("Knob preset id or name to run in this simulation."),
        knobs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Knob id or name → value to run in this simulation, e.g. { "commit_distance": 110 }.',
          ),
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
        ...(args.keepOverrides ? { keepOverrides: true } : {}),
        ...(args.preset !== undefined ? { preset: args.preset } : {}),
        ...(args.knobs !== undefined ? { knobs: args.knobs } : {}),
      });
      const cleared = state.clearedOverrides ?? [];
      return success(
        [
          `Simulation ready: ${header(state)} · ${state.fps} fps · seed ${state.seed}`,
          ...(state.knobs ? [`Runs ${knobsText(state.knobs)} (${SIM_ONLY}).`] : []),
          ...(state.clearedKnobs
            ? [
                `Stopped running ${knobsText(state.clearedKnobs)}; pass keepOverrides: true to keep it.`,
              ]
            : []),
          ...(state.overrides?.length
            ? [
                `Kept overrides (${SIM_ONLY}):`,
                ...state.overrides.map((o) => `  ${o.id} ${o.summary}`),
              ]
            : []),
          ...(cleared.length
            ? [
                `Cleared ${plural(cleared.length, "override")} (${cleared.map((o) => o.target).join(", ")}); pass keepOverrides: true to keep them.`,
              ]
            : []),
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
        'Send input to a simulation and step through it: tap, longPress, drag, hover, scroll, key, text, focus, submit, raw pointer, orientation, deviceMotion. Targets are "@layerId" (its center), "@card/badge" for a layer inside a component instance, or [x, y]. Each input resolves its target when it fires, and reports which layer it hit (with the loop copy, such as card#0), which interaction patches heard it, and warnings when it hits nothing or the wrong layer. Follow with sim_step or sim_trace to watch the result.',
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
            ? ` → hit ${e.hit.instancePath ? `${e.hit.instancePath}/` : ""}${e.hit.key ?? e.hit.layerId}${e.hit.chain.length > 1 ? ` (bubbles to ${e.hit.chain.slice(1).join(", ")})` : ""}${e.hit.handledBy.length ? ` · heard by ${e.hit.handledBy.join(", ")}` : ""}`
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
        "Sample values every frame for a duration, with optional scheduled events (same shapes as sim_dispatch, with atMs), and summarize each: start, end, settle time, overshoot, range. Rows are downsampled to maxRows; summaries use every frame; times count frames from the start of the trace. By default traces a copy so the session doesn't move; advance: true moves the session through the traced time, and on until its scheduled events finish (so a drag longer than the trace still releases).",
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
        ...(r.framesAfterTrace
          ? [
              `The events ran past the trace, so the session stepped ${plural(r.framesAfterTrace, "more frame")} to finish them (no pointer is left down).`,
            ]
          : []),
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
        'Current values in a simulation: patch ports ("toggle.on", inputs too), layer properties or outputs ("@card.scale", or "@row.position#2" for one loop copy), and knobs ("$knob.commit_distance"). Reach inside component instances with an instance path: "like_button_2/liked.on", "@like_button_2/like_button.color", "card#2/..." for copy 2 of a looped instance. A value sim_override changed says so, and a value that reads as null or an empty loop comes with a note saying why: the layer drew 0 copies (and where its empty loop started), "#n" is past the end, or the instance path runs into a component with 0 copies.',
      input: z.object({ simId: z.string(), targets: TargetsSchema.max(30) }),
      output: SimStateOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ simId, targets }) => {
      const r = await host.sim.values(simId, targets);
      return success(
        [
          header(r),
          ...targets.flatMap((t) => valueLines(t, r.values[t], r.notes?.[t])),
          ...issuesText(r),
        ].join("\n"),
        { ...r },
      );
    },
  );

  tc.tool(
    "sim_override",
    {
      title: "Override in simulation",
      description:
        'Change values inside one simulation only, to look under a layer or try a value without editing: the person\'s document, live viewer, undo history and files stay unchanged. set pins literals on patch inputs or layer properties ([{ "target": "@card_1.opacity", "value": 0 }], null for the default); ops takes value-level ops (setInput, connect, disconnect, updateLayer { props }, updatePatch { muted }, and setKnobValue or applyKnobPreset to tune knobs, locked presets too). A later override of the same target replaces the earlier one. Overrides change the layer or patch itself, so they apply to every loop copy and component instance ("#n" is refused), and "@card/badge.opacity" changes every instance of card\'s component. They stay on through the person\'s edits until clear or sim_reset (unless keepOverrides), and keep the simulation\'s state unless restart is true. With only simId, lists them. Use this instead of editing and undoing.',
      input: z.object({
        simId: z.string(),
        set: z
          .array(
            z.object({
              target: z
                .string()
                .describe(
                  '"patchId.port" or "@layerId.prop"; "@instance/layer.prop" reaches into a component.',
                ),
              value: z.unknown().describe("A literal or wrapper value, or null for the default."),
              component: ComponentIdSchema.optional(),
            }),
          )
          .max(50)
          .optional(),
        ops: z
          .array(OpSchema)
          .max(50)
          .optional()
          .describe(
            "Value-level ops: setInput, connect, disconnect, updateLayer { id, props }, updatePatch { id, muted }, setKnobValue { id, value, preset? }, applyKnobPreset { id }.",
          ),
        clear: z
          .union([z.string(), z.array(z.string()).max(50)])
          .optional()
          .describe(
            'Override ids ("ov_2") or targets to drop, or "all". Applied before set and ops.',
          ),
        restart: z
          .boolean()
          .optional()
          .describe(
            "Start the simulation over from frame 0 with the overrides (default: keep its state).",
          ),
      }),
      output: SimStateOutputSchema,
      annotations: SIMULATION,
    },
    async ({ simId, set, ops, clear, restart }) => {
      const r = await host.sim.override(simId, {
        ...(set ? { set: set as SimOverrideSet[] } : {}),
        ...(ops ? { ops: ops as Op[] } : {}),
        ...(clear !== undefined ? { clear: clear === "all" ? "all" : [clear].flat() } : {}),
        ...(restart ? { restart } : {}),
      });
      const lines = [`${header(r)}${r.restarted ? " · restarted from frame 0" : ""}`];
      if (r.overrides.length) {
        lines.push(`Overrides (${SIM_ONLY}):`);
        for (const o of r.overrides) lines.push(`  ${o.id} ${o.summary}`);
      } else lines.push("No overrides: the simulation runs the person's document as it is.");
      if (r.cleared.length)
        lines.push(`Cleared: ${r.cleared.map((o) => `${o.id} ${o.target}`).join(", ")}`);
      lines.push(...issuesText(r));
      return success(lines.join("\n"), { ...r });
    },
  );

  tc.tool(
    "get_screenshot",
    {
      title: "Get screenshot",
      description:
        'A PNG of the prototype screen ("viewer"), one layer ("@layerId", "@row#2" for a loop copy), or in the app the canvas or patch graph. Pass simId to draw a simulation\'s current frame (with its sim_override overrides), plus atMs for the frame that many ms later (drawn on a copy, so the session doesn\'t move). A layer target crops the whole screen to the layer\'s box, so layers in front still cover it; isolate: true draws only that layer and its children (to see the card under the top card, isolate "@card_2" or "@card#2"). Headless servers draw the screen themselves with approximate text metrics and placeholders for video, Lottie and shaders; without simId they show the prototype once start-up animations settle (or atMs after it starts). For visual QA; read structure and values with get_outline and sim_get_values.',
      input: z.object({
        docId: DocIdSchema.optional(),
        target: z
          .string()
          .optional()
          .describe('"viewer" (default), "@layerId", or in the app "canvas" or "graph".'),
        simId: z.string().optional(),
        atMs: z
          .number()
          .min(0)
          .max(60000)
          .optional()
          .describe(
            "Milliseconds after the simulation's current frame. Without simId: milliseconds after the prototype starts (default: once start-up animations settle).",
          ),
        isolate: z
          .boolean()
          .optional()
          .describe(
            'With an "@layerId" target: draw only that layer and its children where they are, without the layers in front of or behind it.',
          ),
        scale: z.number().min(0.25).max(3).optional(),
        maxWidth: z.number().int().min(64).max(1600).optional().describe("Default 800."),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, target, simId, atMs, isolate, scale, maxWidth }) => {
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
      else if (/^@[A-Za-z_][A-Za-z0-9_]*(#\d+)?(\/[A-Za-z_][A-Za-z0-9_]*(#\d+)?)*$/.test(raw))
        shot = { kind: "layer", layerId: raw.slice(1) };
      else
        return failure({
          code: "invalid_target",
          message: `"${raw}" isn't a screenshot target.`,
          hint: 'Use "viewer", "@layerId" (or "@row#2" for one loop copy), or in the app "canvas" or "graph".',
        });
      if (isolate && shot.kind !== "layer")
        return failure({
          code: "invalid_target",
          message: `isolate draws one layer on its own, so it needs an "@layerId" target, not "${raw}".`,
          hint: 'For example { "target": "@card_2", "isolate": true }, or "@card#2" for one loop copy.',
        });
      const image = await host.screenshot(shot, {
        ...(docId !== undefined ? { docId } : {}),
        ...(simId !== undefined ? { simId } : {}),
        ...(atMs !== undefined ? { atMs } : {}),
        ...(isolate ? { isolate } : {}),
        ...(scale !== undefined ? { scale } : {}),
        maxWidth: maxWidth ?? 800,
      });
      if (image.data.length > MAX_IMAGE_BASE64)
        return failure({
          code: "image_too_large",
          message: `The screenshot is ${Math.round(image.data.length / 1024)} KB encoded, over the ${Math.round(MAX_IMAGE_BASE64 / 1024)} KB limit.`,
          hint: "Pass a smaller maxWidth or scale, or capture one layer.",
        });
      const lines = [
        `${raw}${isolate ? " (isolated)" : ""} · ${image.width}×${image.height}${image.timeMs !== undefined ? ` · ${roundForDisplay(image.timeMs)} ms` : ""}${simId !== undefined ? ` · ${simId}${atMs ? ` + ${roundForDisplay(atMs)} ms (session not advanced)` : ""}` : host.kind === "headless" ? (atMs !== undefined ? ` · ${roundForDisplay(atMs)} ms after the prototype starts` : " · after start-up animations settle") : ""}`,
        ...(image.notes ?? []).map((n) => `Note: ${n}`),
      ];
      // Say when the picture differs from the person's document because of sim_override, or could.
      const overridden = host.sim.list().filter((s) => s.overrides?.length);
      const drawn = simId !== undefined ? overridden.find((s) => s.simId === simId) : undefined;
      const knobbed =
        simId !== undefined ? host.sim.list().find((s) => s.simId === simId)?.knobs : undefined;
      if (knobbed) lines.push(`Note: ${simId} runs ${knobsText(knobbed)}, not the person's knobs.`);
      if (drawn)
        lines.push(
          `Note: ${simId} has ${plural(drawn.overrides!.length, "override")} the person's document doesn't: ${drawn.overrides!.map((o) => o.summary).join("; ")}.`,
        );
      else if (simId === undefined && overridden.length) {
        const shown = docId ?? (await host.getDocument()).docId;
        const others = overridden.filter((s) => s.docId === shown).map((s) => s.simId);
        if (others.length)
          lines.push(
            `Note: this shows the person's document, without the overrides in ${others.join(", ")}; pass simId: "${others[0]}" to see them.`,
          );
      }
      // No structuredContent: clients that prefer it (Claude Code) would drop the image block.
      return {
        content: [
          { type: "image", data: image.data, mimeType: image.mimeType },
          { type: "text", text: lines.join("\n") },
        ],
      };
    },
  );
}
