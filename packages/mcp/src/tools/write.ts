/**
 * Write tools: apply_ops plus friendlier front doors that compile to ops (add_layers, add_patches,
 * connect, set_values, update_layers, delete_items, rename, create_component, tidy_graph). Every
 * write is one attributed history group and returns ids, the new revision and diagnostics deltas.
 */

import {
  allLayerIds,
  findLayer,
  isLinkInput,
  parseAddress,
  type Id,
  type NewLayer,
  type NewPatch,
  type Op,
  type OpResult,
  type SonobeDocument,
} from "@sonobe/core";
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { joinList, plural } from "../format.ts";
import { requireComponent } from "../graph.ts";
import { describeRemovals, hasDestructiveOps, removedItems, type RemovalSummary } from "../removals.ts";
import type { HostApplyResult } from "../host.ts";
import { failure, formatSonobeError, success } from "../results.ts";
import { ADDITIVE, DESTRUCTIVE, UI_ONLY, type ToolContext } from "../server.ts";
import { describeOps } from "../session.ts";
import {
  ComponentIdSchema,
  ConnectionSchema,
  DocIdSchema,
  ExpectedRevisionSchema,
  LabelSchema,
  NewLayerSchema,
  NewPatchSchema,
  OpSchema,
  WriteOutputSchema,
} from "../schemas.ts";
import { tidyOps } from "../tidy.ts";
import { formatDiagnostic } from "./read.ts";

const DELETE_CONFIRM_THRESHOLD = 10;

/** Created items from applied ops: "tap_card (interaction)". */
function createdItems(applied: readonly Op[]): string[] {
  const out: string[] = [];
  for (const op of applied) {
    if (op.op === "addPatch" && op.patch.id) out.push(`${op.patch.id} (${op.patch.type})`);
    if (op.op === "addLayer") {
      const visit = (l: NewLayer) => {
        if (l.id) out.push(`${l.id} (${l.type})`);
        for (const k of l.children ?? []) visit(k);
      };
      visit(op.layer);
    }
    if (op.op === "addComment" && op.comment.id) out.push(`${op.comment.id} (comment)`);
  }
  return out;
}

/** The standard write response: summary, ids, refs, diagnostics delta, or a teaching failure. */
export function writeResult(
  result: HostApplyResult,
  extra: { notes?: string[]; data?: Record<string, unknown>; summarizeCreated?: boolean } = {},
): CallToolResult {
  const failed = result.results.filter(
    (r): r is OpResult & { error: NonNullable<OpResult["error"]> } =>
      !r.ok && !!r.error && r.error.code !== "skipped",
  );
  const appliedCount = result.results.filter((r) => r.ok).length;
  const created = createdItems(result.applied);
  const delta = result.diagnostics;
  const deltaLines = (): string[] => {
    const lines = [
      `Diagnostics: ${delta.added.length} added, ${delta.resolved.length} resolved · now ${plural(delta.totals.errors, "error")}, ${plural(delta.totals.warnings, "warning")}, ${delta.totals.info} info`,
    ];
    for (const d of delta.added.filter((x) => x.severity !== "info").slice(0, 6))
      lines.push(...formatDiagnostic(d).map((l) => `  + ${l}`));
    const infos = delta.added.filter((x) => x.severity === "info");
    if (infos.length)
      lines.push(
        `  + info: ${infos
          .slice(0, 4)
          .map((d) => d.code + (d.itemIds.length ? ` (${d.itemIds.join(",")})` : ""))
          .join(", ")}${infos.length > 4 ? ", …" : ""}`,
      );
    for (const d of delta.resolved.slice(0, 6))
      lines.push(
        `  − resolved ${d.severity} ${d.code}${d.itemIds.length ? ` (${d.itemIds.join(",")})` : ""}`,
      );
    return lines;
  };
  const data = {
    ok: result.ok,
    changed: (result.dryRun || !result.txnId ? "none" : failed.length ? "partial" : "all") as
      "none" | "partial" | "all",
    docId: result.docId,
    revision: result.revision,
    dryRun: result.dryRun,
    ...(result.txnId ? { txnId: result.txnId } : {}),
    created: created.map((c) => c.split(" ")[0]!),
    idMap: result.idMap,
    affected: result.affected,
    diagnostics: delta,
    ...(result.saved ? { saved: true } : {}),
    ...(result.saveError ? { saved: false, saveError: result.saveError } : {}),
    ...(extra.data ?? {}),
  };
  if (
    result.conflict ||
    (!result.ok && !result.txnId && !result.dryRun) ||
    (result.dryRun && !result.ok)
  ) {
    const lines: string[] = [];
    if (result.conflict) lines.push(...formatSonobeError(result.errors[0]!));
    else {
      lines.push(
        result.dryRun
          ? `Dry run: the batch would fail at op ${failed[0]?.index ?? "?"}.`
          : `Nothing changed: op ${failed[0]?.index ?? "?"} of ${result.results.length} failed, so the whole batch was rolled back.`,
      );
      for (const f of failed) lines.push(...formatSonobeError(f.error));
      if (!failed.length) for (const e of result.errors) lines.push(...formatSonobeError(e));
    }
    lines.push(`Revision is still ${result.revision}.`);
    return {
      isError: true,
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        ...data,
        ok: false,
        changed: "none",
        errors: result.errors,
        results: result.results.filter((r) => !r.ok),
        ...(result.conflict ? { conflict: result.conflict } : {}),
      },
    };
  }
  const lines: string[] = [];
  if (result.dryRun)
    lines.push(
      `Dry run: ${plural(result.results.length, "op")} would apply cleanly. Nothing changed (revision ${result.revision}).`,
    );
  else if (failed.length)
    lines.push(
      `Applied ${appliedCount} of ${result.results.length} ops; ${failed.length} failed (non-atomic batch) · revision ${result.revision} · ${result.txnId}`,
    );
  else
    lines.push(
      `Applied ${plural(appliedCount, "op")} · revision ${result.revision} · ${result.txnId}`,
    );
  if (created.length && extra.summarizeCreated && created.length > 12)
    lines.push(`${result.dryRun ? "Would create" : "Created"} ${plural(created.length, "item")}.`);
  else if (created.length)
    lines.push(`${result.dryRun ? "Would create" : "Created"}: ${created.join(", ")}`);
  const refs = Object.entries(result.idMap).filter(([ref]) => !extra.summarizeCreated || !/_\d+$/.test(ref));
  if (refs.length)
    lines.push(
      `Refs: ${refs.map(([ref, id]) => `${ref.startsWith("$") ? ref : `$${ref}`} → ${id}`).join(", ")}`,
    );
  for (const f of failed) lines.push(...formatSonobeError(f.error));
  lines.push(...deltaLines());
  for (const note of extra.notes ?? []) lines.push(note);
  if (result.saved) lines.push("Saved to disk.");
  if (result.saveError) {
    lines.push(`Not saved to disk (${result.saveError.code}): ${result.saveError.message} The change is applied in this session only.`);
    if (result.saveError.hint) lines.push(`Hint: ${result.saveError.hint}`);
  }
  const out = success(lines.join("\n"), data);
  if (failed.length) out.isError = true;
  return out;
}

function labelFor(label: string | undefined, ops: readonly Op[]): string {
  return label?.trim() || describeOps(ops);
}

function withComponent(op: Op, component: string | undefined): Op {
  if (component === undefined || (op as { component?: string }).component !== undefined) return op;
  return { ...op, component } as Op;
}

export function registerWriteTools(tc: ToolContext): void {
  const { host } = tc;

  const apply = async (
    ctx: ServerContext,
    ops: Op[],
    args: {
      docId?: string | undefined;
      label?: string | undefined;
      expectedRevision?: number | undefined;
      atomic?: boolean | undefined;
      dryRun?: boolean | undefined;
      component?: string | undefined;
    },
  ) =>
    host.apply(ops, {
      label: labelFor(args.label, ops),
      author: tc.author(ctx),
      signal: tc.signal(ctx),
      ...(args.docId !== undefined ? { docId: args.docId } : {}),
      ...(args.expectedRevision !== undefined ? { expectedRevision: args.expectedRevision } : {}),
      ...(args.atomic !== undefined ? { atomic: args.atomic } : {}),
      ...(args.dryRun !== undefined ? { dryRun: args.dryRun } : {}),
      ...(args.component !== undefined ? { defaultComponent: args.component } : {}),
    });

  /**
   * apply, plus what the batch removes (or would remove, on a dry run) when it has destructive ops.
   * Counted from the documents before and after, so a removeLayer counts its whole subtree.
   */
  const applyCounted = async (ctx: ServerContext, ops: Op[], args: Parameters<typeof apply>[2]) => {
    if (!hasDestructiveOps(ops)) return writeResult(await apply(ctx, ops, args));
    const before = await host.getDocument(args.docId);
    const result = await apply(ctx, ops, args);
    let after: SonobeDocument | undefined;
    if (result.dryRun) after = result.preview;
    else if (result.revision !== before.revision) after = (await host.getDocument(args.docId)).doc;
    if (!after || result.conflict) return writeResult(result);
    const removed: RemovalSummary = removedItems(before.doc, after);
    const text = describeRemovals(removed);
    return writeResult(result, {
      data: { removed },
      ...(text ? { notes: [`${result.dryRun ? "Would remove" : "Removed"}: ${text}.`] } : {}),
    });
  };

  tc.tool(
    "apply_ops",
    {
      title: "Apply ops",
      description:
        'Apply a batch of document ops through Sonobe\'s op engine: in order (later ops see earlier effects), atomic by default (any failure rolls back everything), validated with teaching errors and ready-to-apply fixes. "$ref" ids resolve anywhere in the batch: items are created first, then the values and connections that name items created later. dryRun previews diagnostics without changing anything. The other write tools compile to these ops.',
      input: z.object({
        docId: DocIdSchema.optional(),
        ops: z.array(OpSchema).min(1).max(500),
        label: LabelSchema.optional(),
        atomic: z
          .boolean()
          .optional()
          .describe("Default true. false applies the ops that succeed and reports the rest."),
        dryRun: z.boolean().optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
        component: ComponentIdSchema.optional().describe(
          "Default component for ops that don't name one.",
        ),
      }),
      output: WriteOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async (args, ctx) => applyCounted(ctx, args.ops as unknown as Op[], args),
  );

  tc.tool(
    "add_layers",
    {
      title: "Add layers",
      description:
        'Add layers (with nested children) to a component, back to front. Give layers names people understand ("Card", "Like Button"); ids derive from names. Returns the new ids.',
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        parent: z.string().optional().describe("Container layer id (default: the component root)."),
        index: z
          .number()
          .int()
          .optional()
          .describe(
            "Insert position among siblings (default: front). Negative counts from the front.",
          ),
        layers: z.array(NewLayerSchema).min(1).max(100),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: ADDITIVE,
    },
    async (args, ctx) => {
      const ops: Op[] = args.layers.map((layer, i) =>
        withComponent(
          {
            op: "addLayer" as const,
            layer: layer as unknown as NewLayer,
            ...(args.parent !== undefined ? { parent: args.parent } : {}),
            ...(args.index !== undefined
              ? { index: args.index < 0 ? args.index : args.index + i }
              : {}),
          },
          args.component,
        ),
      );
      return writeResult(await apply(ctx, ops, args));
    },
  );

  tc.tool(
    "add_patches",
    {
      title: "Add patches",
      description:
        'Add patches and wire them in one atomic batch. Give each a "ref" and a name describing its effect; inputs take literals or { "link": "$ref.port" | "patchId.port" | "@layerId.prop" } and { "layer": "layerId" }, and may name patches later in the list (loops too). connections run after every patch exists, e.g. { "from": "$grow.output", "to": "@card.scale" }. Patches without ui are placed below the existing graph.',
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        patches: z.array(NewPatchSchema).min(1).max(100),
        connections: z.array(ConnectionSchema).max(200).optional(),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: ADDITIVE,
    },
    async (args, ctx) => {
      const snap = await host.getDocument(args.docId);
      const c = requireComponent(snap.doc, args.component);
      const existing = Object.values(c.patches);
      const baseY = existing.length ? Math.max(...existing.map((p) => p.ui.y)) + 160 : 40;
      const baseX = existing.length ? Math.min(...existing.map((p) => p.ui.x)) : 40;
      // Place by dependency depth inside the batch so sources sit left of consumers.
      const refs = new Map(
        args.patches.map((p, i) => [p.ref?.replace(/^\$/, "") ?? p.id ?? `#${i}`, i]),
      );
      const depth = new Map<number, number>();
      const depthOf = (i: number, trail: Set<number> = new Set()): number => {
        if (depth.has(i)) return depth.get(i)!;
        if (trail.has(i)) return 0;
        trail.add(i);
        let d = 0;
        const sources = [
          ...Object.values(args.patches[i]!.inputs ?? {})
            .filter(isLinkInput)
            .map((v) => v.link),
          ...(args.connections ?? [])
            .filter((cn) => {
              const to = parseAddress(cn.to);
              const key = to?.kind === "patch" ? to.id.replace(/^\$/, "") : undefined;
              return key !== undefined && refs.get(key) === i;
            })
            .map((cn) => cn.from),
        ];
        for (const link of sources) {
          const a = parseAddress(link);
          const j = a?.kind === "patch" ? refs.get(a.id.replace(/^\$/, "")) : undefined;
          if (j !== undefined && j !== i) d = Math.max(d, depthOf(j, trail) + 1);
        }
        trail.delete(i);
        depth.set(i, d);
        return d;
      };
      const rows = new Map<number, number>();
      const ops: Op[] = args.patches.map((p, i) => {
        const patch = { ...p } as unknown as NewPatch;
        if (!patch.ui) {
          const d = depthOf(i);
          const row = rows.get(d) ?? 0;
          rows.set(d, row + 1);
          patch.ui = { x: baseX + d * 220, y: baseY + row * 120 };
        }
        return withComponent({ op: "addPatch" as const, patch }, args.component);
      });
      for (const cn of args.connections ?? [])
        ops.push(
          withComponent({ op: "connect" as const, from: cn.from, to: cn.to }, args.component),
        );
      return writeResult(await apply(ctx, ops, args));
    },
  );

  tc.tool(
    "connect",
    {
      title: "Connect",
      description:
        'Connect outputs to inputs or layer properties: { "from": "pop.output", "to": "grow.progress" }, { "from": "grow.output", "to": "@card.scale" }. Type mismatches fail with a converter suggestion. Inputs that already have a different connection are refused unless replaceExisting is true.',
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        connections: z.array(ConnectionSchema).min(1).max(200),
        replaceExisting: z
          .boolean()
          .optional()
          .describe("Allow replacing an input's existing connection (default false)."),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: ADDITIVE,
    },
    async (args, ctx) => {
      if (!args.replaceExisting) {
        const snap = await host.getDocument(args.docId);
        const c = requireComponent(snap.doc, args.component);
        for (const cn of args.connections) {
          const to = parseAddress(cn.to);
          let current: unknown;
          if (to?.kind === "patch") current = c.patches[to.id]?.inputs[to.key];
          else if (to?.kind === "layer") current = findLayer(c.layers, to.id)?.layer.props[to.key];
          else if (to?.kind === "componentOutput")
            current =
              c.interface.outputs[to.key]?.link !== undefined
                ? { link: c.interface.outputs[to.key]!.link }
                : undefined;
          if (isLinkInput(current) && current.link !== cn.from) {
            return failure({
              code: "already_connected",
              message: `${cn.to} is already connected to ${current.link}. An input takes one connection, so connecting ${cn.from} would replace it.`,
              hint: "If replacing is what you want, call connect again with replaceExisting: true. To combine both sources, put a patch in between (Or for pulses, Add for numbers, Option Picker to choose).",
              address: cn.to,
              suggestions: [
                {
                  description: `Replace ${current.link} with ${cn.from}`,
                  ops: [{ op: "connect", component: c.id, from: cn.from, to: cn.to }],
                },
              ],
            });
          }
        }
      }
      const ops: Op[] = args.connections.map((cn) =>
        withComponent({ op: "connect" as const, from: cn.from, to: cn.to }, args.component),
      );
      return writeResult(await apply(ctx, ops, args));
    },
  );

  tc.tool(
    "set_values",
    {
      title: "Set values",
      description:
        'Set literal values on patch inputs or layer properties: [{ "target": "pop.bounciness", "value": 8 }, { "target": "@card.color", "value": "#FFD60AFF" }]. null resets to the default. Targets driven by a connection are skipped (and reported) unless replaceConnections is true.',
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        updates: z
          .array(
            z.object({
              target: z.string().describe('"patchId.port" or "@layerId.prop".'),
              value: z.unknown().describe("Literal, wrapper value, or null to reset."),
            }),
          )
          .min(1)
          .max(200),
        replaceConnections: z
          .boolean()
          .optional()
          .describe("Overwrite inputs that are currently connected (default false)."),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async (args, ctx) => {
      const snap = await host.getDocument(args.docId);
      const c = requireComponent(snap.doc, args.component);
      const ignored: { target: string; reason: string }[] = [];
      const ops: Op[] = [];
      for (const u of args.updates) {
        const a = parseAddress(u.target);
        const current =
          a?.kind === "patch"
            ? c.patches[a.id]?.inputs[a.key]
            : a?.kind === "layer"
              ? findLayer(c.layers, a.id)?.layer.props[a.key]
              : undefined;
        if (!args.replaceConnections && isLinkInput(current) && !isLinkInput(u.value)) {
          ignored.push({
            target: u.target,
            reason: `driven by ${current.link}; pass replaceConnections: true to overwrite it`,
          });
          continue;
        }
        ops.push(
          withComponent(
            { op: "setInput" as const, target: u.target, value: u.value as never },
            args.component,
          ),
        );
      }
      const notes = ignored.map((i) => `Skipped ${i.target}: ${i.reason}.`);
      if (!ops.length)
        return failure({
          code: "all_ignored",
          message: `Every target is driven by a connection, so nothing was set. ${notes.join(" ")}`,
          hint: "Change the source patch instead, or pass replaceConnections: true.",
        });
      return writeResult(await apply(ctx, ops, args), { notes, data: { ignored } });
    },
  );

  tc.tool(
    "update_layers",
    {
      title: "Update layers",
      description:
        'Change properties, names or editor flags on layers: [{ "ids": ["card", "card_2"], "props": { "cornerRadius": 24 } }, { "ids": ["title"], "name": "Headline" }]. null in props resets a property.',
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        updates: z
          .array(
            z.object({
              ids: z.array(z.string()).min(1).max(100),
              props: z.record(z.string(), z.unknown()).optional(),
              name: z.string().optional(),
              locked: z.boolean().optional(),
              collapsed: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(100),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async (args, ctx) => {
      const ops: Op[] = args.updates.flatMap((u) =>
        u.ids.map((id) =>
          withComponent(
            {
              op: "updateLayer" as const,
              id,
              ...(u.props ? { props: u.props as never } : {}),
              ...(u.name !== undefined ? { name: u.name } : {}),
              ...(u.locked !== undefined ? { locked: u.locked } : {}),
              ...(u.collapsed !== undefined ? { collapsed: u.collapsed } : {}),
            },
            args.component,
          ),
        ),
      );
      return writeResult(await apply(ctx, ops, args));
    },
  );

  tc.tool(
    "delete_items",
    {
      title: "Delete items",
      description: `Delete layers (with their children), patches and comments, plus every connection to them. Undoable. Deleting more than ${DELETE_CONFIRM_THRESHOLD} items first returns a summary and a confirmToken; ask the person, then call again with the token. dryRun reports what would be removed without changing anything or asking.`,
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        ids: z.array(z.string()).min(1).max(500),
        confirmToken: z.string().optional(),
        dryRun: z.boolean().optional(),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async (args, ctx) => {
      const snap = await host.getDocument(args.docId);
      const c = requireComponent(snap.doc, args.component);
      const ops: Op[] = [];
      const names: string[] = [];
      let count = 0;
      const unique = [...new Set(args.ids)];
      const covered = new Set<Id>();
      for (const id of unique) {
        const loc = findLayer(c.layers, id);
        if (loc) {
          if (loc.path.slice(0, -1).some((a) => unique.includes(a))) continue;
          const subtree = allLayerIds([loc.layer]);
          subtree.forEach((x) => covered.add(x));
          count += subtree.length;
          names.push(
            `${loc.layer.name}${subtree.length > 1 ? ` (+${subtree.length - 1} children)` : ""}`,
          );
          ops.push({ op: "removeLayer", component: c.id, id });
        } else if (c.patches[id]) {
          count++;
          names.push(c.patches[id].name ?? id);
          ops.push({ op: "removePatch", component: c.id, id });
        } else if (c.comments.some((x) => x.id === id)) {
          count++;
          names.push(`comment ${id}`);
          ops.push({ op: "removeComment", component: c.id, id });
        } else {
          ops.push({ op: "removePatch", component: c.id, id });
        }
      }
      if (count > DELETE_CONFIRM_THRESHOLD && args.dryRun !== true) {
        const token = confirmToken(snap.docId, snap.revision, unique);
        if (args.confirmToken !== token) {
          const summary = `Deleting ${plural(count, "item")} from ${c.id}: ${joinList(names.slice(0, 12))}${names.length > 12 ? `, and ${names.length - 12} more` : ""}.`;
          return success(
            `${args.confirmToken ? "That confirmToken doesn't match this deletion (the document or the ids changed). " : ""}Confirmation required. Nothing changed yet.\n${summary}\nAsk the person to confirm, then call delete_items again with the same ids and confirmToken "${token}".`,
            {
              ok: false,
              changed: "none",
              status: "confirmation_required",
              docId: snap.docId,
              revision: snap.revision,
              summary,
              confirmToken: token,
            },
          );
        }
      }
      return applyCounted(ctx, ops, {
        ...args,
        label:
          args.label ??
          `deleted ${joinList(names.slice(0, 3))}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`,
      });
    },
  );

  tc.tool(
    "rename",
    {
      title: "Rename",
      description:
        'Change display names of layers, patches or components (ids never change). Name patches by their effect ("Card Pressed", "Sheet Spring").',
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        updates: z
          .array(z.object({ id: z.string(), name: z.string() }))
          .min(1)
          .max(200),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      const ops: Op[] = args.updates.map((u) =>
        withComponent({ op: "rename" as const, id: u.id, name: u.name }, args.component),
      );
      return writeResult(await apply(ctx, ops, args));
    },
  );

  tc.tool(
    "create_component",
    {
      title: "Create component",
      description:
        "Move layers and/or patches into a new reusable component and leave an instance wired the same way. Connections crossing the boundary become published inputs and outputs. Layers make a layer component (instance layer); patches alone make a patch component (instance patch).",
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional().describe(
          "Where the items live now (default root).",
        ),
        name: z.string().min(1),
        layerIds: z.array(z.string()).max(200).optional(),
        patchIds: z.array(z.string()).max(200).optional(),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: ADDITIVE,
    },
    async (args, ctx) => {
      const op = withComponent(
        {
          op: "createComponent" as const,
          name: args.name,
          ref: "component",
          ...(args.layerIds ? { layerIds: args.layerIds } : {}),
          ...(args.patchIds ? { patchIds: args.patchIds } : {}),
        },
        args.component,
      );
      const result = await apply(ctx, [op], {
        ...args,
        label: args.label ?? `created component ${args.name}`,
      });
      const id = result.idMap.component ?? result.idMap.$component;
      const notes = id
        ? [`New component id: ${id}. Read it with get_outline({ "component": "${id}" }).`]
        : [];
      return writeResult(result, { notes, data: id ? { componentId: id } : {} });
    },
  );

  tc.tool(
    "tidy_graph",
    {
      title: "Tidy graph",
      description:
        "Arrange patches into tidy columns by dataflow (sources left, consumers right; separate flows stacked). Changes editor positions only.",
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        ids: z
          .array(z.string())
          .max(500)
          .optional()
          .describe("Only arrange these patches (default: all)."),
        direction: z.enum(["LR", "TB"]).optional().describe("Default LR."),
        label: LabelSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: UI_ONLY,
    },
    async (args, ctx) => {
      const snap = await host.getDocument(args.docId);
      const c = requireComponent(snap.doc, args.component);
      const ops = tidyOps(c, {
        ...(args.ids ? { ids: args.ids } : {}),
        direction: args.direction ?? "LR",
      });
      if (!ops.length)
        return success(`The graph is already tidy (revision ${snap.revision}).`, {
          ok: true,
          changed: "none",
          docId: snap.docId,
          revision: snap.revision,
        });
      return writeResult(await apply(ctx, ops, { ...args, label: args.label ?? "tidied graph" }));
    },
  );
}

/** A short deterministic token binding a deletion to its ids and revision. */
export function confirmToken(docId: string, revision: number, ids: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of `${docId}|${revision}|${[...ids].sort().join(",")}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `del_${h.toString(16).padStart(8, "0")}`;
}
