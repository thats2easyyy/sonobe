/**
 * applyOps: the only way documents change (ARCHITECTURE §3.5). Ops apply sequentially,
 * each seeing earlier effects; batches are atomic by default; results carry ids, the
 * refs → ids map, inverse ops and affected ids.
 */

import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { Id, Op, OpKind, OpResult, SonobeDocument, SonobeError } from "../types.ts";
import { makeError } from "../validate.ts";
import { addComment, removeComment, updateComment } from "./comments.ts";
import { addComponent, removeComponent, updateComponent, updateInterface } from "./components.ts";
import { createContext, fail, newAffected, OpFailure, type ApplyOpsOptions, type ApplyOpsResult, type OpContext, type OpOutcome } from "./context.ts";
import { createComponent } from "./createComponent.ts";
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
  setScript,
  addAsset,
  removeAsset,
  setProject,
} satisfies Record<OpKind, Handler>;

/** Every op kind applyOps understands. */
export const OP_KINDS = Object.keys(HANDLERS) as OpKind[];

const sorted = (s: Set<Id>) => [...s].sort();

/**
 * Apply a batch of ops. With `atomic` (default) any failure returns the input document
 * unchanged; otherwise failing ops are skipped. `dryRun` validates and computes results
 * without changing the document (see `preview`).
 */
export function applyOps(doc: SonobeDocument, ops: readonly Op[], options: ApplyOpsOptions): ApplyOpsResult {
  if (!options?.registry) throw new TypeError("applyOps needs options.registry (see createRegistry).");
  const atomic = options.atomic !== false;
  const ctx = createContext(doc, options);
  const results: OpResult[] = [];
  const errors: SonobeError[] = [];
  const inverses: Op[][] = [];
  const applied: Op[] = [];
  const idMap: Record<string, Id> = {};
  const affected = newAffected();
  let failedAt: number | undefined;

  const list: readonly unknown[] = Array.isArray(ops) ? ops : [];
  if (!Array.isArray(ops)) errors.push(makeError("invalid_op", "applyOps expects a list of ops.", { hint: 'Send ops like [{ "op": "addLayer", "layer": { "type": "rectangle" } }].' }));

  for (let index = 0; index < list.length; index++) {
    const op = list[index];
    if (atomic && failedAt !== undefined) {
      results.push({ index, ok: false, error: makeError("skipped", `Not applied because op ${failedAt} failed.`, { opIndex: index }) });
      continue;
    }
    const before = ctx.doc;
    ctx.pendingRefs = new Map();
    ctx.affected = newAffected();
    const kind = op && typeof op === "object" ? (op as { op?: unknown }).op : undefined;
    try {
      const handler = typeof kind === "string" && Object.hasOwn(HANDLERS, kind) ? (HANDLERS as Record<string, Handler>)[kind] : undefined;
      if (!handler) fail("unknown_op", `There's no op "${String(kind)}".${didYouMeanText(didYouMean(String(kind), OP_KINDS))}`, { hint: `Ops: ${OP_KINDS.join(", ")}.` });
      const outcome = (handler as (ctx: OpContext, op: Op) => OpOutcome)(ctx, op as Op);
      for (const [name, ref] of ctx.pendingRefs) {
        ctx.refs.set(name, ref.id);
        idMap[ref.given] = ref.id;
      }
      for (const key of ["components", "layers", "patches"] as const) for (const id of ctx.affected[key]) affected[key].add(id);
      inverses.push(outcome.inverse);
      applied.push(outcome.applied);
      results.push({ index, ok: true, ids: outcome.ids });
    } catch (err) {
      ctx.doc = before;
      const error: SonobeError =
        err instanceof OpFailure
          ? { ...err.error, opIndex: index }
          : makeError("internal", `Op ${index} (${String(kind)}) failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`, {
              opIndex: index,
              hint: "This is a bug in Sonobe. Please report it along with the ops you sent.",
            });
      results.push({ index, ok: false, error });
      errors.push(error);
      failedAt ??= index;
    }
  }

  const ok = errors.length === 0;
  if (atomic && !ok) {
    return { ok, doc, results, errors, idMap: {}, inverse: [], affected: { components: [], layers: [], patches: [] }, applied: [] };
  }
  const result: ApplyOpsResult = {
    ok,
    doc: options.dryRun ? doc : ctx.doc,
    results,
    errors,
    idMap,
    inverse: inverses.reverse().flat(),
    affected: { components: sorted(affected.components), layers: sorted(affected.layers), patches: sorted(affected.patches) },
    applied,
  };
  if (options.dryRun) result.preview = ctx.doc;
  return result;
}
