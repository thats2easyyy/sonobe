/**
 * Write tools: apply_ops plus friendlier front doors that compile to ops (add_layers, add_patches,
 * connect, set_values, update_layers, delete_items, rename, create_component, tidy_graph). Every
 * write is one attributed history group and returns ids, the new revision and diagnostics deltas.
 */

import {
  allLayerIds,
  applyOps,
  didYouMean,
  didYouMeanText,
  findLayer,
  isLinkInput,
  layersWithGraphNodes,
  parseAddress,
  type CommentNode,
  type Component,
  type Id,
  type NewLayer,
  type NewPatch,
  type Op,
  type OpResult,
  type PatchNode,
  type SonobeDocument,
} from "@sonobe/core";
import {
  deriveGraph,
  documentObstacles,
  estimatePatchSize,
  findFreePosition,
  planTidy,
  portCenterY,
  rectsOverlap,
  tidyPlanOps,
  type TidyNode,
  type TidyPlan,
  type TidyRequest,
} from "@sonobe/core/graph";
import type { EngineRegistry } from "@sonobe/engine";
import type { CallToolResult, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { joinList, plural } from "../format.ts";
import { requireComponent } from "../graph.ts";
import {
  describeRemovals,
  disconnectedLinks,
  hasCascadingOps,
  hasDestructiveOps,
  removedItems,
  unpublishedPorts,
  type CutCable,
  type RemovalSummary,
  type UnpublishedPorts,
} from "../removals.ts";
import { HostError, type HostApplyResult } from "../host.ts";
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
import { elkGroupLayout, estimateGraphGeometry } from "../geometry.ts";
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

/** Display names of the items applied ops create, by id. */
function createdNames(applied: readonly Op[]): Map<Id, string> {
  const names = new Map<Id, string>();
  const add = (id: Id | undefined, name: string | undefined) => {
    if (id && name && !names.has(id)) names.set(id, name);
  };
  for (const op of applied) {
    if (op.op === "addPatch") add(op.patch.id, op.patch.name);
    if (op.op === "addLayer") {
      const visit = (l: NewLayer) => {
        add(l.id, l.name);
        for (const k of l.children ?? []) visit(k);
      };
      visit(op.layer);
    }
    if (op.op === "addComponent") add(op.component.id, op.component.name);
  }
  return names;
}

/** "a, b, c (+4)" */
const capped = (items: readonly string[], max = 6) =>
  `${items.slice(0, max).join(", ")}${items.length > max ? ` (+${items.length - max})` : ""}`;

/**
 * Lines about derived ids that got a suffix: past an id retired this session, or past an id another
 * item of the same batch took. On their own lines so they're seen even when "Created:" is skipped.
 */
function renamedLines(result: HostApplyResult, extra: { summarizeCreated?: boolean }): { lines: string[]; data: Record<string, unknown> } {
  const retired: Record<Id, Id> = {};
  const suffixed: Record<Id, Id> = {};
  for (const r of result.results) {
    if (!r.ok) continue;
    Object.assign(retired, r.retired);
    // An import names hundreds of layers alike; its suffixes aren't worth a line.
    if (!extra.summarizeCreated) Object.assign(suffixed, r.suffixed);
  }
  const lines: string[] = [];
  const data: Record<string, unknown> = {};
  const retiredPairs = Object.entries(retired);
  if (retiredPairs.length) {
    data.retiredIds = retired;
    lines.push(
      `Retired ids skipped: ${capped(retiredPairs.map(([id, old]) => `${old} → ${id}`))}. Those ids belonged to items removed earlier this session; to rebuild items under their old ids, undo the removal and send it with the new items in one batch.`,
    );
  }
  const suffixedPairs = Object.entries(suffixed);
  if (suffixedPairs.length) {
    data.suffixedIds = suffixed;
    const names = createdNames(result.applied);
    const named = (id: Id) => (names.has(id) ? `${id} ("${names.get(id)}")` : id);
    lines.push(
      `Suffixed ids: ${capped(suffixedPairs.map(([id, base]) => `${named(id)} because ${named(base)} took ${base} earlier in this batch`), 4)}. Give items names that differ in letters or digits, or explicit ids, to address them without a suffix.`,
    );
  }
  return { lines, data };
}

/** "Unpublished from Swipe Card: inputs swipedLeft, swipedRight; output wentLeft." */
function unpublishedNote(doc: SonobeDocument, entry: UnpublishedPorts, dryRun: boolean): string {
  const sides = [
    entry.inputs.length ? `${entry.inputs.length === 1 ? "input" : "inputs"} ${entry.inputs.join(", ")}` : "",
    entry.outputs.length ? `${entry.outputs.length === 1 ? "output" : "outputs"} ${entry.outputs.join(", ")}` : "",
  ].filter(Boolean);
  return `${dryRun ? "Would unpublish" : "Unpublished"} from ${doc.components[entry.component]?.name ?? entry.component}: ${sides.join("; ")}.`;
}

/** "Disconnected 3 cables in main: a.b → c.d, …", one line per component. */
function disconnectedNotes(cut: readonly CutCable[], dryRun: boolean): string[] {
  const byComponent = new Map<Id, CutCable[]>();
  for (const c of cut) byComponent.set(c.component, [...(byComponent.get(c.component) ?? []), c]);
  return [...byComponent].map(
    ([component, cables]) =>
      `${dryRun ? "Would disconnect" : "Disconnected"} ${plural(cables.length, "cable")} in ${component}: ${capped(cables.map((c) => `${c.from} → ${c.to}`))}.`,
  );
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
  const renamed = renamedLines(result, extra);
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
    ...renamed.data,
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
  lines.push(...renamed.lines);
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

const COLUMN_GAP = 72;
const ROW_GAP = 28;

/** A new patch as the document would hold it, for size estimates. */
function patchNodeOf(p: NewPatch): PatchNode {
  const node: PatchNode = { type: p.type, inputs: p.inputs ?? {}, ui: { x: 0, y: 0 } };
  if (p.name) node.name = p.name;
  if (p.typeParam) node.typeParam = p.typeParam as PatchNode["typeParam"];
  if (p.inputCount !== undefined) node.inputCount = p.inputCount;
  if (p.component) node.component = p.component;
  if (p.settings) node.settings = p.settings;
  return node;
}

/**
 * How big each new patch will draw, live values included: the batch applied to a scratch copy of the
 * document (at a provisional spot) and measured there. Undefined when the batch doesn't apply.
 */
function previewSizes(
  doc: SonobeDocument,
  registry: EngineRegistry,
  componentId: Id,
  ops: readonly Op[],
): Map<number, { width: number; height: number }> | undefined {
  const preview = applyOps(doc, ops, { registry, defaultComponent: componentId });
  if (!preview.ok) return undefined;
  const boxes = estimateGraphGeometry(preview.doc, registry, componentId).nodes;
  const sizes = new Map<number, { width: number; height: number }>();
  let index = 0;
  preview.results.forEach((r, opIndex) => {
    if (ops[opIndex]?.op !== "addPatch") return;
    const box = r.ids?.[0] ? boxes.get(r.ids[0]) : undefined;
    if (box) sizes.set(index, { width: box.width, height: box.height });
    index++;
  });
  return sizes;
}

/**
 * Positions for the batch's patches that have none: a column per dependency depth, as wide as its
 * widest patch draws in the editor, and the whole block in free space below the graph, clear of
 * patches, layer nodes and comment frames.
 */
function placeNewPatches(
  doc: SonobeDocument,
  registry: EngineRegistry,
  componentId: Id,
  patches: readonly NewPatch[],
  depthOf: (index: number) => number,
  drawn?: Map<number, { width: number; height: number }>,
): Map<number, { x: number; y: number }> {
  const out = new Map<number, { x: number; y: number }>();
  const component = doc.components[componentId];
  const pending = patches.map((p, i) => ({ p, i })).filter(({ p }) => !p.ui);
  if (!component || !pending.length) return out;
  const size = (p: NewPatch, i: number) =>
    drawn?.get(i) ?? estimatePatchSize(doc, registry, patchNodeOf(p), { component: componentId });
  const columns = new Map<number, { i: number; width: number; height: number }[]>();
  for (const { p, i } of pending)
    columns.set(depthOf(i), [...(columns.get(depthOf(i)) ?? []), { i, ...size(p, i) }]);
  const relative = new Map<number, { x: number; y: number }>();
  let x = 0;
  let height = 0;
  for (const depth of [...columns.keys()].sort((a, b) => a - b)) {
    let y = 0;
    for (const entry of columns.get(depth)!) {
      relative.set(entry.i, { x, y });
      y += entry.height + ROW_GAP;
    }
    height = Math.max(height, y - ROW_GAP);
    x += Math.max(...columns.get(depth)!.map((e) => e.width)) + COLUMN_GAP;
  }
  const obstacles = documentObstacles(doc, component, registry);
  const nodes = [
    ...obstacles.nodes,
    ...patches.flatMap((p, i) => (p.ui ? [{ ...p.ui, ...size(p, i) }] : [])),
  ];
  const all = [...nodes, ...(obstacles.comments ?? [])];
  const preferred = all.length
    ? { x: Math.min(...all.map((r) => r.x)), y: Math.max(...all.map((r) => r.y + r.height)) + 40 }
    : { x: 40, y: 40 };
  const at = findFreePosition({ width: x - COLUMN_GAP, height }, preferred, {
    nodes,
    comments: obstacles.comments ?? [],
  });
  for (const [i, r] of relative) out.set(i, { x: at.x + r.x, y: at.y + r.y });
  return out;
}

/** Positions saved for layers that have no graph node yet: they apply once a cable drives or reads the layer. */
function waitingNodeNotes(applied: readonly Op[], doc: SonobeDocument): string[] {
  const waiting: string[] = [];
  for (const op of applied) {
    if (op.op !== "setNodePositions") continue;
    const component = doc.components[op.component ?? doc.project.root];
    if (!component) continue;
    const shown = layersWithGraphNodes(component);
    for (const [key, value] of Object.entries(op.positions)) {
      const layerId = key.startsWith("@") ? key.slice(1) : undefined;
      if (value && layerId && !shown.has(layerId)) waiting.push(key);
    }
  }
  return waiting.length
    ? [
        `Saved positions for ${capped(waiting)}; they apply once a cable drives or reads those layers, which gives them a node in the graph.`,
      ]
    : [];
}

/** A comment for messages: its id and the first line of its text. */
function commentName(c: CommentNode): string {
  const text = c.text.split("\n")[0]!.trim();
  return `${c.id} (${JSON.stringify(text.length > 40 ? `${text.slice(0, 39)}…` : text)})`;
}

/** What tidy_graph lays out: every node with its estimated box and port rows, the cables, and the frames. */
function tidyRequest(
  doc: SonobeDocument,
  registry: EngineRegistry,
  c: Component,
  args: {
    ids?: string[] | undefined;
    frames?: string[] | undefined;
    frameMode?: "keep" | "arrange" | undefined;
    direction?: "LR" | "TB" | undefined;
  },
): TidyRequest {
  if (args.ids?.length && args.frames?.length)
    throw new HostError("invalid_arguments", "Pass ids or frames, not both.", {
      hint: "frames tidies everything inside those comment frames; ids tidies just those nodes, each within its own frame.",
    });
  if (args.frameMode === "arrange" && (args.ids?.length || args.frames?.length))
    throw new HostError(
      "invalid_arguments",
      'frameMode "arrange" lays out the whole graph, frames included.',
      {
        hint: "Leave out ids and frames to arrange everything, or leave out frameMode to tidy just those.",
      },
    );
  for (const id of args.frames ?? [])
    if (!c.comments.some((m) => m.id === id))
      throw new HostError(
        "unknown_frame",
        `There's no comment "${id}" in ${c.id}.${didYouMeanText(
          didYouMean(
            id,
            c.comments.map((m) => m.id),
          ),
        )}`,
        {
          hint: c.comments.length
            ? `Comments here: ${c.comments.map(commentName).join(", ")}.`
            : `${c.id} has no comments. Frame a section with addComment { "comment": { "text": "Places", "rect": [x, y, width, height] } }.`,
        },
      );
  const geometry = estimateGraphGeometry(doc, registry, c.id);
  const model = deriveGraph({ doc, componentId: c.id, registry });
  const nodes: TidyNode[] = [];
  for (const node of model.nodes) {
    const box = geometry.nodes.get(node.id);
    if (node.data.kind === "comment" || !box) continue;
    const data = node.data;
    const shape = { collapsed: data.kind === "patch" && data.collapsed };
    const ports = [
      ...data.inputs.map((p, i) => ({
        id: p.handleId,
        side: "in" as const,
        y: portCenterY(shape, i),
      })),
      ...data.outputs.map((p, i) => ({
        id: p.handleId,
        side: "out" as const,
        y: portCenterY(shape, i),
      })),
    ];
    nodes.push({ id: node.id, ...box, ports });
  }
  for (const id of args.ids ?? [])
    if (!nodes.some((n) => n.id === id))
      throw new HostError(
        "unknown_node",
        `"${id}" isn't a node in the graph of ${c.id}.${didYouMeanText(
          didYouMean(
            id,
            nodes.map((n) => n.id),
          ),
        )}`,
        {
          hint: 'Nodes are patch ids, "@layerId" for a layer that a cable drives or reads, and "$in" / "$out" for the component\'s published inputs and outputs.',
        },
      );
  return {
    nodes,
    edges: model.edges.map((e) => ({
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
    })),
    frames: [...geometry.frames].map(([id, r]) => ({ id, ...r })),
    scope: args.frames?.length
      ? { kind: "frames", ids: args.frames }
      : args.ids?.length
        ? { kind: "nodes", ids: args.ids }
        : { kind: "all" },
    ...(args.frameMode ? { frameMode: args.frameMode } : {}),
    ...(args.direction ? { direction: args.direction } : {}),
  };
}

/** Node pairs whose boxes overlap: "a × b". */
function overlappingPairs(nodes: readonly TidyNode[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (rectsOverlap(nodes[i]!, nodes[j]!)) out.push(`${nodes[i]!.id} × ${nodes[j]!.id}`);
  return out;
}

/** "Frames: places ("PLACES") grew to 798×188." and "Pushed apart: chips (…) right 458 pt, clear of places (…)." */
function describeTidy(c: Component, plan: TidyPlan): string[] {
  const name = (id: string) => {
    const comment = c.comments.find((m) => m.id === id);
    return comment ? commentName(comment) : id === "nodes" ? "the unframed nodes" : id;
  };
  const lines: string[] = [];
  const frames: string[] = [];
  for (const [id, r] of plan.frames) {
    const before = c.comments.find((m) => m.id === id)?.rect;
    if (!before) continue;
    if (r.width !== before[2] || r.height !== before[3])
      frames.push(
        `${name(id)} ${r.width * r.height >= before[2] * before[3] ? "grew" : "shrank"} to ${r.width}×${r.height}`,
      );
    else frames.push(`${name(id)} moved to ${r.x},${r.y}`);
  }
  if (frames.length) lines.push(`Frames: ${frames.join("; ")}.`);
  const pushes = plan.pushed.map(
    (p) => `${name(p.id)} ${p.dx ? `right ${p.dx}` : `down ${p.dy}`} pt, clear of ${name(p.by)}`,
  );
  if (pushes.length) lines.push(`Pushed apart: ${pushes.join("; ")}.`);
  return lines;
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
   * apply, plus what the batch removes, unpublishes and disconnects (or would, on a dry run) when it
   * has ops that cascade. Counted from the documents before and after, so a removeLayer counts its
   * whole subtree and an unpublished port lists the cables it cut on every instance.
   */
  const applyCounted = async (ctx: ServerContext, ops: Op[], args: Parameters<typeof apply>[2]) => {
    const positions = ops.some((op) => op.op === "setNodePositions");
    if (!hasCascadingOps(ops) && !positions) return writeResult(await apply(ctx, ops, args));
    const before = await host.getDocument(args.docId);
    const result = await apply(ctx, ops, args);
    let after: SonobeDocument | undefined;
    if (result.dryRun) after = result.preview;
    else if (result.revision !== before.revision) after = (await host.getDocument(args.docId)).doc;
    if (!after || result.conflict) return writeResult(result);
    const notes: string[] = [];
    const data: Record<string, unknown> = {};
    if (hasDestructiveOps(ops)) {
      const removed: RemovalSummary = removedItems(before.doc, after);
      data.removed = removed;
      const text = describeRemovals(removed);
      if (text) notes.push(`${result.dryRun ? "Would remove" : "Removed"}: ${text}.`);
    }
    const unpublished = unpublishedPorts(before.doc, after);
    if (unpublished.length) {
      data.unpublished = unpublished;
      for (const entry of unpublished) notes.push(unpublishedNote(before.doc, entry, !!result.dryRun));
    }
    const cut = disconnectedLinks(before.doc, after);
    if (cut.length) {
      data.disconnected = { count: cut.length, cables: cut.slice(0, 50) };
      notes.push(...disconnectedNotes(cut, !!result.dryRun));
    }
    if ((unpublished.length || cut.length) && !result.dryRun) notes.push("The undo tool brings them back.");
    if (positions) notes.push(...waitingNodeNotes(result.applied, after));
    return writeResult(result, { data, notes });
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
        'Add patches and wire them in one atomic batch. Give each a "ref" and a name describing its effect; inputs take literals or { "link": "$ref.port" | "patchId.port" | "@layerId.prop" } and { "layer": "layerId" }, and may name patches later in the list (loops too). connections run after every patch exists, e.g. { "from": "$grow.output", "to": "@card.scale" }. Patches without ui go in free space below the graph, in columns as wide as the editor draws them, clear of comment frames.',
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
      const patches = args.patches as unknown as NewPatch[];
      const ops: Op[] = patches.map((p) =>
        withComponent(
          { op: "addPatch" as const, patch: { ...p, ui: p.ui ?? { x: 0, y: 0 } } },
          args.component,
        ),
      );
      for (const cn of args.connections ?? [])
        ops.push(
          withComponent({ op: "connect" as const, from: cn.from, to: cn.to }, args.component),
        );
      // Sizes as the batch will draw (live values too), then the real spots.
      const placed = placeNewPatches(
        snap.doc,
        host.registry,
        c.id,
        patches,
        depthOf,
        previewSizes(snap.doc, host.registry, c.id, ops),
      );
      patches.forEach((p, i) => {
        if (!p.ui) (ops[i] as Extract<Op, { op: "addPatch" }>).patch.ui = placed.get(i)!;
      });
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
        "Move layers and/or patches into a new reusable component and leave an instance wired the same way. Connections crossing the boundary become published inputs and outputs. Layers make a layer component (instance layer); patches alone make a patch component (instance patch). Change the ports later with apply_ops updateInterface (replace: true sets a whole side).",
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
        "Lay the graph out in left-to-right columns by dataflow, as the editor's Tidy Up does. Comment frames are sections: each frame's nodes are laid out inside it, the frame is refit around them, and frames that would overlap are pushed apart, so sections keep their place. frames: tidy only inside those comments. ids: only those nodes, each kept in its own frame. frameMode \"arrange\" also lays out the frames as blocks (whole graph only). Layer and interface nodes move too. Changes editor positions only; dryRun previews. Sizes are estimated as the editor draws nodes.",
      input: z.object({
        docId: DocIdSchema.optional(),
        component: ComponentIdSchema.optional(),
        ids: z
          .array(z.string())
          .max(500)
          .optional()
          .describe('Only these nodes: patch ids, "@layerId", "$in", "$out" (default: all).'),
        frames: z
          .array(z.string())
          .max(100)
          .optional()
          .describe("Only inside these comment frames (comment ids, as get_outline lists them)."),
        frameMode: z
          .enum(["keep", "arrange"])
          .optional()
          .describe(
            "keep (default): frames stay put, refit and pushed apart. arrange: frames move as blocks too.",
          ),
        direction: z.enum(["LR", "TB"]).optional().describe("Default LR."),
        dryRun: z.boolean().optional().describe("Report what would move, and change nothing."),
        label: LabelSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: UI_ONLY,
    },
    async (args, ctx) => {
      const snap = await host.getDocument(args.docId);
      const c = requireComponent(snap.doc, args.component);
      const request = tidyRequest(snap.doc, host.registry, c, args);
      const plan = await planTidy(request, await elkGroupLayout());
      const ops = tidyPlanOps(c, plan);
      if (!ops.length)
        return success(`The graph is already tidy (revision ${snap.revision}).`, {
          ok: true,
          changed: "none",
          docId: snap.docId,
          revision: snap.revision,
        });
      const overlaps = overlappingPairs(request.nodes);
      const notes = [
        ...(overlaps.length ? [`Overlapping before: ${capped(overlaps)}.`] : []),
        ...describeTidy(c, plan),
        "Node sizes are estimated as the editor draws them (with live values after a second).",
      ];
      return writeResult(await apply(ctx, ops, { ...args, label: args.label ?? "tidied graph" }), {
        notes,
        data: {
          moved: [...plan.nodes.keys()],
          frames: Object.fromEntries(plan.frames),
          pushed: plan.pushed,
        },
      });
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
