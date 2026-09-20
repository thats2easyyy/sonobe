/**
 * applyOps: the only way documents change (ARCHITECTURE §3.5). Ops apply in order, each seeing
 * earlier effects; batches are atomic by default; results carry ids, the refs → ids map, inverse
 * ops and affected ids.
 *
 * "$ref" ids resolve in any order within a batch. Items are created first: an addPatch or addLayer
 * whose input values name items a later op creates is applied without those values, and the
 * values follow as setInput ops once every item exists. Any other op that names a later item runs
 * after that item's op. Cycles between patches in one batch therefore just work.
 */

import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { Id, Op, OpKind, OpResult, SonobeDocument, SonobeError } from "../types.ts";
import { makeError } from "../validate.ts";
import { isLayerInput, isLinkInput } from "../values.ts";
import { addComment, removeComment, updateComment } from "./comments.ts";
import { addComponent, removeComponent, updateComponent, updateInterface } from "./components.ts";
import { appliedOps, createContext, fail, newAffected, newRenamed, OpFailure, PendingRef, type ApplyOpsOptions, type ApplyOpsResult, type OpContext, type OpOutcome, type RenamedIds } from "./context.ts";
import { createComponent } from "./createComponent.ts";
import { checkOpFields } from "./fields.ts";
import { setNodePositions } from "./graphNodes.ts";
import { connect, disconnect, rename, setInput } from "./inputs.ts";
import { addLayer, moveLayer, removeLayer, updateLayer } from "./layers.ts";
import { addPatch, removePatch, updatePatch } from "./patches.ts";
import { addAsset, removeAsset, setProject, setScript } from "./project.ts";

type Handler = (ctx: OpContext, op: never) => OpOutcome;

const HANDLERS = {
  addLayer,
  updateLayer,
  moveLayer,
  removeLayer,
  addPatch,
  updatePatch,
  removePatch,
  setInput,
  connect,
  disconnect,
  rename,
  addComment,
  updateComment,
  removeComment,
  addComponent,
  removeComponent,
  createComponent,
  updateInterface,
  updateComponent,
  setNodePositions,
  setScript,
  addAsset,
  removeAsset,
  setProject,
} satisfies Record<OpKind, Handler>;

/** Every op kind applyOps understands. */
export const OP_KINDS = Object.keys(HANDLERS) as OpKind[];

const sorted = (s: Set<Id>) => [...s].sort();

/** OpResult.retired and OpResult.suffixed, when the op gave a derived id a suffix. */
function renamedFields(renamed: RenamedIds): Pick<OpResult, "retired" | "suffixed"> {
  return {
    ...(Object.keys(renamed.retired).length ? { retired: { ...renamed.retired } } : {}),
    ...(Object.keys(renamed.suffixed).length ? { suffixed: { ...renamed.suffixed } } : {}),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Refs the batch defines: name (without "$") → index of the first op that defines it. */
function collectBatchRefs(ops: readonly unknown[]): Map<string, number> {
  const refs = new Map<string, number>();
  const add = (ref: unknown, index: number) => {
    if (typeof ref !== "string") return;
    const name = ref.startsWith("$") ? ref.slice(1) : ref;
    if (name && !refs.has(name)) refs.set(name, index);
  };
  const visitLayer = (layer: unknown, index: number) => {
    if (!isObject(layer)) return;
    add(layer.ref, index);
    if (Array.isArray(layer.children)) for (const child of layer.children) visitLayer(child, index);
  };
  ops.forEach((op, index) => {
    if (!isObject(op)) return;
    switch (op.op) {
      case "addLayer":
        visitLayer(op.layer, index);
        break;
      case "addPatch":
        if (isObject(op.patch)) add(op.patch.ref, index);
        break;
      case "addComment":
        if (isObject(op.comment)) add(op.comment.ref, index);
        break;
      case "addComponent":
      case "createComponent":
        add(op.ref, index);
        break;
    }
  });
  return refs;
}

/** The batch ref an input value links from or points at ("$tap.tap", "@$card.scale", { layer: "$card" }). */
function inputRef(value: unknown): string | undefined {
  const raw = isLinkInput(value) ? value.link : isLayerInput(value) ? value.layer : undefined;
  if (typeof raw !== "string") return undefined;
  const m = /^@?\$([A-Za-z_][A-Za-z0-9_]*)(?:\.|$)/.exec(raw);
  return m && m[1] !== "in" && m[1] !== "out" ? m[1] : undefined;
}

/** An input value an item-creating op holds back until the item it names exists. */
interface WaitingInput {
  /** The created item, by position in the op's ids (0 for a patch; pre-order for nested layers). */
  item: number;
  kind: "patch" | "layer";
  key: string;
  value: unknown;
}

/**
 * A copy of an addPatch/addLayer op without the input values that name items another op creates
 * but hasn't run yet, plus those values. Refs the op defines itself (sibling layers) stay put.
 */
function splitWaitingInputs(ctx: OpContext, op: unknown, index: number): { op: unknown; waiting: WaitingInput[] } {
  const waiting: WaitingInput[] = [];
  if (!isObject(op)) return { op, waiting };
  const waits = (value: unknown) => {
    const name = inputRef(value);
    return name !== undefined && !ctx.refs.has(name) && ctx.batchRefs.has(name) && ctx.batchRefs.get(name) !== index;
  };
  const strip = (values: unknown, item: number, kind: WaitingInput["kind"]): unknown => {
    if (!isObject(values)) return values;
    let out: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(values)) {
      if (!waits(value)) continue;
      out ??= { ...values };
      delete out[key];
      waiting.push({ item, kind, key, value });
    }
    return out ?? values;
  };
  if (op.op === "addPatch" && isObject(op.patch)) {
    const inputs = strip(op.patch.inputs, 0, "patch");
    return inputs === op.patch.inputs ? { op, waiting } : { op: { ...op, patch: { ...op.patch, inputs } }, waiting };
  }
  if (op.op === "addLayer" && isObject(op.layer)) {
    let next = 0;
    const visit = (layer: unknown): unknown => {
      if (!isObject(layer)) return layer;
      const item = next++;
      const props = strip(layer.props, item, "layer");
      const kids = Array.isArray(layer.children) ? layer.children.map(visit) : layer.children;
      const kidsChanged = Array.isArray(kids) && kids.some((k, i) => k !== (layer.children as unknown[])[i]);
      return props === layer.props && !kidsChanged ? layer : { ...layer, props, children: kids };
    };
    const layer = visit(op.layer);
    return layer === op.layer ? { op, waiting } : { op: { ...op, layer }, waiting };
  }
  return { op, waiting };
}

interface Task {
  /** Index of the op in the batch (errors and results report it). */
  index: number;
  op: unknown;
  /** A held-back input value of an item-creating op that already ran. */
  followUp?: boolean;
}

/**
 * Apply a batch of ops. With `atomic` (default) any failure returns the input document
 * unchanged; otherwise failing ops are skipped. `dryRun` validates and computes results
 * without changing the document (see `preview`).
 */
export function applyOps(doc: SonobeDocument, ops: readonly Op[], options: ApplyOpsOptions): ApplyOpsResult {
  if (!options?.registry) throw new TypeError("applyOps needs options.registry (see createRegistry).");
  const atomic = options.atomic !== false;
  const ctx = createContext(doc, options);
  const results: (OpResult | undefined)[] = [];
  const errors: SonobeError[] = [];
  const inverses: Op[][] = [];
  const applied: Op[] = [];
  const idMap: Record<string, Id> = {};
  const affected = newAffected();
  const failed = new Set<number>();
  let failedAt: number | undefined;

  const list: readonly unknown[] = Array.isArray(ops) ? ops : [];
  if (!Array.isArray(ops)) errors.push(makeError("invalid_op", "applyOps expects a list of ops.", { hint: 'Send ops like [{ "op": "addLayer", "layer": { "type": "rectangle" } }].' }));
  for (const [name, index] of collectBatchRefs(list)) ctx.batchRefs.set(name, index);

  const recordFailure = (index: number, error: SonobeError) => {
    results[index] = { index, ok: false, error };
    errors.push(error);
    failed.add(index);
    failedAt ??= index;
  };

  const attempt = (task: Task): { outcome: OpOutcome } | { pending: PendingRef } | { error: SonobeError } => {
    const before = ctx.doc;
    ctx.pendingRefs = new Map();
    ctx.renamed = newRenamed();
    ctx.affected = newAffected();
    const kind = isObject(task.op) ? task.op.op : undefined;
    try {
      const handler = typeof kind === "string" && Object.hasOwn(HANDLERS, kind) ? (HANDLERS as Record<string, Handler>)[kind] : undefined;
      if (!handler) fail("unknown_op", `There's no op "${String(kind)}".${didYouMeanText(didYouMean(String(kind), OP_KINDS))}`, { hint: `Ops: ${OP_KINDS.join(", ")}.` });
      if (!ctx.lenient && !task.followUp) checkOpFields(task.op as Record<string, unknown>, kind as OpKind);
      const outcome = (handler as (ctx: OpContext, op: Op) => OpOutcome)(ctx, task.op as Op);
      for (const [name, ref] of ctx.pendingRefs) {
        ctx.refs.set(name, ref.id);
        idMap[ref.given] = ref.id;
      }
      for (const key of ["components", "layers", "patches"] as const) for (const id of ctx.affected[key]) affected[key].add(id);
      inverses.push(outcome.inverse);
      applied.push(...appliedOps(outcome));
      return { outcome };
    } catch (err) {
      ctx.doc = before;
      if (err instanceof PendingRef) return { pending: err };
      const error: SonobeError =
        err instanceof OpFailure
          ? { ...err.error, opIndex: task.index }
          : makeError("internal", `Op ${task.index} (${String(kind)}) failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`, {
              opIndex: task.index,
              hint: "This is a bug in Sonobe. Please report it along with the ops you sent.",
            });
      return { error };
    }
  };

  const refError = (index: number, ref: string, why: string, hint: string) =>
    makeError("unknown_ref", `"$${ref}" ${why}`, { opIndex: index, hint });

  let queue: Task[] = list.map((op, index) => ({ index, op }));
  while (queue.length && !(atomic && failedAt !== undefined)) {
    const next: Task[] = [];
    const blocked = new Map<Task, string>();
    let progressed = false;
    for (const task of queue) {
      if (atomic && failedAt !== undefined) break;
      const split = task.followUp ? { op: task.op, waiting: [] } : splitWaitingInputs(ctx, task.op, task.index);
      const r = attempt({ ...task, op: split.op });
      if ("pending" in r) {
        const definer = ctx.batchRefs.get(r.pending.ref)!;
        if (failed.has(definer)) {
          recordFailure(task.index, refError(task.index, r.pending.ref, `names the item op ${definer} creates, but op ${definer} failed.`, `Fix op ${definer} first.`));
          progressed = true;
          continue;
        }
        blocked.set(task, r.pending.ref);
        next.push(task);
        continue;
      }
      progressed = true;
      if ("error" in r) {
        recordFailure(task.index, r.error);
        continue;
      }
      if (!task.followUp) results[task.index] = { index: task.index, ok: true, ids: r.outcome.ids, ...renamedFields(ctx.renamed) };
      if (!split.waiting.length) continue;
      const component = (appliedOps(r.outcome)[0] as { component?: Id } | undefined)?.component;
      for (const w of split.waiting) {
        const id = r.outcome.ids[w.item];
        if (id === undefined) continue;
        const target = w.kind === "patch" ? `${id}.${w.key}` : `@${id}.${w.key}`;
        next.push({ index: task.index, op: { op: "setInput", ...(component !== undefined ? { component } : {}), target, value: w.value }, followUp: true });
      }
    }
    if (!progressed) {
      // Everything left waits for items that only waiting ops create.
      for (const task of next) {
        const ref = blocked.get(task)!;
        const definer = ctx.batchRefs.get(ref)!;
        recordFailure(
          task.index,
          definer === task.index
            ? refError(task.index, ref, "names the item this op creates, so the op can't use it.", 'Set that value in another op, e.g. { "op": "setInput", "target": "$ref.port", "value": … }.')
            : refError(task.index, ref, `names the item op ${definer} creates, but op ${definer} waits for something op ${task.index} creates, so neither can run.`, "Create the parent or container in its own op, then refer to it."),
        );
        if (atomic) break;
      }
      break;
    }
    queue = next;
  }
  for (let index = 0; index < list.length; index++) {
    if (!results[index]) results[index] = { index, ok: false, error: makeError("skipped", `Not applied because op ${failedAt} failed.`, { opIndex: index }) };
  }

  const ok = errors.length === 0;
  const done = results as OpResult[];
  if (atomic && !ok) {
    return { ok, doc, results: done, errors, idMap: {}, inverse: [], affected: { components: [], layers: [], patches: [] }, applied: [] };
  }
  const result: ApplyOpsResult = {
    ok,
    doc: options.dryRun ? doc : ctx.doc,
    results: done,
    errors,
    idMap,
    inverse: inverses.reverse().flat(),
    affected: { components: sorted(affected.components), layers: sorted(affected.layers), patches: sorted(affected.patches) },
    applied,
  };
  if (options.dryRun) result.preview = ctx.doc;
  return result;
}
